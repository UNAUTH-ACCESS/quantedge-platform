/**
 * Feature Computation Module
 *
 * Reads from RollingWindowState and returns the configured feature set with
 * appropriate lags applied, or null if insufficient history.
 *
 * ⚠️  PUBLIC REPO NOTICE: the specific features used, their lag conventions,
 * and the research behind them are QuantEdge's proprietary trading logic
 * and have been redacted from this public copy.
 *
 * Returns null (not an error) when buffers are not yet warm.
 * Caller must handle null by skipping the signal generation cycle.
 */

const logger = require("../../lib/logger");

/**
 * [REDACTED] Real implementation reads specific lagged bars/snapshots from
 * the rolling window and derives a proprietary feature set. Not shown
 * publicly.
 *
 * @param {RollingWindowState} state
 * @returns {object | null}
 */
function computeFeatures(state) {
  if (!state.isReady()) {
    logger.debug("[features] Insufficient history", state.readinessReport());
    return null;
  }

  try {
    // [REDACTED] feature derivation
    const features = {};

    logger.debug("[features] Computed", features);

    return features;

  } catch (err) {
    logger.error("[features] Computation error", { error: err.message });
    return null;
  }
}

module.exports = { computeFeatures };
