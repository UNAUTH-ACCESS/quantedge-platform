/**
 * settlementReconciliation.job.js
 *
 * Durable settlement retry — runs independently of the original close-
 * position request, on its own schedule, in the worker process. This is
 * what makes settlement durable instead of an in-memory-only retry that a
 * crash could silently lose forever. See H4.
 *
 * Finds and retries:
 *   1. SETTLEMENT_FAILED positions — the fast in-process retry (3 attempts,
 *      execution.service.js's settlePosition) exhausted, but real user
 *      funds are still owed. Keep retrying indefinitely until resolved or
 *      a human intervenes.
 *   2. Orphaned SETTLEMENT_PENDING positions — lastSettlementAt is old
 *      enough that the process which started this attempt almost certainly
 *      crashed or restarted mid-retry, never reaching SETTLED or FAILED.
 *      Treat these as failed and resume retrying them too.
 *
 * Processes one at a time with a short delay between each, so a stuck
 * delegate server doesn't get hammered by many simultaneous retries.
 */

const prisma  = require("../lib/prisma");
const logger  = require("../lib/logger");
const { retrySettlementOnce, dispatchSettlementFailedAlert } = require("../services/execution.service");

// A SETTLEMENT_PENDING position with no update in this long is almost
// certainly orphaned (the process handling it died), not still in-flight —
// a real attempt updates lastSettlementAt on every try, well under a minute.
const ORPHAN_THRESHOLD_MS = 2 * 60 * 1000;

const RETRY_DELAY_MS = 3000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reconcileStuckSettlements() {
  try {
    const orphanCutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);

    const stuck = await prisma.position.findMany({
      where: {
        OR: [
          { settlementStatus: "SETTLEMENT_FAILED" },
          { settlementStatus: "SETTLEMENT_PENDING", lastSettlementAt: { lt: orphanCutoff } },
        ],
      },
      include: { fill: { include: { tradeProposal: { include: { wallet: true } } } } },
    });

    if (stuck.length === 0) {
      logger.debug("[settlementReconciliation] No stuck settlements found");
      return;
    }

    logger.info("[settlementReconciliation] Found stuck settlements — retrying", { count: stuck.length });

    for (const position of stuck) {
      try {
        const wasOrphanedPending = position.settlementStatus === "SETTLEMENT_PENDING";
        const result = await retrySettlementOnce(position);

        if (result.status === "SETTLED") {
          logger.info("[settlementReconciliation] Resolved stuck settlement", {
            positionId: position.id, txHash: result.txHash,
          });
        } else if (result.status === "SETTLEMENT_FAILED") {
          logger.warn("[settlementReconciliation] Retry failed, will try again next cycle", {
            positionId: position.id, error: result.error,
          });
          // Only alert on the FIRST time we discover an orphaned pending
          // position turned out to be a real failure — SETTLEMENT_FAILED
          // positions already got their initial alert from execution.service.js.
          if (wasOrphanedPending) {
            const chainKey = position.fill?.tradeProposal?.wallet?.delegateChain;
            await dispatchSettlementFailedAlert(position, chainKey, position.realizedPnl, result.error);
          }
        }
      } catch (err) {
        logger.error("[settlementReconciliation] Unexpected error retrying position", {
          positionId: position.id, error: err.message,
        });
      }

      await delay(RETRY_DELAY_MS);
    }
  } catch (err) {
    logger.error("[settlementReconciliation] Reconciliation cycle failed", { error: err.message, stack: err.stack });
    // Never throw — caller's interval loop must continue regardless.
  }
}

module.exports = { reconcileStuckSettlements };
