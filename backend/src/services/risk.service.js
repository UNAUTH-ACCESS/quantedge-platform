/**
 * ⚠️  PUBLIC REPO NOTICE: this is QuantEdge's core risk-gating logic —
 * strength thresholds, drawdown limits, stress-regime exposure caps, and
 * position sizing. The actual thresholds and sizing formula are proprietary
 * and have been redacted from this public copy. The function signature and
 * the categories of checks performed (matching the real implementation) are
 * shown for architecture purposes.
 */

const prisma = require("../lib/prisma");

// Returns { approved: bool, reason: BlockReason | null, kellySizeApplied: float, notionalApplied: float }
async function evaluateSignalForPortfolio(signal, portfolio, riskConfig, latestSnapshot) {
  const nav = latestSnapshot?.nav || 0;

  // 1. Strength threshold check [REDACTED — real threshold comes from riskConfig]
  if (signal.strength < (riskConfig.signalStrengthThreshold ?? 1)) {
    return { approved: false, reason: "BELOW_THRESHOLD", kellySizeApplied: 0, notionalApplied: 0 };
  }

  // 2. Drawdown check — compare latest NAV to inception NAV [REDACTED — real formula]
  const inceptionSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { portfolioId: portfolio.id },
    orderBy: { snappedAt: "asc" },
  });
  if (inceptionSnapshot && nav < inceptionSnapshot.nav) {
    return { approved: false, reason: "DRAWDOWN_BREACH", kellySizeApplied: 0, notionalApplied: 0 };
  }

  // 3. Stress regime exposure cap [REDACTED — real formula]
  const regime = await prisma.regimeState.findFirst({
    where: { signalConfigId: signal.signalConfigId, validTo: null },
  });
  if (regime?.state === "STRESS") {
    return { approved: false, reason: "STRESS_CAP", kellySizeApplied: 0, notionalApplied: 0 };
  }

  // 4. Position sizing — [REDACTED] real implementation combines the
  // signal's Kelly-derived size with portfolio-level caps.
  const kellyApplied = 0;
  const notionalApplied = 0;

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
