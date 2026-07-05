/**
 * Exit Service
 *
 * Closes an open position by:
 *   1. Creating an offsetting TradeProposal (direction reversed)
 *   2. Simulating execution (honest simulation params)
 *   3. Recording a closing Fill
 *   4. Updating Position to CLOSED with realized P&L
 *   5. Updating portfolio snapshot
 *
 * Called by:
 *   - Stop loss enforcement in market feed
 *   - Signal reversal exit in signal generator
 *   - Time-based exit (TTL exceeded)
 *
 * Never throws — all errors are logged and swallowed so the
 * worker loop continues regardless of individual position failures.
 */

const { Client } = require("pg");
const prisma          = require("../lib/prisma");
const logger          = require("../lib/logger");
const { snapshotPortfolio } = require("./position.service");
const { notify } = require("../notifications/router");
const { settlePosition } = require("./execution.service");

async function pgNotify(channel, payload) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  } catch (err) {
    logger.warn("[exit.service] pg_notify failed", { channel, error: err.message });
  } finally {
    await client.end();
  }
}

// Honest simulation params (matches execution.service.js)
const SLIPPAGE_NORMAL = 0.001;  // ±0.1%
const SLIPPAGE_STRESS = 0.003;  // ±0.3%
const REJECTION_RATE  = 0.05;   // 5%
const MIN_DELAY_MS    = 2000;
const MAX_DELAY_MS    = 8000;

function randomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
}

function getSlippage(isStress) {
  const base = isStress ? SLIPPAGE_STRESS : SLIPPAGE_NORMAL;
  return (Math.random() * 2 - 1) * base;
}

function generateMockTxHash(chainType) {
  if (chainType === "SOLANA") {
    return Array.from({ length: 44 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789"[Math.floor(Math.random() * 58)]
    ).join("");
  }
  return "0x" + Array.from({ length: 64 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");
}

/**
 * Close an open position.
 *
 * @param {string} positionId
 * @param {string} reason — "STOP_LOSS" | "SIGNAL_REVERSAL" | "TTL_EXPIRED" | "MANUAL"
 * @returns {object|null} closed position record, or null on failure
 */
async function closePosition(positionId, reason = "MANUAL") {
  try {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: {
        asset:     true,
        venue:     true,
        chain:     true,
        portfolio: {
          include: {
            wallets:    { include: { wallet: { include: { chain: true } } } },
            riskConfig: true,
          },
        },
      },
    });

    if (!position) {
      logger.warn("[exit.service] Position not found", { positionId });
      return null;
    }

    if (position.status !== "OPEN") {
      logger.debug("[exit.service] Position not open — skipping", { positionId, status: position.status });
      return null;
    }

    logger.info("[exit.service] Closing position", {
      positionId,
      asset:  position.asset?.symbol,
      side:   position.side,
      size:   position.size,
      reason,
    });

    // Get current regime for slippage calibration
    const portfolio = position.portfolio;
    const signalConfigs = await prisma.portfolioSignalConfig.findFirst({
      where: { portfolioId: portfolio.id, active: true },
    });
    let isStress = false;
    if (signalConfigs) {
      const regime = await prisma.regimeState.findFirst({
        where: { signalConfigId: signalConfigs.signalConfigId, validTo: null },
      });
      isStress = regime?.state === "STRESS";
    }

    // Simulate rejection (5% rate)
    if (Math.random() < REJECTION_RATE) {
      logger.warn("[exit.service] Close rejected by simulated execution", { positionId, reason });
      const wsOwner = await prisma.workspace.findUnique({ where: { id: portfolio.workspaceId }, select: { ownerId: true } });
      await notify(wsOwner.ownerId, portfolio.workspaceId, "RISK_EVENT", {
        type: "REJECTION", value: 0, threshold: 0,
        actionTaken: `Exit rejected: ${reason}`,
        portfolioId: portfolio.id,
      });
      return null;
    }

    // Find best wallet for this chain
    const walletEntry = portfolio.wallets.find(
      pw => pw.wallet.chainId === position.chainId && pw.wallet.status === "CONNECTED"
    ) || portfolio.wallets[0];

    if (!walletEntry) {
      logger.warn("[exit.service] No wallet available for close", { positionId });
      return null;
    }

    // Closing direction is opposite of opening side
    const closeDirection = position.side === "LONG" ? "SHORT" : "LONG";

    // Create offsetting TradeProposal for the close
    const proposal = await prisma.tradeProposal.create({
      data: {
        signalId:      await getOrCreateCloseSignalId(position),
        portfolioId:   position.portfolioId,
        walletId:      walletEntry.wallet.id,
        venueId:       position.venueId,
        assetId:       position.assetId,
        direction:     closeDirection,
        notional:      position.size * position.currentPrice,
        estEntry:      position.currentPrice,
        estFeeBps:     position.venue?.feeBps || 2.5,
        estSlippageBps: isStress ? 30 : 10,
        status:        "PENDING",
      },
    });

    // Simulate execution delay
    await delay(randomDelay());

    // Compute exit price with realistic slippage
    const slippage  = getSlippage(isStress);
    const exitPrice = position.currentPrice * (1 + slippage);
    const feePaid   = proposal.notional * (proposal.estFeeBps / 10000);
    const txHash    = generateMockTxHash(position.chain?.type || "SOLANA");

    // Compute realized P&L
    let realizedPnl;
    if (position.side === "LONG" || position.side === "SPOT") {
      realizedPnl = (exitPrice - position.entryPrice) * position.size - feePaid;
    } else {
      realizedPnl = (position.entryPrice - exitPrice) * position.size - feePaid;
    }

    // Record transaction
    const transaction = await prisma.transaction.create({
      data: {
        tradeProposalId: proposal.id,
        chainId:         position.chainId,
        txHash,
        status:          "CONFIRMED",
        submittedAt:     new Date(),
        confirmedAt:     new Date(),
        blockNumber:     BigInt(Math.floor(Math.random() * 1e8)),
      },
    });

    // Record closing fill
    await prisma.fill.create({
      data: {
        tradeProposalId: proposal.id,
        assetId:         position.assetId,
        venueId:         position.venueId,
        direction:       closeDirection,
        fillPrice:       exitPrice,
        fillSize:        position.size,
        feePaid,
        feeAsset:        "USDT",
        filledAt:        new Date(),
      },
    });

    // Confirm proposal
    await prisma.tradeProposal.update({
      where: { id: proposal.id },
      data: {
        status:      "CONFIRMED",
        signedAt:    new Date(),
        submittedAt: new Date(),
        confirmedAt: new Date(),
      },
    });

    // Close position
    const closedPosition = await prisma.position.update({
      where: { id: positionId },
      data: {
        status:       "CLOSED",
        realizedPnl,
        unrealizedPnl: 0,
        closedAt:     new Date(),
      },
      include: { fill: true },
    });

    // Update portfolio snapshot
    await snapshotPortfolio(position.portfolioId);

    // Notify via notification system
    const wsOwner2 = await prisma.workspace.findUnique({ where: { id: portfolio.workspaceId }, select: { ownerId: true } });
    await notify(wsOwner2.ownerId, portfolio.workspaceId, "POSITION_CLOSED", {
      asset:       position.asset?.symbol,
      side:        position.side,
      realizedPnl,
      exitPrice,
      reason,
      positionId,
    });

    logger.info("[exit.service] Position closed", {
      positionId,
      reason,
      exitPrice:   exitPrice.toFixed(4),
      realizedPnl: realizedPnl.toFixed(4),
      txHash:      txHash.slice(0, 16),
    });

    // Notify API → socket.io → frontend
    await pgNotify("position_closed", {
      portfolioId: position.portfolioId,
      positionId,
      reason,
      realizedPnl,
      exitPrice,
      asset: position.asset?.symbol,
    });

    // Settle on-chain — return realized amount to user wallet.
    // This is now reliable: settlePosition handles its own retries/backoff and
    // marks SETTLEMENT_FAILED + alerts on exhaustion. We await it so the
    // position record always reflects the true on-chain settlement outcome
    // before this function returns, rather than leaving it in an unknown state.
    try {
      await settlePosition(closedPosition, realizedPnl);
    } catch (err) {
      logger.error("[exit.service] Settlement raised unexpectedly", { positionId, error: err.message });
    }

    return closedPosition;

  } catch (err) {
    logger.error("[exit.service] Close failed", { positionId, reason, error: err.message });
    return null;
  }
}

// Creates a synthetic signal ID for close proposals
// Reuses the original opening signal if available, otherwise creates a marker
async function getOrCreateCloseSignalId(position) {
  // Find the original signal via fill → proposal → evaluation → signal
  try {
    const fill = await prisma.fill.findUnique({
      where: { tradeProposalId: position.fill?.id || "" },
    });
    const proposal = fill
      ? await prisma.tradeProposal.findFirst({ where: { fillId: fill.id } })
      : null;
    const evaluation = proposal
      ? await prisma.portfolioSignalEvaluation.findFirst({ where: { tradeProposalId: proposal.id } })
      : null;
    if (evaluation?.signalId) return evaluation.signalId;
  } catch {}

  // Fallback: find any recent signal for this asset
  const signal = await prisma.signal.findFirst({
    where: { assetId: position.assetId },
    orderBy: { generatedAt: "desc" },
  });
  return signal?.id || null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { closePosition };
