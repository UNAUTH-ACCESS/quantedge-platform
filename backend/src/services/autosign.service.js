/**
 * Auto-Sign Service
 *
 * Automatically executes approved TradeProposals without user interaction.
 * Respects all existing risk gates — proposals are only auto-signed if they
 * passed evaluation (APPROVED status on PortfolioSignalEvaluation).
 *
 * Auto-execution is controlled by a portfolio-level flag stored in RiskConfig.
 * We use the existing `settings` JSON field on Workspace to store the flag
 * without any schema changes:
 *   workspace.settings.autoExecute = true | false
 *
 * Audit trail is always written — auto-signed proposals are distinguishable
 * from user-signed ones via auditEvent.afterState.autoSigned = true.
 *
 * Called by the worker after evaluateSignal() creates proposals.
 */

const { Client } = require("pg");
const prisma          = require("../lib/prisma");
const logger          = require("../lib/logger");
const { signAndExecute } = require("./execution.service");

async function pgNotify(channel, payload) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  } catch (err) {
    logger.warn("[autosign] pg_notify failed", { channel, error: err.message });
  } finally { await client.end(); }
}

/**
 * Check if auto-execution is enabled for a portfolio's workspace.
 * @param {string} portfolioId
 * @returns {Promise<boolean>}
 */
async function isAutoExecuteEnabled(portfolioId) {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
      include: { workspace: true },
    });
    return portfolio?.workspace?.settings?.autoExecute === true;
  } catch {
    return false;
  }
}

/**
 * Auto-sign all pending proposals for a portfolio if auto-execute is enabled.
 * Called immediately after evaluateSignal() creates proposals.
 *
 * @param {string} portfolioId
 * @param {string} workspaceId
 */
async function autoSignPendingProposals(portfolioId, workspaceId) {
  try {
    const enabled = await isAutoExecuteEnabled(portfolioId);
    if (!enabled) return;

    const pending = await prisma.tradeProposal.findMany({
      where: { portfolioId, status: "PENDING" },
      include: { evaluation: true },
    });

    if (pending.length === 0) return;

    logger.info("[autosign] Auto-executing proposals", {
      portfolioId,
      count: pending.length,
    });

    for (const proposal of pending) {
      // Only auto-sign proposals that passed evaluation
      if (proposal.evaluation?.evaluationStatus !== "APPROVED") {
        logger.debug("[autosign] Skipping non-approved proposal", { proposalId: proposal.id });
        continue;
      }

      // Atomic claim — prevent race with manual sign
      const claimed = await prisma.tradeProposal.updateMany({
        where: { id: proposal.id, status: "PENDING" },
        data:  { status: "SIGNED", signedAt: new Date() },
      });

      if (claimed.count === 0) {
        logger.debug("[autosign] Proposal already claimed", { proposalId: proposal.id });
        continue;
      }

      // Write audit event
      await prisma.auditEvent.create({
        data: {
          workspaceId,
          actorId:    await getSystemUserId(workspaceId),
          entityType: "TradeProposal",
          entityId:   proposal.id,
          action:     "SIGN",
          beforeState: { status: "PENDING" },
          afterState:  { status: "SIGNED", autoSigned: true },
        },
      });

      // Execute asynchronously — don't block the signal loop
      signAndExecute(proposal.id)
        .then(() => {
          logger.info("[autosign] Proposal executed", { proposalId: proposal.id });
          pgNotify("proposal_executed", { portfolioId, proposalId: proposal.id, positionId: result?.position?.id, status: "CONFIRMED" });
        })
        .catch((err) => {
          logger.error("[autosign] Execution failed", {
            proposalId: proposal.id,
            error: err.message,
          });
        });
    }
  } catch (err) {
    logger.error("[autosign] Error", { portfolioId, error: err.message });
  }
}

/**
 * Enable or disable auto-execute for a workspace.
 * Writes to workspace.settings without schema changes.
 *
 * @param {string} workspaceId
 * @param {boolean} enabled
 */
async function setAutoExecute(workspaceId, enabled) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings  = { ...(workspace?.settings || {}), autoExecute: enabled };
  await prisma.workspace.update({
    where: { id: workspaceId },
    data:  { settings },
  });
  logger.info("[autosign] Auto-execute updated", { workspaceId, enabled });
}

// Returns workspace owner ID for audit events triggered by system
async function getSystemUserId(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: { ownerId: true },
  });
  return workspace?.ownerId;
}

module.exports = { autoSignPendingProposals, setAutoExecute, isAutoExecuteEnabled };
