/**
 * Feature Computation Module
 *
 * Drop-in replacement for sampleFeaturesFromDistribution().
 * Reads from RollingWindowState and returns the three validated features
 * with correct lags applied, or null if insufficient history.
 *
 * Features:
 *   btc_change_30m     BTC 30-min return, lagged 2 bars (1 hour back)
 *   bid_ask_imbalance  SOL order book pressure, lagged 1 snapshot (~30 min)
 *   price_change_5m    SOL 5-min return, lagged 2 bars (10 min back at 5m resolution)
 *
 * Lag convention (from validated research):
 *   btc_change_30m:    computed from bar[t-2] close relative to bar[t-3]
 *   bid_ask_imbalance: previous orderbook snapshot (not current)
 *   price_change_5m:   computed from bar[t-2] close relative to bar[t-3] at 5m
 *
 * Returns null (not an error) when buffers are not yet warm.
 * Caller must handle null by skipping the signal generation cycle.
 */

const logger = require("../../lib/logger");

/**
 * @param {RollingWindowState} state
 * @returns {{ btc_change_30m: number, bid_ask_imbalance: number, price_change_5m: number } | null}
 */
function computeFeatures(state) {
  if (!state.isReady()) {
    logger.debug("[features] Insufficient history", state.readinessReport());
    return null;
  }

  try {
    // ── btc_change_30m — lag 2 (1 hour back) ────────────────────────────
    // atOffset(0) = most recent confirmed bar (t)
    // atOffset(1) = t-1
    // atOffset(2) = t-2  ← lagged bar close
    // atOffset(3) = t-3  ← reference close for return computation
    const btcLagged = state.btc30m.atOffset(2);
    const btcRef    = state.btc30m.atOffset(3);

    let btc_change_30m;
    if (btcRef && btcRef.close > 0) {
      btc_change_30m = (btcLagged.close - btcRef.close) / btcRef.close;
    } else {
      // Only 3 bars available — compute return relative to bar[0]
      const btcBar0 = state.btc30m.atOffset(2);
      const btcBar1 = state.btc30m.atOffset(1); // one bar back from lagged
      if (!btcBar1 || btcBar1.close <= 0) return null;
      btc_change_30m = (btcBar0.close - btcBar1.close) / btcBar1.close;
    }

    // ── bid_ask_imbalance — lag 1 (previous snapshot) ────────────────────
    const bid_ask_imbalance = state.orderbook.previous?.imbalance ?? 0;

    // ── price_change_5m — lag 2 at 5m resolution ────────────────────────
    // atOffset(2) = t-2 (10 min back)
    // atOffset(3) = t-3 (15 min back) — reference
    const solLagged = state.sol5m.atOffset(2);
    const solRef    = state.sol5m.atOffset(3);

    let price_change_5m;
    if (solRef && solRef.close > 0) {
      price_change_5m = (solLagged.close - solRef.close) / solRef.close;
    } else {
      const solBar0 = state.sol5m.atOffset(2);
      const solBar1 = state.sol5m.atOffset(1);
      if (!solBar1 || solBar1.close <= 0) return null;
      price_change_5m = (solBar0.close - solBar1.close) / solBar1.close;
    }

    // Clamp all features to [-1, 1] — matches training distribution
    const clamp = (v) => Math.max(-1, Math.min(1, v));

    const features = {
      btc_change_30m:    clamp(btc_change_30m),
      bid_ask_imbalance: clamp(bid_ask_imbalance),
      price_change_5m:   clamp(price_change_5m),
    };

    logger.debug("[features] Computed", {
      btc_change_30m:    features.btc_change_30m.toFixed(4),
      bid_ask_imbalance: features.bid_ask_imbalance.toFixed(4),
      price_change_5m:   features.price_change_5m.toFixed(4),
    });

    return features;

  } catch (err) {
    logger.error("[features] Computation error", { error: err.message });
    return null;
  }
}

module.exports = { computeFeatures };
