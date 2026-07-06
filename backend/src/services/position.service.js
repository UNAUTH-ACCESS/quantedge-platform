const prisma = require("../lib/prisma");
const logger = require("../lib/logger");

// Called after a Fill is recorded — creates or updates Position
async function upsertPositionFromFill(fill, proposal) {
  const side =
    fill.direction === "LONG" ? "LONG" :
    fill.direction === "SHORT" ? "SHORT" : "SPOT";

  const existingPosition = await prisma.position.findFirst({
    where: {
      portfolioId: proposal.portfolioId,
      assetId: fill.assetId,
      venueId: fill.venueId,
      status: "OPEN",
    },
  });

  if (existingPosition) {
    // Average into existing position
    const totalSize = existingPosition.size + fill.fillSize;
    const avgEntry =
      (existingPosition.entryPrice * existingPosition.size + fill.fillPrice * fill.fillSize) / totalSize;

    const updated = await prisma.position.update({
      where: { id: existingPosition.id },
      data: {
        size: totalSize,
        entryPrice: avgEntry,
        currentPrice: fill.fillPrice,
        unrealizedPnl: calculateUnrealizedPnl(side, totalSize, avgEntry, fill.fillPrice),
      },
      include: { asset: true, venue: true },
    });

    logger.info("Position averaged into", { positionId: updated.id, size: totalSize });
    return updated;
  }

  // Create new position
  const position = await prisma.position.create({
    data: {
      portfolioId: proposal.portfolioId,
      assetId: fill.assetId,
      venueId: fill.venueId,
      chainId: proposal.wallet.chainId,
      fillId: fill.id,
      side,
      size: fill.fillSize,
      entryPrice: fill.fillPrice,
      currentPrice: fill.fillPrice,
      unrealizedPnl: 0,
      realizedPnl: 0,
      status: "OPEN",
    },
    include: { asset: true, venue: true, chain: true },
  });

  logger.info("Position created", { positionId: position.id, asset: fill.assetId });
  return position;
}

// Called by market feed on price updates
async function updatePositionPrices(priceMap) {
  // priceMap = { SOL: 145.20, BTC: 68100, ETH: 3510 }
  const openPositions = await prisma.position.findMany({
    where: { status: "OPEN" },
    include: { asset: true },
  });

  for (const position of openPositions) {
    const newPrice = priceMap[position.asset.symbol];
    if (!newPrice) continue;

    const unrealizedPnl = calculateUnrealizedPnl(
      position.side, position.size, position.entryPrice, newPrice
    );

    await prisma.position.update({
      where: { id: position.id },
      data: { currentPrice: newPrice, unrealizedPnl },
    });
  }
}

function calculateUnrealizedPnl(side, size, entryPrice, currentPrice) {
  if (side === "SHORT") {
    return (entryPrice - currentPrice) * size;
  }
  return (currentPrice - entryPrice) * size;
}

// Update portfolio snapshot with current NAV
async function snapshotPortfolio(portfolioId) {
  const positions = await prisma.position.findMany({
    where: { portfolioId, status: "OPEN" },
  });

  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const invested = positions.reduce((sum, p) => sum + p.size * p.entryPrice, 0);

  const lastSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: { portfolioId },
    orderBy: { snappedAt: "desc" },
  });

  const realizedPnl = lastSnapshot?.realizedPnl || 0;
  const nav = (lastSnapshot?.cash || 70500) + unrealizedPnl + realizedPnl;

  return prisma.portfolioSnapshot.create({
    data: { portfolioId, nav, invested, unrealizedPnl, realizedPnl, cash: nav - invested },
  });
}

module.exports = { upsertPositionFromFill, updatePositionPrices, snapshotPortfolio };
