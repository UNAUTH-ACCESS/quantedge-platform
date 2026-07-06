/**
 * Regime Computation Job
 *
 * Runs on a fixed interval. Reads rolling BTC volatility state and
 * classifies the current market regime, writing the result to RegimeState.
 *
 * ⚠️  PUBLIC REPO NOTICE: the actual classification thresholds and
 * confidence-scoring formula are QuantEdge's proprietary trading logic and
 * have been redacted from this public copy. The Postgres transaction
 * pattern for closing/opening RegimeState records below is real and
 * unmodified.
 *
 * Writes to RegimeState table:
 *   - Closes current regime (sets validTo)
 *   - Creates new record (validTo = null = active)
 *
 * Does not modify any other table.
 */

const prisma  = require("../lib/prisma");
const logger  = require("../lib/logger");

/**
 * [REDACTED] Real implementation computes rolling volatility from BTC closes,
 * compares it against a calibrated baseline, and classifies into
 * STRESS / QUIET_BULLISH / QUIET_BEARISH with a confidence score. The
 * specific thresholds and scoring formula are not shown publicly.
 *
 * @param {RollingWindowState} state
 * @param {string} signalConfigId
 */
async function computeAndWriteRegime(state, signalConfigId) {
  try {
    const closes = state.btcClosesForRegime();

    if (closes.length < 3) {
      logger.debug("[regime.job] Insufficient bars for regime computation", { bars: closes.length });
      return;
    }

    // [REDACTED] volatility computation, stress index, and classification
    const state_type = "QUIET_BULLISH";
    const confidence = 0.5;
    const btcStressIndex = 0;
    const transitionProb = 0;

    logger.info("[regime.job] Regime computed", {
      state: state_type,
      confidence: confidence.toFixed(3),
      bars: closes.length,
    });

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.regimeState.updateMany({
        where: { signalConfigId, validTo: null },
        data:  { validTo: now },
      });

      await tx.regimeState.create({
        data: {
          signalConfigId,
          state:          state_type,
          confidence,
          hmmState:       state_type === "STRESS" ? 1 : state_type === "QUIET_BEARISH" ? 2 : 3,
          btcStressIndex,
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
