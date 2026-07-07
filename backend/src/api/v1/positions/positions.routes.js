const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate, requireWorkspace } = require("../../../middleware/auth");
const { assertPositionAccess } = require("../../../middleware/ownership");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /positions — all open positions across workspace portfolios
router.get("/", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const { status = "OPEN" } = req.query;

    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId: req.workspace.id },
      select: { id: true },
    });
    const portfolioIds = portfolios.map(p => p.id);

    const positions = await prisma.position.findMany({
      where: { portfolioId: { in: portfolioIds }, status },
      include: { asset: true, venue: true, chain: true, portfolio: true },
      orderBy: { openedAt: "desc" },
    });

    res.json({ success: true, data: positions });
  } catch (err) { next(err); }
});

// GET /positions/settlement-issues — admin visibility into stuck/failed
// settlements (H4). Real user funds can be sitting unresolved here.
router.get("/settlement-issues", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId: req.workspace.id },
      select: { id: true },
    });
    const portfolioIds = portfolios.map(p => p.id);

    const positions = await prisma.position.findMany({
      where: {
        portfolioId: { in: portfolioIds },
        settlementStatus: { in: ["SETTLEMENT_FAILED", "SETTLEMENT_PENDING"] },
      },
      include: { asset: true, venue: true, chain: true, portfolio: { select: { id: true, name: true } } },
      orderBy: { lastSettlementAt: "asc" },
    });

    res.json({ success: true, data: positions });
  } catch (err) { next(err); }
});

// GET /positions/:id
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    await assertPositionAccess(req.params.id, req.user.id);

    const position = await prisma.position.findUnique({
      where: { id: req.params.id },
      include: { asset: true, venue: true, chain: true, fill: { include: { venue: true } }, portfolio: true },
    });
    res.json({ success: true, data: position });
  } catch (err) { next(err); }
});

module.exports = router;
