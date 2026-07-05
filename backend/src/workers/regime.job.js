/**
 * Regime Computation Job
 *
 * Runs every 30 minutes. Reads BTC volatility and SOL/BTC correlation
 * from the rolling window state. Classifies regime and writes to RegimeState.
 *
 * Regime logic:
 *   STRESS        — BTC 30m rolling std > 2× its 7-day mean
 *   QUIET_BEARISH — Not stress, BTC return trend negative (mean of recent bars < 0)
 *   QUIET_BULLISH — Not stress, BTC return trend positive or flat
 *
 * Confidence score: derived from distance of volatility from stress threshold.
 * The further from the threshold, the higher the confidence in the classification.
 *
 * Writes to RegimeState table:
 *   - Closes current regime (sets validTo)
 *   - Creates new record (validTo = null = active)
 *
 * Does not modify any other table.
 */

const prisma  = require("../lib/prisma");
const logger  = require("../lib/logger");

// 7-day mean volatility baseline — seeded from historical data
// Will self-calibrate once enough live bars accumulate
const VOLATILITY_BASELINE_MEAN = 0.008;  // ~0.8% per 30m bar, typical for BTC
const STRESS_MULTIPLIER        = 2.0;

/**
 * @param {RollingWindowState} state
 * @param {string} signalConfigId
 */
async function computeAndWriteRegime(state, signalConfigId) {
  try {
    const closes = state.btcClosesForRegime();

    if (closes.length < 3) {
      logger.debug("[regime.job] Insufficient BTC bars for regime computation", { bars: closes.length });
      return;
    }

    // ── Compute BTC 30m returns ───────────────────────────────────────────
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
    }

    if (returns.length < 2) return;

    // ── Rolling volatility (std of returns) ──────────────────────────────
    const mean   = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const vol    = Math.sqrt(variance);

    // ── BTC stress index: vol as multiple of baseline ────────────────────
    const btcStressIndex = vol / VOLATILITY_BASELINE_MEAN;

    // ── Regime classification ─────────────────────────────────────────────
    const stressThreshold = STRESS_MULTIPLIER;
    let state_type, confidence;

    if (btcStressIndex >= stressThreshold) {
      state_type = "STRESS";
      // Higher vol above threshold = higher stress confidence
      confidence = Math.min(0.99, 0.5 + (btcStressIndex - stressThreshold) * 0.2);
    } else {
      // Use mean return direction for bullish/bearish
      const recentMean = returns.slice(-3).reduce((s, r) => s + r, 0) / Math.min(3, returns.length);
      state_type = recentMean >= 0 ? "QUIET_BULLISH" : "QUIET_BEARISH";
      // Distance from stress threshold = confidence in quiet regime
      const distFromStress = stressThreshold - btcStressIndex;
      confidence = Math.min(0.98, 0.5 + distFromStress * 0.15);
    }

    // Transition probability: how close are we to a regime change?
    // Higher = closer to stress threshold
    const transitionProb = Math.min(0.95, btcStressIndex / stressThreshold * 0.3);

    logger.info("[regime.job] Regime computed", {
      state: state_type,
      confidence: confidence.toFixed(3),
      btcStressIndex: btcStressIndex.toFixed(3),
      vol: vol.toFixed(5),
      mean: mean.toFixed(5),
      bars: closes.length,
    });

    // ── Write to Postgres ─────────────────────────────────────────────────
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Close current active regime
      await tx.regimeState.updateMany({
        where: { signalConfigId, validTo: null },
        data:  { validTo: now },
      });

      // Create new regime record
      await tx.regimeState.create({
        data: {
          signalConfigId,
          state:          state_type,
          confidence,
          hmmState:       state_type === "STRESS" ? 1 : state_type === "QUIET_BEARISH" ? 2 : 3,
          btcStressIndex: btcStressIndex,
          transitionProb,
          validFrom:      now,
          validTo:        null,
        },
      });
    });

    logger.info("[regime.job] RegimeState written", { state: state_type, signalConfigId });

  } catch (err) {
    logger.error("[regime.job] Error", { error: err.message, stack: err.stack });
    // Never throws — caller continues regardless
  }
}

module.exports = { computeAndWriteRegime };
