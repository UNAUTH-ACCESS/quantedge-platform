/**
 * ⚠️  PUBLIC REPO NOTICE: this file orchestrates signal evaluation across
 * portfolios (fetching configs, calling into risk logic, creating trade
 * proposals, and notifying). The actual sizing/risk math lives in
 * risk.service.js, which is redacted separately in this public copy. Venue
 * preference ordering below has been generalized as an extra precaution.
 */

const prisma = require("../lib/prisma");
const riskService = require("./risk.service");
const logger = require("../lib/logger");

// Called after a Signal is created.
// Finds all portfolios running the SignalConfig, evaluates each independently.
async function evaluateSignal(signal) {
  logger.info("Evaluating signal across portfolios", { signalId: signal.id, asset: signal.assetId });

  const portfolioConfigs = await prisma.portfolioSignalConfig.findMany({
    where: { signalConfigId: signal.signalConfigId, active: true },
    include: {
      portfolio: {
        include: {
          riskConfig: true,
          wallets: { include: { wallet: { include: { chain: true } } } },
        },
      },
    },
  });

  const results = [];

  for (const pc of portfolioConfigs) {
    const portfolio = pc.portfolio;
    const riskConfig = portfolio.riskConfig;

    if (!riskConfig) {
      logger.warn("Portfolio has no RiskConfig — skipping", { portfolioId: portfolio.id });
      continue;
    }

    const latestSnapshot = await prisma.portfolioSnapshot.findFirst({
      where: { portfolioId: portfolio.id },
      orderBy: { snappedAt: "desc" },
    });

    // Risk evaluation — see risk.service.js (redacted)
    const evaluation = await riskService.evaluateSignalForPortfolio(
      signal, portfolio, riskConfig, latestSnapshot
    );

    const asset = await prisma.asset.findUnique({ where: { id: signal.assetId } });
    const venue = await getBestVenue(signal, asset);
    const wallet = getBestWallet(portfolio.wallets, venue);

    let tradeProposalId = null;

    if (evaluation.approved && wallet && venue) {
      const proposal = await prisma.tradeProposal.create({
        data: {
          signalId: signal.id,
          portfolioId: portfolio.id,
          walletId: wallet.wallet.id,
          venueId: venue.id,
          assetId: signal.assetId,
          direction: signal.direction,
          notional: evaluation.notionalApplied,
          estEntry: await getMockPrice(asset.symbol),
          estFeeBps: venue.feeBps,
          estSlippageBps: 0.5,
          status: "PENDING",
        },
      });
      tradeProposalId = proposal.id;
      logger.info("TradeProposal created", { proposalId: proposal.id, portfolioId: portfolio.id });
    }

    const evalRecord = await prisma.portfolioSignalEvaluation.create({
      data: {
        signalId: signal.id,
        portfolioId: portfolio.id,
        evaluationStatus: evaluation.approved ? "APPROVED" : "BLOCKED",
        blockReason: evaluation.reason,
        kellySizeApplied: evaluation.kellySizeApplied,
        notionalApplied: evaluation.notionalApplied,
        tradeProposalId,
      },
    });

    results.push(evalRecord);

    await prisma.notification.create({
      data: {
        workspaceId: portfolio.workspaceId,
        userId: (await prisma.workspace.findUnique({ where: { id: portfolio.workspaceId }, select: { ownerId: true } })).ownerId,
        type: "SIGNAL",
        title: evaluation.approved
          ? `Signal: ${asset?.symbol} ${signal.direction}`
          : `Signal blocked: ${asset?.symbol}`,
        body: evaluation.approved
          ? `Strength ${signal.strength.toFixed(2)} — proposal ready for execution`
          : `Blocked: ${evaluation.reason}`,
      },
    });
  }

  await prisma.signal.update({
    where: { id: signal.id },
    data: { status: "ACTIVE" },
  });

  return results;
}

async function getBestVenue(signal, asset) {
  // [REDACTED] Real venue preference ordering per asset/chain.
  return prisma.venue.findFirst({
    where: { active: true },
    orderBy: { feeBps: "asc" },
  });
}

function getBestWallet(portfolioWallets, venue) {
  if (!venue) return null;
  return portfolioWallets.find(
    (pw) => pw.wallet.chain.id === venue.chainId && pw.wallet.status === "CONNECTED"
  ) || portfolioWallets[0];
}

async function getMockPrice(symbol) {
  const prices = { SOL: 142.30, BTC: 67240.00, ETH: 3482.10 };
  return prices[symbol] || 100;
}

module.exports = { evaluateSignal };
