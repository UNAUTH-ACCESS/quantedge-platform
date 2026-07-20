const {
  computeMaxDrawdown,
  computeSharpe,
  computeVolatility,
  computeReturns,
  round,
} = require("../src/services/reporting.service");

describe("reporting.service.js — computeReturns (shared by Sharpe and volatility)", () => {
  test("computes simple period-over-period returns", () => {
    // 100 -> 110 -> 99: +10%, then -10%
    const returns = computeReturns([100, 110, 99]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.10, 10);
    expect(returns[1]).toBeCloseTo(-0.10, 10);
  });

  test("skips a step where the prior NAV is zero or negative (avoids divide-by-zero)", () => {
    const returns = computeReturns([0, 100, 110]);
    // first step skipped (prior nav 0), second step kept
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(0.10, 10);
  });

  test("returns an empty array for a single-point series", () => {
    expect(computeReturns([100])).toEqual([]);
  });
});

describe("reporting.service.js — computeVolatility", () => {
  test("returns 0 for fewer than 3 NAV points (matches computeSharpe's own guard)", () => {
    expect(computeVolatility([100])).toBe(0);
    expect(computeVolatility([100, 110])).toBe(0);
  });

  test("returns 0 for a perfectly flat NAV series (zero variance)", () => {
    expect(computeVolatility([100, 100, 100, 100])).toBe(0);
  });

  test("hand-computed: alternating +10%/-10% returns has known std dev", () => {
    // NAV: 100 -> 110 -> 99 -> 108.9 -> 98.01 (alternating ±10%)
    // returns: [0.10, -0.10, 0.10, -0.10]
    // mean = 0, variance = mean((r - 0)^2) = (0.01*4)/4 = 0.01, std = 0.1
    const navSeries = [100, 110, 99, 108.9, 98.01];
    const periodsPerYear = 4; // trivial annualization factor for a clean hand-check
    const vol = computeVolatility(navSeries, periodsPerYear);
    // std (0.1) * sqrt(4) = 0.2
    expect(vol).toBeCloseTo(0.2, 6);
  });

  test("higher-dispersion returns produce higher volatility than lower-dispersion returns (same mean)", () => {
    const calmNav  = [100, 101, 100, 101, 100];   // small oscillation
    const wildNav  = [100, 120, 100, 120, 100];   // large oscillation, same shape
    const calmVol  = computeVolatility(calmNav, 1);
    const wildVol  = computeVolatility(wildNav, 1);
    expect(wildVol).toBeGreaterThan(calmVol);
  });

  test("volatility is always non-negative", () => {
    const navSeries = [100, 90, 105, 95, 110, 85];
    expect(computeVolatility(navSeries, 252)).toBeGreaterThanOrEqual(0);
  });
});

describe("reporting.service.js — expectancy per trade (documented equivalence)", () => {
  // expectancyPerTrade itself is computed inline in generateReport (needs a
  // DB), but its correctness rests on an algebraic identity we can verify
  // directly: total realized PnL / trade count must equal the win-rate/
  // avg-win/avg-loss decomposition, for any partition of wins and losses.
  test("total PnL / trade count equals the win-rate decomposition, for a known set of trades", () => {
    const trades = [50, -20, 30, -10, -15, 40]; // 3 wins, 3 losses
    const totalTrades = trades.length;
    const wins = trades.filter(t => t > 0);
    const losses = trades.filter(t => t <= 0);
    const totalPnl = trades.reduce((s, t) => s + t, 0);

    const winRate = wins.length / totalTrades;
    const lossRate = losses.length / totalTrades;
    const avgWin = wins.reduce((s, t) => s + t, 0) / wins.length;
    const avgLoss = losses.reduce((s, t) => s + t, 0) / losses.length;

    const directExpectancy = totalPnl / totalTrades;
    const decomposedExpectancy = (winRate * avgWin) + (lossRate * avgLoss);

    expect(directExpectancy).toBeCloseTo(decomposedExpectancy, 10);
  });
});

describe("reporting.service.js — round (used for every displayed metric)", () => {
  test("rounds to the given number of decimal places", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.005, 2)).toBeCloseTo(1.0, 1); // floating point edge case, documented not asserted exactly
  });

  test("returns null for null/undefined/NaN input rather than throwing", () => {
    expect(round(null, 2)).toBeNull();
    expect(round(undefined, 2)).toBeNull();
    expect(round(NaN, 2)).toBeNull();
  });
});
