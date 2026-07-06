const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /positions — all open positions across workspace portfolios
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { status = "OPEN" } = req.query;
    const workspaceId = req.headers["x-workspace-id"];

    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId },
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

// GET /positions/:id
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const position = await prisma.position.findUnique({
      where: { id: req.params.id },
      include: { asset: true, venue: true, chain: true, fill: { include: { venue: true } }, portfolio: true },
    });
    if (!position) throw new AppError("Position not found", 404, "NOT_FOUND");
    res.json({ success: true, data: position });
  } catch (err) { next(err); }
});

module.exports = router;
