const prisma = require("../lib/prisma");

// Returns { approved: bool, reason: BlockReason | null, kellySizeApplied: float, notionalApplied: float }
async function evaluateSignalForPortfolio(signal, portfolio, riskConfig, latestSnapshot) {
  const nav = latestSnapshot?.nav || 0;

  // 1. Strength threshold
  if (signal.strength < riskConfig.signalStrengthThreshold) {
    return { approved: false, reason: "BELOW_THRESHOLD", kellySizeApplied: 0, notionalApplied: 0 };
  }

  // 2. Drawdown check — compare latest NAV to inception NAV
  const inceptionSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { portfolioId: portfolio.id },
    orderBy: { snappedAt: "asc" },
  });
  if (inceptionSnapshot && nav < inceptionSnapshot.nav) {
    const drawdownPct = ((inceptionSnapshot.nav - nav) / inceptionSnapshot.nav) * 100;
    if (drawdownPct >= riskConfig.maxDrawdownPct) {
      return { approved: false, reason: "DRAWDOWN_BREACH", kellySizeApplied: 0, notionalApplied: 0 };
    }
  }

  // 3. Stress regime cap — check current regime
  const regime = await prisma.regimeState.findFirst({
    where: { signalConfigId: signal.signalConfigId, validTo: null },
  });
  if (regime?.state === "STRESS") {
    const openPositions = await prisma.position.findMany({
      where: { portfolioId: portfolio.id, status: "OPEN" },
    });
    const totalInvested = openPositions.reduce((sum, p) => sum + p.size * p.currentPrice, 0);
    const exposurePct = nav > 0 ? (totalInvested / nav) * 100 : 0;
    if (exposurePct >= riskConfig.stressExposureCapPct) {
      return { approved: false, reason: "STRESS_CAP", kellySizeApplied: 0, notionalApplied: 0 };
    }
  }

  // 4. Position limit — max single position as % of NAV
  const kellyApplied = Math.min(signal.kellySize, riskConfig.kellyFraction);
  const notionalApplied = nav * (riskConfig.maxPositionPct / 100) * kellyApplied;

  if (notionalApplied <= 0) {
    return { approved: false, reason: "INSUFFICIENT_BALANCE", kellySizeApplied: 0, notionalApplied: 0 };
  }

  return { approved: true, reason: null, kellySizeApplied: kellyApplied, notionalApplied };
}

async function recordRiskEvent(portfolioId, type, value, threshold, positionId = null, actionTaken = null) {
  return prisma.riskEvent.create({
    data: { portfolioId, positionId, type, value, threshold, actionTaken },
  });
}

module.exports = { evaluateSignalForPortfolio, recordRiskEvent };
