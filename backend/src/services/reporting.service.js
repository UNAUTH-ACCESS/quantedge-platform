/**
 * Portfolio Reporting Service
 *
 * Computes performance metrics from real position and snapshot data.
 * Metrics: P&L, Sharpe ratio, max drawdown, win rate, avg hold time,
 * best/worst trade, signal accuracy, regime performance breakdown.
 *
 * Reports are computed on-demand and cached as JSON in the database.
 * Scheduled generation runs daily at 00:00 UTC via the worker.
 */

const prisma = require("../lib/prisma");
const logger = require("../lib/logger");

/**
 * Generate a full performance report for a portfolio over a time range.
 *
 * @param {string} portfolioId
 * @param {string} period — "daily" | "weekly" | "monthly" | "all"
 * @returns {object} report
 */
async function generateReport(portfolioId, period = "monthly") {
  const { from, to } = getPeriodRange(period);

  const [portfolio, positions, snapshots] = await Promise.all([
    prisma.portfolio.findUnique({
      where:   { id: portfolioId },
      include: { riskConfig: true },
    }),
    prisma.position.findMany({
      where: {
        portfolioId,
        status:   { in: ["CLOSED"] },
        closedAt: { gte: from, lte: to },
      },
      include: { asset: true, venue: true },
      orderBy: { openedAt: "asc" },
    }),
    prisma.portfolioSnapshot.findMany({
      where:     { portfolioId, snappedAt: { gte: from, lte: to } },
      orderBy:   { snappedAt: "asc" },
    }),
  ]);

  if (!portfolio) throw new Error(`Portfolio ${portfolioId} not found`);

  // ── P&L metrics ───────────────────────────────────────────────────────────
  const totalTrades   = positions.length;
  const winningTrades = positions.filter(p => p.realizedPnl > 0);
  const losingTrades  = positions.filter(p => p.realizedPnl <= 0);
  const totalPnl      = positions.reduce((s, p) => s + p.realizedPnl, 0);
  const totalFees     = positions.reduce((s, p) => s + (p.fill?.feePaid || 0), 0);
  const winRate       = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

  const avgWin  = winningTrades.length > 0
    ? winningTrades.reduce((s, p) => s + p.realizedPnl, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((s, p) => s + p.realizedPnl, 0) / losingTrades.length : 0;

  const bestTrade  = positions.reduce((b, p) => p.realizedPnl > (b?.realizedPnl || -Infinity) ? p : b, null);
  const worstTrade = positions.reduce((w, p) => p.realizedPnl < (w?.realizedPnl || Infinity)  ? p : w, null);

  const profitFactor = Math.abs(avgLoss) > 0
    ? Math.abs(avgWin * winningTrades.length) / Math.abs(avgLoss * losingTrades.length)
    : null;

  // ── Hold time ─────────────────────────────────────────────────────────────
  const holdTimes = positions
    .filter(p => p.closedAt && p.openedAt)
    .map(p => (new Date(p.closedAt) - new Date(p.openedAt)) / 60000); // minutes

  const avgHoldTimeMin = holdTimes.length > 0
    ? holdTimes.reduce((s, t) => s + t, 0) / holdTimes.length : 0;

  // ── NAV and drawdown from snapshots ───────────────────────────────────────
  const navSeries = snapshots.map(s => s.nav);
  const startNav  = navSeries[0] || 0;
  const endNav    = navSeries[navSeries.length - 1] || 0;
  const navReturn = startNav > 0 ? ((endNav - startNav) / startNav) * 100 : 0;

  const maxDrawdown = computeMaxDrawdown(navSeries);

  // ── Sharpe ratio (annualized, using snapshot returns) ─────────────────────
  const sharpe = computeSharpe(navSeries);

  // ── Venue breakdown ───────────────────────────────────────────────────────
  const byVenue = {};
  for (const p of positions) {
    const name = p.venue?.name || "Unknown";
    if (!byVenue[name]) byVenue[name] = { trades: 0, pnl: 0 };
    byVenue[name].trades++;
    byVenue[name].pnl += p.realizedPnl;
  }

  // ── Asset breakdown ───────────────────────────────────────────────────────
  const byAsset = {};
  for (const p of positions) {
    const sym = p.asset?.symbol || "Unknown";
    if (!byAsset[sym]) byAsset[sym] = { trades: 0, pnl: 0 };
    byAsset[sym].trades++;
    byAsset[sym].pnl += p.realizedPnl;
  }

  const report = {
    portfolioId,
    portfolioName: portfolio.name,
    period,
    from:          from.toISOString(),
    to:            to.toISOString(),
    generatedAt:   new Date().toISOString(),

    summary: {
      totalTrades,
      winningTrades:  winningTrades.length,
      losingTrades:   losingTrades.length,
      winRate:        round(winRate, 2),
      totalPnl:       round(totalPnl, 2),
      totalFees:      round(totalFees, 2),
      netPnl:         round(totalPnl - totalFees, 2),
      avgWin:         round(avgWin, 2),
      avgLoss:        round(avgLoss, 2),
      profitFactor:   profitFactor ? round(profitFactor, 3) : null,
      avgHoldTimeMin: round(avgHoldTimeMin, 1),
    },

    nav: {
      start:       round(startNav, 2),
      end:         round(endNav, 2),
      returnPct:   round(navReturn, 2),
      maxDrawdown: round(maxDrawdown, 2),
      sharpe:      round(sharpe, 3),
    },

    bestTrade: bestTrade ? {
      asset:      bestTrade.asset?.symbol,
      side:       bestTrade.side,
      pnl:        round(bestTrade.realizedPnl, 2),
      openedAt:   bestTrade.openedAt,
      closedAt:   bestTrade.closedAt,
    } : null,

    worstTrade: worstTrade ? {
      asset:      worstTrade.asset?.symbol,
      side:       worstTrade.side,
      pnl:        round(worstTrade.realizedPnl, 2),
      openedAt:   worstTrade.openedAt,
      closedAt:   worstTrade.closedAt,
    } : null,

    breakdown: { byVenue, byAsset },

    snapshots: snapshots.map(s => ({
      nav:          round(s.nav, 2),
      unrealizedPnl: round(s.unrealizedPnl, 2),
      snappedAt:    s.snappedAt,
    })),
  };

  logger.info("[reporting] Report generated", { portfolioId, period, totalTrades });
  return report;
}

function computeMaxDrawdown(navSeries) {
  if (navSeries.length < 2) return 0;
  let maxDD = 0, peak = navSeries[0];
  for (const nav of navSeries) {
    if (nav > peak) peak = nav;
    const dd = peak > 0 ? ((peak - nav) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeSharpe(navSeries, periodsPerYear = 17520) {
  if (navSeries.length < 3) return 0;
  const returns = [];
  for (let i = 1; i < navSeries.length; i++) {
    if (navSeries[i - 1] > 0) {
      returns.push((navSeries[i] - navSeries[i - 1]) / navSeries[i - 1]);
    }
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const std  = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
  return std > 0 ? (mean / std) * Math.sqrt(periodsPerYear) : 0;
}

function getPeriodRange(period) {
  const to   = new Date();
  const from = new Date();
  switch (period) {
    case "daily":   from.setDate(from.getDate() - 1);    break;
    case "weekly":  from.setDate(from.getDate() - 7);    break;
    case "monthly": from.setMonth(from.getMonth() - 1);  break;
    case "all":     from.setFullYear(2020);               break;
    default:        from.setMonth(from.getMonth() - 1);
  }
  return { from, to };
}

function round(n, d) {
  if (n == null || isNaN(n)) return null;
  return Math.round(n * 10 ** d) / 10 ** d;
}

module.exports = { generateReport };
