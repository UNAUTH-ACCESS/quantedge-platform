// Signal Generator — simulation layer.
// Reads frozen SignalConfig + active RegimeState from Postgres.
// Generates realistic feature values (regime-aware).
// Creates Signal record if strength >= threshold.
// Triggers evaluation pipeline.
// In production: replaced by live feature computation from Bybit data.

const { Client } = require("pg");
const prisma = require("../lib/prisma");
const { evaluateSignal } = require("../services/evaluation.service");
const marketFeed = require("./market.feed");
const logger = require("../lib/logger");

// Notify API process of new signals/proposals via Postgres LISTEN/NOTIFY
async function pgNotify(channel, payload) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(`SELECT pg_notify($1, $2)`, [channel, JSON.stringify(payload)]);
  } catch (err) {
    logger.warn("pg_notify failed", { channel, error: err.message });
  } finally {
    await client.end();
  }
}

// ── Bar-frequency scheduling ────────────────────────────────────────────────────
// Parses the last numeric+unit token in barFrequency (e.g. "2-bar-30m" -> 30m,
// "1h" -> 1h, "4h" -> 4h). Cadence = one signal opportunity per bar close.
function parseBarDurationMs(barFrequency) {
  const match = /(\d+)\s*(m|h)\b/i.exec(barFrequency || "");
  if (!match) return 30 * 60 * 1000; // fallback: 30m
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return unit === "h" ? value * 60 * 60 * 1000 : value * 60 * 1000;
}

// Deterministic UTC bar-close: floor(now / duration) * duration.
// Epoch ms is inherently UTC, so this naturally aligns to clean UTC boundaries
// (e.g. 1h bars close at :00 every hour UTC, 4h bars at 00/04/08/12/16/20 UTC).
function computeBarCloseAt(nowMs, durationMs) {
  return new Date(Math.floor(nowMs / durationMs) * durationMs);
}

// Optional low-liquidity blackout window — comma-separated UTC hours (0-23).
// Empty by default; only skips generation if explicitly configured.
function isInBlackoutWindow(now) {
  const raw = process.env.SIGNAL_BLACKOUT_HOURS_UTC || "";
  if (!raw.trim()) return false;
  const hours = raw.split(",").map(h => parseInt(h.trim(), 10)).filter(h => !isNaN(h));
  return hours.includes(now.getUTCHours());
}

// Postgres advisory lock — distributed lock keyed by (signalConfigId, barCloseAt).
// Session-scoped: must release on the SAME connection that acquired it.
async function withBarLock(signalConfigId, barCloseAt, fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const key1 = `hashtext('${signalConfigId}')`;
    const key2 = `hashtext('${barCloseAt.toISOString()}')`;
    const { rows } = await client.query(
      `SELECT pg_try_advisory_lock(${key1}, ${key2}) AS locked`
    );
    if (!rows[0].locked) {
      return { acquired: false };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${key1}, ${key2})`);
    }
  } finally {
    await client.end();
  }
}

// Regime-aware feature distributions
const REGIME_PARAMS = {
  QUIET_BULLISH: {
    btc_change_30m:    { mean:  0.6, std: 0.3 },
    bid_ask_imbalance: { mean:  0.4, std: 0.3 },
    price_change_5m:   { mean: -0.3, std: 0.2 },
  },
  QUIET_BEARISH: {
    btc_change_30m:    { mean: -0.5, std: 0.3 },
    bid_ask_imbalance: { mean: -0.3, std: 0.3 },
    price_change_5m:   { mean:  0.2, std: 0.2 },
  },
  STRESS: {
    btc_change_30m:    { mean: -0.8, std: 0.5 },
    bid_ask_imbalance: { mean: -0.6, std: 0.4 },
    price_change_5m:   { mean:  0.5, std: 0.4 },
  },
  TRANSITIONING: {
    btc_change_30m:    { mean:  0.0, std: 0.5 },
    bid_ask_imbalance: { mean:  0.0, std: 0.4 },
    price_change_5m:   { mean:  0.0, std: 0.3 },
  },
};

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function sampleFeature(mean, std) {
  return Math.max(-1, Math.min(1, mean + std * randn()));
}

function computeStrength(featureValues, featureSet) {
  // Weighted sum of absolute feature values, normalized to [0,1]
  let weighted = 0;
  let totalWeight = 0;
  for (const f of featureSet) {
    const val = featureValues[f.name] || 0;
    weighted += Math.abs(val) * (f.weight || 1);
    totalWeight += f.weight || 1;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function inferDirection(featureValues) {
  // Directional vote: positive bid_ask_imbalance and btc momentum → LONG
  const score =
    (featureValues.bid_ask_imbalance || 0) * 0.4 +
    (featureValues.btc_change_30m    || 0) * 0.4 +
    -(featureValues.price_change_5m  || 0) * 0.2; // reversion component
  return score >= 0 ? "LONG" : "SHORT";
}

async function generateSignal() {
  try {
    // Load all frozen signal configs
    const configs = await prisma.signalConfig.findMany({
      where: { status: "FROZEN" },
      include: { strategy: true },
    });

    if (configs.length === 0) {
      logger.debug("No frozen SignalConfigs — skipping signal generation");
      return;
    }

    const now = new Date();

    if (isInBlackoutWindow(now)) {
      logger.debug("Inside configured low-liquidity blackout window — skipping cycle", {
        utcHour: now.getUTCHours(),
      });
      return;
    }

    for (const config of configs) {
      // Bar-frequency gating: one signal opportunity per bar close.
      const durationMs = parseBarDurationMs(config.barFrequency);
      const barCloseAt = computeBarCloseAt(now.getTime(), durationMs);

      const existing = await prisma.signal.findUnique({
        where: { signalConfigId_barCloseAt: { signalConfigId: config.id, barCloseAt } },
      });
      if (existing) {
        continue; // already generated for this bar
      }

      const lockResult = await withBarLock(config.id, barCloseAt, async () => {
        return generateForConfig(config, barCloseAt);
      });

      if (!lockResult.acquired) {
        logger.debug("Bar lock not acquired — another process is handling this bar", {
          signalConfigId: config.id, barCloseAt,
        });
      }
    }
  } catch (err) {
    logger.error("Signal generation error", { error: err.message, stack: err.stack });
  }
}

async function generateForConfig(config, barCloseAt) {
  try {
      // Get current regime
      const regime = await prisma.regimeState.findFirst({
        where: { signalConfigId: config.id, validTo: null },
      });
      const regimeState = regime?.state || "QUIET_BULLISH";
      const params = REGIME_PARAMS[regimeState] || REGIME_PARAMS.QUIET_BULLISH;

      // Sample feature values from regime distribution
      const featureSet = config.featureSet;
      const featureValues = {};
      for (const f of featureSet) {
        const dist = params[f.name] || { mean: 0, std: 0.3 };
        featureValues[f.name] = sampleFeature(dist.mean, dist.std);
      }

      const strength = computeStrength(featureValues, featureSet);
      const threshold = config.thresholds?.strength_min || 0.5;

      logger.debug("Signal generated", { strength: strength.toFixed(3), threshold, regime: regimeState });

      if (strength < threshold) {
        logger.debug("Signal below threshold — discarded", { strength, threshold });
        return;
      }

      const direction = inferDirection(featureValues);
      const prices = marketFeed.getPrices();

      // Get SOL asset (primary target — extend for multi-asset later)
      const asset = await prisma.asset.findUnique({ where: { symbol: "SOL" } });
      if (!asset) return;

      const kellySize = Math.min(strength * config.kellyFraction, config.thresholds?.kelly_max || 0.25);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min TTL

      const signal = await prisma.signal.create({
        data: {
          signalConfigId: config.id,
          assetId: asset.id,
          direction,
          strength,
          featuresSnapshot: featureValues,
          kellySize,
          regimeStateId: regime?.id,
          status: "PENDING",
          expiresAt,
            barCloseAt,
        },
        include: { asset: true, signalConfig: { include: { strategy: true } } },
      });

      logger.info("Signal created", {
        signalId: signal.id,
        asset: asset.symbol,
        direction,
        strength: strength.toFixed(3),
        regime: regimeState,
      });

      // Trigger portfolio evaluation pipeline
      const evalResults = await evaluateSignal(signal);

      // Notify API via Postgres so socket.io can push to frontend
      await pgNotify("signal_created", {
        signalId: signal.id,
        asset: asset.symbol,
        direction,
        strength,
        regime: regimeState,
        proposals: evalResults.filter(e => e.tradeProposalId).map(e => ({
          proposalId: e.tradeProposalId,
          portfolioId: e.portfolioId,
          evaluationStatus: e.evaluationStatus,
        })),
      });
  } catch (err) {
    logger.error("Signal generation error", { error: err.message, stack: err.stack });
  }
}

module.exports = { generateSignal };
