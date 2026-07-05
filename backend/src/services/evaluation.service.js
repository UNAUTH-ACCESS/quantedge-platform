const prisma = require("../lib/prisma");
const riskService = require("./risk.service");
const logger = require("../lib/logger");

// Called after a Signal is created.
// Finds all portfolios running the SignalConfig, evaluates each independently.
async function evaluateSignal(signal) {
  logger.info("Evaluating signal across portfolios", { signalId: signal.id, asset: signal.assetId });

  // Find all active portfolios running this signal config
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

    // Get latest snapshot for NAV
    const latestSnapshot = await prisma.portfolioSnapshot.findFirst({
      where: { portfolioId: portfolio.id },
      orderBy: { snappedAt: "desc" },
    });

    // Risk evaluation
    const evaluation = await riskService.evaluateSignalForPortfolio(
      signal, portfolio, riskConfig, latestSnapshot
    );

    // Determine best wallet for this signal's asset chain
    const asset = await prisma.asset.findUnique({ where: { id: signal.assetId } });
    const venue = await getBestVenue(signal, asset);
    const wallet = getBestWallet(portfolio.wallets, venue);

    let tradeProposalId = null;

    if (evaluation.approved && wallet && venue) {
      // Create TradeProposal
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

    // Record evaluation
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

    // Audit notification
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

  // Update signal status to ACTIVE once evaluated
  await prisma.signal.update({
    where: { id: signal.id },
    data: { status: "ACTIVE" },
  });

  return results;
}

async function getBestVenue(signal, asset) {
  // SOL asset → prefer Drift (PERP) or Jupiter (SPOT)
  // EVM assets → prefer Hyperliquid (PERP) or 1inch (SPOT)
  const preferredNames = asset?.symbol === "SOL" ? ["Drift", "Jupiter"] : ["Hyperliquid", "1inch"];
  return prisma.venue.findFirst({
    where: { name: { in: preferredNames }, active: true },
    orderBy: { feeBps: "asc" },
  });
}

function getBestWallet(portfolioWallets, venue) {
  if (!venue) return null;
  // Match wallet chain to venue chain
  return portfolioWallets.find(
    (pw) => pw.wallet.chain.id === venue.chainId && pw.wallet.status === "CONNECTED"
  ) || portfolioWallets[0];
}

async function getMockPrice(symbol) {
  const prices = { SOL: 142.30, BTC: 67240.00, ETH: 3482.10 };
  return prices[symbol] || 100;
}

module.exports = { evaluateSignal };
