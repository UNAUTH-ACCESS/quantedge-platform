const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate, requireWorkspace } = require("../../../middleware/auth");
const { assertSignalAccess, getUserPortfolioIds } = require("../../../middleware/ownership");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /signals — all signals for workspace (via portfolio membership)
router.get("/", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId: req.workspace.id },
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
    await assertSignalAccess(req.params.id, req.user.id);

    const signal = await prisma.signal.findUnique({
      where: { id: req.params.id },
      include: { asset: true, signalConfig: { include: { strategy: true } }, evaluations: { include: { tradeProposal: true } } },
    });
    res.json({ success: true, data: signal });
  } catch (err) { next(err); }
});

// GET /signals/:id/evaluations
router.get("/:id/evaluations", authenticate, async (req, res, next) => {
  try {
    await assertSignalAccess(req.params.id, req.user.id);

    // Scope to only the requesting user's own portfolios — otherwise this
    // leaked every other workspace's evaluations for the same signal,
    // including their trade sizing and wallet details.
    const portfolioIds = await getUserPortfolioIds(req.user.id);

    const evaluations = await prisma.portfolioSignalEvaluation.findMany({
      where: { signalId: req.params.id, portfolioId: { in: portfolioIds } },
      include: { portfolio: true, tradeProposal: { include: { venue: true, wallet: true } } },
      orderBy: { evaluatedAt: "desc" },
    });
    res.json({ success: true, data: evaluations });
  } catch (err) { next(err); }
});

// GET /signals/regime/current — current regime state
router.get("/regime/current", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const portfolios = await prisma.portfolio.findMany({ where: { workspaceId: req.workspace.id }, select: { id: true } });
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
