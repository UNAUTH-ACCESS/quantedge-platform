// Signal Generator — simulation layer.
// Reads frozen SignalConfig + active RegimeState from Postgres.
// Generates feature values, scores them, and creates a Signal record when
// strength clears the configured threshold. Triggers the evaluation pipeline.
//
// ⚠️  PUBLIC REPO NOTICE: the actual regime-conditioned feature distributions,
// strength-scoring weights, and direction-inference formula are QuantEdge's
// proprietary trading logic and have been redacted from this public copy.
// The infrastructure below (bar scheduling, Postgres advisory locking,
// LISTEN/NOTIFY fan-out) is real and unmodified.

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
function computeBarCloseAt(nowMs, durationMs) {
  return new Date(Math.floor(nowMs / durationMs) * durationMs);
}

// Optional low-liquidity blackout window — comma-separated UTC hours (0-23).
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

// ── [REDACTED] Regime-conditioned feature distributions ─────────────────────
// Real implementation samples each feature from a regime-specific distribution
// calibrated against historical data. Not shown publicly.
function sampleFeature(_mean, _std) {
  // Placeholder — returns a neutral value bounded to [-1, 1]
  return 0;
}

// ── [REDACTED] Signal strength scoring ───────────────────────────────────────
// Real implementation is a weighted composite of feature values with
// per-feature weights tuned against historical performance. Not shown publicly.
function computeStrength(_featureValues, _featureSet) {
  return 0;
}

// ── [REDACTED] Direction inference ───────────────────────────────────────────
// Real implementation combines momentum and mean-reversion components with
// tuned weights to produce a directional call. Not shown publicly.
function inferDirection(_featureValues) {
  return "LONG";
}

async function generateSignal() {
  try {
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
    const regime = await prisma.regimeState.findFirst({
      where: { signalConfigId: config.id, validTo: null },
    });
    const regimeState = regime?.state || "QUIET_BULLISH";

    // [REDACTED] Real implementation samples each configured feature from a
    // regime-conditioned distribution here.
    const featureSet = config.featureSet;
    const featureValues = {};
    for (const f of featureSet) {
      featureValues[f.name] = sampleFeature(0, 0.3);
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

    const asset = await prisma.asset.findUnique({ where: { symbol: "SOL" } });
    if (!asset) return;

    // [REDACTED] Real position sizing formula (Kelly-fraction based) lives
    // server-side only.
    const kellySize = 0;
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

    const evalResults = await evaluateSignal(signal);

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
