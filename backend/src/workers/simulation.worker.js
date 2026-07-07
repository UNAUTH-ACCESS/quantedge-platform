/**
 * QuantEdge Simulation Worker — Full Autonomous Cycle
 *
 * Entry: Real Bybit features → signal → evaluate → auto-sign → fill → position
 * Exit:  Stop loss breach | Signal reversal | TTL expired → closePosition()
 *
 * Execution stays simulated (honest params).
 * All other layers unchanged.
 */

require("dotenv").config();

// Validates all shared/critical config at boot — fails fast with a clear,
// consolidated report if anything required is missing or malformed. See H2.
const config = require("../lib/config");

const prisma                    = require("../lib/prisma");
const logger                    = require("../lib/logger");
const BybitFeed                 = require("./feeds/bybit.feed");
const RollingWindowState        = require("./feeds/rolling.window");
const { computeFeatures }       = require("./feeds/features");
const { computeAndWriteRegime } = require("./regime.job");
const { updatePositionPrices, snapshotPortfolio } = require("../services/position.service");
const { recordRiskEvent }       = require("../services/risk.service");
const { evaluateSignal }        = require("../services/evaluation.service");
const { closePosition }         = require("../services/exit.service");
const { autoSignPendingProposals } = require("../services/autosign.service");
const { sendDrawdownAlert }     = require("../services/lifecycle.service");
const { watchForDeposits }      = require("../services/depositWatcher.service");

const SIGNAL_INTERVAL   = parseInt(process.env.SIGNAL_INTERVAL_MS    || "60000");
const MARKET_INTERVAL   = parseInt(process.env.MARKET_FEED_INTERVAL_MS || "30000");
const SNAPSHOT_INTERVAL = parseInt(process.env.SNAPSHOT_INTERVAL_MS   || "300000");
const REGIME_INTERVAL   = 30 * 60 * 1000;
const DEPOSIT_INTERVAL  = parseInt(process.env.DEPOSIT_INTERVAL_MS || "60000");

// Position TTL — close if open longer than this (default 4 hours)
const POSITION_TTL_MS   = parseInt(process.env.POSITION_TTL_MS || "14400000");

const rollingWindow = new RollingWindowState();
const mockPrices    = { SOL: 142.30, BTC: 67240.00, ETH: 3482.10 };

// Track last known signal direction per asset for reversal detection
const lastSignalDirection = {};

// ── Bybit WebSocket feed ──────────────────────────────────────────────────────
const feed = new BybitFeed(
  (symbol, interval, bar) => {
    if (symbol === "BTCUSDT" && interval === "30") {
      rollingWindow.onBtcKline(bar);
      mockPrices.BTC = bar.close;
    }
    if (symbol === "SOLUSDT" && interval === "5") {
      rollingWindow.onSolKline(bar);
      mockPrices.SOL = bar.close;
    }
  },
  (symbol, data) => {
    if (symbol === "SOLUSDT") rollingWindow.onOrderbook(data);
  }
);

// ── Signal generator ──────────────────────────────────────────────────────────
async function generateSignal() {
  try {
    const readiness = rollingWindow.readinessReport();
    if (!readiness.ready) {
      logger.info("[worker] Waiting for live data", readiness);
      return;
    }

    const features = computeFeatures(rollingWindow);
    if (!features) {
      logger.debug("[worker] Feature computation returned null — skipping");
      return;
    }

    const configs = await prisma.signalConfig.findMany({
      where: { status: "FROZEN" },
      include: { strategy: true },
    });
    if (configs.length === 0) return;

    for (const config of configs) {
      const regime = await prisma.regimeState.findFirst({
        where: { signalConfigId: config.id, validTo: null },
      });

      // Compute strength from real features
      let weighted = 0, totalWeight = 0;
      for (const f of config.featureSet) {
        weighted    += Math.abs(features[f.name] || 0) * (f.weight || 1);
        totalWeight += f.weight || 1;
      }
      const strength  = totalWeight > 0 ? weighted / totalWeight : 0;
      const threshold = config.thresholds?.strength_min || 0.5;

      // Direction from feature signs
      const directionScore =
        (features.bid_ask_imbalance || 0) * 0.4 +
        (features.btc_change_30m    || 0) * 0.4 +
        -(features.price_change_5m  || 0) * 0.2;
      const direction = directionScore >= 0 ? "LONG" : "SHORT";

      logger.debug("[worker] Signal computed", {
        strength: strength.toFixed(3), threshold,
        direction, regime: regime?.state,
      });

      // ── Exit check: signal reversal ───────────────────────────────────
      const asset = await prisma.asset.findUnique({ where: { symbol: "SOL" } });
      if (!asset) continue;

      const prevDirection = lastSignalDirection[asset.id];
      if (prevDirection && prevDirection !== direction) {
        // Direction has reversed — close any open positions on this asset
        const openPositions = await prisma.position.findMany({
          where: { assetId: asset.id, status: "OPEN" },
        });
        for (const pos of openPositions) {
          logger.info("[worker] Signal reversal — closing position", {
            positionId: pos.id, from: prevDirection, to: direction,
          });
          await closePosition(pos.id, "SIGNAL_REVERSAL");
        }
      }

      // Update last known direction
      if (strength >= threshold) {
        lastSignalDirection[asset.id] = direction;
      }

      // ── Entry: generate signal if above threshold ─────────────────────
      if (strength < threshold) {
        logger.debug("[worker] Signal below threshold — discarded");
        continue;
      }

      const kellySize = Math.min(strength * config.kellyFraction, config.thresholds?.kelly_max || 0.25);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      const signal = await prisma.signal.create({
        data: {
          signalConfigId:   config.id,
          assetId:          asset.id,
          direction,
          strength,
          featuresSnapshot: features,
          kellySize,
          regimeStateId:    regime?.id,
          status:           "PENDING",
          expiresAt,
        },
        include: { asset: true, signalConfig: { include: { strategy: true } } },
      });

      logger.info("[worker] Signal created", {
        signalId:  signal.id,
        asset:     asset.symbol,
        direction,
        strength:  strength.toFixed(3),
        regime:    regime?.state,
      });

      // Evaluate across all portfolios
      const evaluations = await evaluateSignal(signal);

      // Auto-sign approved proposals for portfolios with auto-execute enabled
      const portfolioIds = [...new Set(evaluations.map(e => e.portfolioId))];
      for (const portfolioId of portfolioIds) {
        const portfolio = await prisma.portfolio.findUnique({
          where: { id: portfolioId },
          select: { workspaceId: true },
        });
        if (portfolio) {
          await autoSignPendingProposals(portfolioId, portfolio.workspaceId);
        }
      }
    }
  } catch (err) {
    logger.error("[worker] Signal generation error", { error: err.message, stack: err.stack });
  }
}

// ── Market feed loop ──────────────────────────────────────────────────────────
async function marketFeedLoop() {
  try {
    await updatePositionPrices(mockPrices);

    const openPositions = await prisma.position.findMany({
      where: { status: "OPEN" },
      include: {
        asset:     true,
        portfolio: { include: { riskConfig: true, workspace: true } },
      },
    });

    for (const position of openPositions) {
      const riskConfig = position.portfolio?.riskConfig;
      if (!riskConfig) continue;

      // ── Stop loss enforcement ─────────────────────────────────────────
      const pnlPct = position.entryPrice > 0
        ? (position.unrealizedPnl / (position.entryPrice * position.size)) * 100
        : 0;

      if (pnlPct <= -riskConfig.stopLossPct) {
        logger.warn("[worker] Stop loss — closing position", {
          positionId: position.id,
          asset:      position.asset?.symbol,
          pnlPct:     pnlPct.toFixed(2),
          threshold:  -riskConfig.stopLossPct,
        });
        await recordRiskEvent(
          position.portfolioId, "STOP_LOSS",
          Math.abs(pnlPct), riskConfig.stopLossPct,
          position.id, "AUTO_CLOSE"
        );
        await closePosition(position.id, "STOP_LOSS");
        continue; // Skip TTL check for this position
      }

      // ── TTL enforcement ───────────────────────────────────────────────
      const ageMs = Date.now() - new Date(position.openedAt).getTime();
      if (ageMs > POSITION_TTL_MS) {
        logger.info("[worker] Position TTL exceeded — closing", {
          positionId: position.id,
          ageHours:   (ageMs / 3600000).toFixed(1),
        });
        await closePosition(position.id, "TTL_EXPIRED");
        continue;
      }

      // ── Drawdown check ────────────────────────────────────────────────
      const snapshot = await prisma.portfolioSnapshot.findFirst({
        where:   { portfolioId: position.portfolioId },
        orderBy: { snappedAt: "desc" },
      });
      const inception = await prisma.portfolioSnapshot.findFirst({
        where:   { portfolioId: position.portfolioId },
        orderBy: { snappedAt: "asc" },
      });
      if (snapshot && inception && inception.nav > 0) {
        const drawdownPct = ((inception.nav - snapshot.nav) / inception.nav) * 100;
        if (drawdownPct >= riskConfig.maxDrawdownPct) {
          try {
        const port = await prisma.portfolio.findUnique({ where: { id: position.portfolioId }, select: { workspaceId: true, name: true } });
        const ws   = await prisma.workspace.findUnique({ where: { id: port.workspaceId }, select: { ownerId: true } });
        sendDrawdownAlert(ws.ownerId, port.workspaceId, port.name, drawdownPct, riskConfig.maxDrawdownPct).catch(() => {});
      } catch {}

      logger.warn("[worker] Max drawdown breach — closing all positions", {
            portfolioId: position.portfolioId,
            drawdownPct: drawdownPct.toFixed(2),
          });
          await recordRiskEvent(
            position.portfolioId, "DRAWDOWN_BREACH",
            drawdownPct, riskConfig.maxDrawdownPct,
            position.id, "AUTO_CLOSE_ALL"
          );
          await closePosition(position.id, "STOP_LOSS");
        }
      }
    }
  } catch (err) {
    logger.error("[worker] Market feed error", { error: err.message });
  }
}

// ── Snapshot loop ─────────────────────────────────────────────────────────────
async function snapshotLoop() {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { status: "ACTIVE" }, select: { id: true },
    });
    for (const p of portfolios) {
      await snapshotPortfolio(p.id);
      logger.debug("[worker] Snapshot taken", { portfolioId: p.id });
    }
  } catch (err) {
    logger.error("[worker] Snapshot error", { error: err.message });
  }
}

// ── Regime loop ───────────────────────────────────────────────────────────────
async function regimeLoop() {
  try {
    const configs = await prisma.signalConfig.findMany({
      where: { status: "FROZEN" }, select: { id: true },
    });
    for (const c of configs) await computeAndWriteRegime(rollingWindow, c.id);
  } catch (err) {
    logger.error("[worker] Regime job error", { error: err.message });
  }
}

// ── Signal expiry ─────────────────────────────────────────────────────────────
async function expireSignals() {
  try {
    const result = await prisma.signal.updateMany({
      where: { status: { in: ["PENDING", "ACTIVE"] }, expiresAt: { lt: new Date() } },
      data:  { status: "EXPIRED" },
    });
    if (result.count > 0) logger.info("[worker] Signals expired", { count: result.count });
  } catch (err) {
    logger.error("[worker] Signal expiry error", { error: err.message });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  logger.info("[worker] Starting autonomous cycle", {
    signalInterval:   `${SIGNAL_INTERVAL}ms`,
    marketInterval:   `${MARKET_INTERVAL}ms`,
    snapshotInterval: `${SNAPSHOT_INTERVAL}ms`,
    regimeInterval:   `${REGIME_INTERVAL}ms`,
    positionTTL:      `${POSITION_TTL_MS}ms`,
  });

  await prisma.$queryRaw`SELECT 1`;
  logger.info("[worker] Database connection verified");

  feed.start();
  logger.info("[worker] Bybit WebSocket feed starting…");

  await marketFeedLoop();
  await snapshotLoop();

  setInterval(generateSignal,  SIGNAL_INTERVAL);
  setInterval(marketFeedLoop,  MARKET_INTERVAL);
  setInterval(snapshotLoop,    SNAPSHOT_INTERVAL);
  setInterval(regimeLoop,      REGIME_INTERVAL);
  setInterval(expireSignals,   60_000);
  setInterval(() => watchForDeposits().catch(err =>
    logger.error("[worker] Deposit watcher error", { error: err.message })
  ), DEPOSIT_INTERVAL);

  logger.info("[worker] Autonomous cycle running");
}

process.on("SIGTERM", async () => {
  logger.info("[worker] Shutting down…");
  feed.stop();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  feed.stop();
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((err) => {
  logger.error("[worker] Fatal error", { error: err.message, stack: err.stack });
  process.exit(1);
});
