const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /signals — all signals for workspace (via portfolio membership)
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    // Get workspace from header
    const workspaceId = req.headers["x-workspace-id"];
    if (!workspaceId) throw new AppError("x-workspace-id header required", 400, "BAD_REQUEST");

    // Get signal configs active in this workspace's portfolios
    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const portfolioIds = portfolios.map(p => p.id);

    const signalConfigIds = (await prisma.portfolioSignalConfig.findMany({
      where: { portfolioId: { in: portfolioIds }, active: true },
      select: { signalConfigId: true },
    })).map(psc => psc.signalConfigId);

    const where = {
      signalConfigId: { in: signalConfigIds },
      ...(status ? { status } : {}),
    };

    const [signals, total] = await Promise.all([
      prisma.signal.findMany({
        where,
        include: { asset: true, signalConfig: { include: { strategy: true } }, evaluations: { where: { portfolioId: { in: portfolioIds } } } },
        orderBy: { generatedAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.signal.count({ where }),
    ]);

    res.json({ success: true, data: { signals, total, limit: parseInt(limit), offset: parseInt(offset) } });
  } catch (err) { next(err); }
});

// GET /signals/:id
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const signal = await prisma.signal.findUnique({
      where: { id: req.params.id },
      include: { asset: true, signalConfig: { include: { strategy: true } }, evaluations: { include: { tradeProposal: true } } },
    });
    if (!signal) throw new AppError("Signal not found", 404, "NOT_FOUND");
    res.json({ success: true, data: signal });
  } catch (err) { next(err); }
});

// GET /signals/:id/evaluations
router.get("/:id/evaluations", authenticate, async (req, res, next) => {
  try {
    const evaluations = await prisma.portfolioSignalEvaluation.findMany({
      where: { signalId: req.params.id },
      include: { portfolio: true, tradeProposal: { include: { venue: true, wallet: true } } },
      orderBy: { evaluatedAt: "desc" },
    });
    res.json({ success: true, data: evaluations });
  } catch (err) { next(err); }
});

// GET /signals/regime/current — current regime state
router.get("/regime/current", authenticate, async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"];
    const portfolios = await prisma.portfolio.findMany({ where: { workspaceId }, select: { id: true } });
    const portfolioIds = portfolios.map(p => p.id);
    const psc = await prisma.portfolioSignalConfig.findFirst({ where: { portfolioId: { in: portfolioIds }, active: true } });
    if (!psc) throw new AppError("No active signal config", 404, "NOT_FOUND");

    const regime = await prisma.regimeState.findFirst({
      where: { signalConfigId: psc.signalConfigId, validTo: null },
    });
    res.json({ success: true, data: regime });
  } catch (err) { next(err); }
});

module.exports = router;
