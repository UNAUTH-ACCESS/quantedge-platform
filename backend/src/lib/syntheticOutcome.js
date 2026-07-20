/**
 * syntheticOutcome.js
 *
 * Test fixture, NOT a real strategy signal. Generates a synthetic exit
 * price against a known win-rate/payoff distribution, so the metrics
 * pipeline (equity curve, drawdown, Sharpe, expectancy, volatility) can be
 * validated against numbers with a known expected shape before trusting it
 * with real-price-derived trades.
 *
 * Statistically shaped, not seeded: each run draws fresh randoms, so exact
 * values differ run to run, but converge toward the configured win rate and
 * payoff ranges over enough trades. Every synthetic fill is stamped
 * fillMethod:"synthetic", wasLive:false in the Fill table - this must never
 * be mistaken for a real-market-derived fill.
 *
 * Gated entirely behind SIM_SYNTHETIC_OUTCOME=true. When unset/false,
 * callers should use deriveFillPrice() (real snapshot / estimate fallback)
 * instead - this module is never consulted.
 *
 * Only affects EXIT price. Entry always goes through the real/fallback
 * deriveFillPrice() path, per design: the "win or loss" of a trade is a
 * property of the exit relative to a real entry, not of the entry itself.
 */

function isSyntheticOutcomeEnabled() {
  return process.env.SIM_SYNTHETIC_OUTCOME === "true";
}

/**
 * @param {number} entryPrice - the position's real (or fallback) entry price
 * @param {"LONG"|"SHORT"|"SPOT"} side
 * @returns {{ exitPrice: number, isWin: boolean, movePct: number }}
 *   movePct is the FAVORABLE move magnitude (always positive for a win,
 *   negative for a loss), independent of side - directional application to
 *   exitPrice accounts for LONG vs SHORT below.
 */
function generateSyntheticExit(entryPrice, side) {
  const winRate = parseFloat(process.env.SIM_SYNTHETIC_WIN_RATE || "0.40");
  const winMinPct = parseFloat(process.env.SIM_SYNTHETIC_WIN_MIN_PCT || "0.02");
  const winMaxPct = parseFloat(process.env.SIM_SYNTHETIC_WIN_MAX_PCT || "0.06");
  const lossMinPct = parseFloat(process.env.SIM_SYNTHETIC_LOSS_MIN_PCT || "0.01");
  const lossMaxPct = parseFloat(process.env.SIM_SYNTHETIC_LOSS_MAX_PCT || "0.03");

  const isWin = Math.random() < winRate;
  const movePct = isWin
    ? winMinPct + Math.random() * (winMaxPct - winMinPct)
    : -(lossMinPct + Math.random() * (lossMaxPct - lossMinPct));

  // LONG/SPOT: a favorable move is price UP -> apply movePct as-is.
  // SHORT: a favorable move is price DOWN -> invert.
  const directionalMove = side === "SHORT" ? -movePct : movePct;
  const exitPrice = entryPrice * (1 + directionalMove);

  return { exitPrice, isWin, movePct };
}

module.exports = { isSyntheticOutcomeEnabled, generateSyntheticExit };
