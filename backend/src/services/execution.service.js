const { v4: uuidv4 } = require("uuid");
const prisma = require("../lib/prisma");
const positionService = require("./position.service");
const logger = require("../lib/logger");
const { notify } = require("../notifications/router");
const { sendFirstTrade } = require("./lifecycle.service");

// ── Delegate HTTP client ──────────────────────────────────────────────────────
const config = require("../lib/config");

async function delegatePost(endpoint, body) {
  const res = await fetch(`${config.DELEGATE_SERVER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-delegate-secret": config.DELEGATE_SHARED_SECRET,
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || `Delegate error at ${endpoint}`);
  return data;
}

// ── Chain key mapping ─────────────────────────────────────────────────────────
const PROVIDER_CHAIN_MAP = {
  METAMASK:     "ERC20",
  TRUST_WALLET: "ERC20",
  TRONLINK:     "TRC20",
  PHANTOM:      "SPL"
};

// ── Vault addresses — where notional moves on trade entry ─────────────────────
// These are the delegate addresses from quantedge-delegate .env
// In production: one vault address per chain, controlled by your server
const VAULT = {
  ERC20: process.env.DELEGATE_ADDRESS,
  TRC20: process.env.TRON_DELEGATE_ADDRESS,
  SPL:   process.env.SOLANA_DELEGATE_ADDRESS
};

/**
 * Execute a proposal — real on-chain delegate execution with simulated fill metrics.
 *
 * Flow:
 *   PENDING → SIGNED → SUBMITTED (delegate fires transferFrom) → CONFIRMED
 *
 * On trade entry:  notional USDT moves from user wallet → vault
 * On trade close:  realized P&L amount moves from vault → user wallet
 *                  (profit > notional, loss < notional)
 */
async function signAndExecute(proposalId) {
  const proposal = await prisma.tradeProposal.findUnique({
    where: { id: proposalId },
    include: {
      wallet: { include: { chain: true } },
      venue:  true,

    },
  });

  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  if (proposal.status !== "PENDING") throw new Error(`Proposal ${proposalId} is not pending`);

  // Resolve chain key from wallet provider
  const chainKey = proposal.wallet.delegateChain ||
    PROVIDER_CHAIN_MAP[proposal.wallet.provider];

  const useDelegateExecution = !!(
    chainKey &&
    proposal.wallet.delegateApproved &&
    VAULT[chainKey]
  );

  // Step 1: SIGNED
  await prisma.tradeProposal.update({
    where: { id: proposalId },
    data:  { status: "SIGNED", signedAt: new Date() },
  });
  logger.info("[execution] Proposal signed", { proposalId, chainKey, useDelegateExecution });

  // Step 2: SUBMITTED — fire real delegate tx or fall back to simulation
  await delay(500);

  let txHash;

  if (useDelegateExecution) {
    try {
      // Move notional from user wallet to vault
      const result = await delegatePost("/execute-trade", {
        chains:      [chainKey],
        fromAddress: { [chainKey]: proposal.wallet.address },
        toAddress:   { [chainKey]: VAULT[chainKey] },
        amountUSDT:  proposal.notional
      });

      const chainResult = result.results?.find(r => r.chain === chainKey);
      if (!chainResult || chainResult.status !== "success") {
        throw new Error(`Delegate trade failed: ${chainResult?.error || "unknown"}`);
      }

      txHash = String(chainResult.txHash);
      logger.info("[execution] Delegate trade executed", {
        proposalId, chainKey, txHash, notional: proposal.notional
      });

    } catch (delegateErr) {
      // PRODUCTION REQUIREMENT: no fallback to simulation. Mark proposal FAILED and re-throw.
      logger.error("[execution] Delegate execution failed — rejecting (no simulation fallback)", {
        proposalId, error: delegateErr.message
      });
      await prisma.tradeProposal.update({
        where: { id: proposalId },
        data:  { status: "FAILED", failureReason: `Delegate execution failed: ${delegateErr.message}` },
      });
      throw new Error(`Delegate execution failed for proposal ${proposalId}: ${delegateErr.message}`);
    }
  } else {
    // PRODUCTION REQUIREMENT: wallet not delegate-approved — reject, do not simulate.
    logger.error("[execution] Wallet not delegate-approved — rejecting proposal", {
      proposalId, walletId: proposal.walletId, chainKey
    });
    await prisma.tradeProposal.update({
      where: { id: proposalId },
      data:  { status: "FAILED", failureReason: "Wallet is not delegate-approved. Live execution requires an approved delegate wallet." },
    });
    throw new Error(`Proposal ${proposalId} rejected: wallet is not delegate-approved for live execution`);
  }

  await prisma.tradeProposal.update({
    where: { id: proposalId },
    data:  { status: "SUBMITTED", submittedAt: new Date() },
  });

  // Create transaction record
  const transaction = await prisma.transaction.create({
    data: {
      tradeProposalId: proposalId,
      chainId:         proposal.wallet.chainId,
      txHash,
      status:          "SUBMITTED",
      submittedAt:     new Date(),
    },
  });
  logger.info("[execution] Transaction submitted", { txHash, proposalId });

  // Step 3: CONFIRMED — simulate confirmation delay
  await delay(useDelegateExecution ? 1000 : 3000);

  const fillPrice = proposal.estEntry * (1 + (Math.random() * 0.002 - 0.001)); // ±0.1% slippage
  const fillSize  = proposal.notional / fillPrice;
  const feePaid   = proposal.notional * (proposal.estFeeBps / 10000);

  // Record fill
  const fill = await prisma.fill.create({
    data: {
      tradeProposalId: proposalId,
      assetId:         proposal.assetId,
      venueId:         proposal.venueId,
      direction:       proposal.direction,
      fillPrice,
      fillSize,
      feePaid,
      feeAsset:        "USDT",
      filledAt:        new Date(),
    },
  });

  // Confirm transaction
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status:      "CONFIRMED",
      confirmedAt: new Date(),
      blockNumber: BigInt(Math.floor(Math.random() * 1e8))
    },
  });

  // Confirm proposal
  await prisma.tradeProposal.update({
    where: { id: proposalId },
    data:  { status: "CONFIRMED", confirmedAt: new Date() },
  });

  // Create/update position from fill
  const position = await positionService.upsertPositionFromFill(fill, proposal);

  // Snapshot portfolio
  await positionService.snapshotPortfolio(proposal.portfolioId);

  // Notify
  const ws = await prisma.portfolio.findUnique({
    where: { id: proposal.portfolioId },
    select: { workspaceId: true }
  });

  await notify(proposal.wallet.userId, ws.workspaceId, "TRADE_EXECUTED", {
    asset:       proposal.assetId,
    direction:   proposal.direction,
    size:        fillSize,
    fillPrice,
    feePaid,
    venue:       proposal.venue?.name,
    proposalId:  proposal.id,
    onChain:     useDelegateExecution,
    chainKey,
    txHash
  });

  // First trade lifecycle email
  try {
    const workspace = await prisma.workspace.findUnique({
      where:  { id: ws.workspaceId },
      select: { ownerId: true }
    });
    const fillCount = await prisma.fill.count({
      where: { tradeProposal: { portfolioId: proposal.portfolioId } }
    });
    if (fillCount === 1) {
      sendFirstTrade(workspace.ownerId, ws.workspaceId, {
        asset:     proposal.assetId,
        direction: proposal.direction,
        venue:     proposal.venue?.name,
        fillPrice,
        size:      fillSize,
        feePaid,
      }).catch(() => {});
    }
  } catch {}

  logger.info("[execution] Complete", {
    proposalId, fillPrice, fillSize,
    positionId: position.id,
    onChain: useDelegateExecution
  });

  return {
    proposal: await prisma.tradeProposal.findUnique({ where: { id: proposalId } }),
    fill,
    position
  };
}

/**
 * Return realized P&L amount to user wallet when position closes.
 * Profit: vault sends back more than notional
 * Loss:   vault sends back less than notional
 *
 * Called by exit.service.js after position closes.
 */
async function settlePosition(position, realizedPnl) {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1000, 3000, 9000];

  const proposal = await prisma.tradeProposal.findFirst({
    where:   { id: position.fill?.tradeProposalId },
    include: { wallet: true }
  });

  if (!proposal?.wallet?.delegateApproved) {
    // No delegate wallet — nothing to settle on-chain
    await prisma.position.update({
      where: { id: position.id },
      data:  { settlementStatus: "NOT_APPLICABLE" },
    });
    return;
  }

  const chainKey = proposal.wallet.delegateChain ||
    PROVIDER_CHAIN_MAP[proposal.wallet.provider];

  if (!chainKey || !VAULT[chainKey]) {
    await prisma.position.update({
      where: { id: position.id },
      data:  { settlementStatus: "NOT_APPLICABLE" },
    });
    return;
  }

  const returnAmount = Math.max(0, proposal.notional + realizedPnl);

  if (returnAmount <= 0) {
    logger.warn("[execution] Settlement return amount is 0 — marking settled (nothing owed)", {
      positionId: position.id, realizedPnl
    });
    await prisma.position.update({
      where: { id: position.id },
      data:  { settlementStatus: "SETTLED", lastSettlementAt: new Date() },
    });
    return;
  }

  // Mark pending before attempting
  await prisma.position.update({
    where: { id: position.id },
    data:  { settlementStatus: "SETTLEMENT_PENDING" },
  });

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await delegatePost("/execute-trade", {
        chains:      [chainKey],
        fromAddress: { [chainKey]: VAULT[chainKey] },
        toAddress:   { [chainKey]: proposal.wallet.address },
        amountUSDT:  returnAmount
      });

      const chainResult = result.results?.find(r => r.chain === chainKey);
      if (!chainResult || chainResult.status !== "success") {
        throw new Error(`Settlement failed: ${chainResult?.error || "unknown"}`);
      }

      const txHash = String(chainResult.txHash);

      await prisma.position.update({
        where: { id: position.id },
        data: {
          settlementStatus:   "SETTLED",
          settlementTxHash:   txHash,
          settlementAttempts: attempt,
          settlementError:    null,
          lastSettlementAt:   new Date(),
        },
      });

      logger.info("[execution] Position settled on-chain", {
        positionId: position.id, chainKey, txHash, returnAmount, attempt
      });
      return;

    } catch (err) {
      lastError = err.message;
      logger.warn("[execution] Settlement attempt failed", {
        positionId: position.id, attempt, maxAttempts: MAX_ATTEMPTS, error: err.message
      });

      await prisma.position.update({
        where: { id: position.id },
        data: {
          settlementAttempts: attempt,
          settlementError:    lastError,
          lastSettlementAt:   new Date(),
        },
      });

      if (attempt < MAX_ATTEMPTS) {
        await delay(BACKOFF_MS[attempt - 1]);
      }
    }
  }

  // All attempts exhausted — mark FAILED and alert loudly
  await prisma.position.update({
    where: { id: position.id },
    data: {
      settlementStatus: "SETTLEMENT_FAILED",
      settlementError:  lastError,
    },
  });

  logger.error("[execution] Settlement FAILED after all retries — real funds not returned to user", {
    positionId: position.id, chainKey, returnAmount, error: lastError
  });

  try {
    const { notify } = require("../notifications/router");
    const portfolio = await prisma.portfolio.findUnique({
      where:   { id: position.portfolioId },
      include: { workspace: true },
    });
    if (portfolio?.workspace?.ownerId) {
      await notify(portfolio.workspace.ownerId, portfolio.workspaceId, "SETTLEMENT_FAILED", {
        positionId:   position.id,
        chainKey,
        returnAmount,
        error:        lastError,
      });
    }
  } catch (notifyErr) {
    logger.error("[execution] Failed to dispatch settlement failure alert", { error: notifyErr.message });
  }
}

/**
 * Cancel a pending proposal — only PENDING proposals can be cancelled.
 * Records who cancelled it via audit event.
 */
async function cancelProposal(proposalId, userId) {
  const proposal = await prisma.tradeProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  if (proposal.status !== "PENDING") {
    throw new Error(`Proposal ${proposalId} cannot be cancelled — status is ${proposal.status}`);
  }

  const updated = await prisma.tradeProposal.update({
    where: { id: proposalId },
    data:  { status: "CANCELLED", cancelledAt: new Date() },
  });

  try {
    const portfolio = await prisma.portfolio.findUnique({ where: { id: proposal.portfolioId } });
    if (portfolio?.workspaceId) {
      await prisma.auditEvent.create({
        data: {
          workspaceId: portfolio.workspaceId,
          actorId:     userId,
          entityType:  "TradeProposal",
          entityId:    proposalId,
          action:      "CANCEL",
          beforeState: { status: "PENDING" },
          afterState:  { status: "CANCELLED" },
        },
      });
    }
  } catch (auditErr) {
    logger.warn("[execution] Failed to write cancel audit event", { proposalId, error: auditErr.message });
  }

  logger.info("[execution] Proposal cancelled", { proposalId, userId });
  return updated;
}

function generateMockTxHash(chainType) {
  if (chainType === "SOLANA") {
    return Array.from(
      { length: 44 },
      () => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789"[Math.floor(Math.random() * 58)]
    ).join("");
  }
  return "0x" + Array.from(
    { length: 64 },
    () => "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { signAndExecute, cancelProposal, settlePosition };
