const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate, requireWorkspace } = require("../../../middleware/auth");
const { assertPortfolioAccess } = require("../../../middleware/ownership");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /portfolios
router.get("/", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    // req.workspace is set by requireWorkspace only after verifying real
    // ACTIVE membership — never trust the raw x-workspace-id header directly.
    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId: req.workspace.id },
      include: {
        wallets: { include: { wallet: { include: { chain: true } } } },
        riskConfig: true,
        signalConfigs: { where: { active: true }, include: { signalConfig: { include: { strategy: true } } } },
        _count: { select: { positions: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const portfoliosWithNav = await Promise.all(portfolios.map(async (p) => {
      const snapshot = await prisma.portfolioSnapshot.findFirst({
        where: { portfolioId: p.id },
        orderBy: { snappedAt: "desc" },
      });
      return { ...p, latestSnapshot: snapshot };
    }));

    res.json({ success: true, data: portfoliosWithNav });
  } catch (err) { next(err); }
});

// GET /portfolios/:id
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    await assertPortfolioAccess(req.params.id, req.user.id);

    const portfolio = await prisma.portfolio.findUnique({
      where: { id: req.params.id },
      include: {
        wallets: { include: { wallet: { include: { chain: true } } } },
        riskConfig: true,
        signalConfigs: { include: { signalConfig: { include: { strategy: true } } } },
      },
    });

    const snapshot = await prisma.portfolioSnapshot.findFirst({
      where: { portfolioId: portfolio.id },
      orderBy: { snappedAt: "desc" },
    });

    res.json({ success: true, data: { ...portfolio, latestSnapshot: snapshot } });
  } catch (err) { next(err); }
});

// GET /portfolios/:id/snapshots
router.get("/:id/snapshots", authenticate, async (req, res, next) => {
  try {
    await assertPortfolioAccess(req.params.id, req.user.id);

    const { from, to, limit = 100 } = req.query;
    const snapshots = await prisma.portfolioSnapshot.findMany({
      where: {
        portfolioId: req.params.id,
        ...(from ? { snappedAt: { gte: new Date(from) } } : {}),
        ...(to ? { snappedAt: { lte: new Date(to) } } : {}),
      },
      orderBy: { snappedAt: "asc" },
      take: parseInt(limit),
    });
    res.json({ success: true, data: snapshots });
  } catch (err) { next(err); }
});

// GET /portfolios/:id/positions
router.get("/:id/positions", authenticate, async (req, res, next) => {
  try {
    await assertPortfolioAccess(req.params.id, req.user.id);

    const { status } = req.query;
    const positions = await prisma.position.findMany({
      where: { portfolioId: req.params.id, ...(status ? { status } : {}) },
      include: { asset: true, venue: true, chain: true, fill: true },
      orderBy: { openedAt: "desc" },
    });
    res.json({ success: true, data: positions });
  } catch (err) { next(err); }
});

// GET /portfolios/:id/risk-config
router.get("/:id/risk-config", authenticate, async (req, res, next) => {
  try {
    await assertPortfolioAccess(req.params.id, req.user.id);

    const config = await prisma.riskConfig.findUnique({ where: { portfolioId: req.params.id } });
    if (!config) throw new AppError("Risk config not found", 404, "NOT_FOUND");
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

// PATCH /portfolios/:id/risk-config
router.patch("/:id/risk-config", authenticate, async (req, res, next) => {
  try {
    // Permission checked against THIS portfolio's real workspace, not a
    // client-supplied header — closes the write-capable IDOR.
    await assertPortfolioAccess(req.params.id, req.user.id, { permission: "manage_portfolios" });

    const { maxPositionPct, stopLossPct, kellyFraction, maxDrawdownPct, stressExposureCapPct, signalStrengthThreshold } = req.body;
    const config = await prisma.riskConfig.update({
      where: { portfolioId: req.params.id },
      data: {
        ...(maxPositionPct !== undefined ? { maxPositionPct } : {}),
        ...(stopLossPct !== undefined ? { stopLossPct } : {}),
        ...(kellyFraction !== undefined ? { kellyFraction } : {}),
        ...(maxDrawdownPct !== undefined ? { maxDrawdownPct } : {}),
        ...(stressExposureCapPct !== undefined ? { stressExposureCapPct } : {}),
        ...(signalStrengthThreshold !== undefined ? { signalStrengthThreshold } : {}),
      },
    });
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

// GET /portfolios/:id/auto-execute
const { setAutoExecute, isAutoExecuteEnabled } = require("../../../services/autosign.service");

router.get("/:id/auto-execute", authenticate, async (req, res, next) => {
  try {
    await assertPortfolioAccess(req.params.id, req.user.id);
    const enabled = await isAutoExecuteEnabled(req.params.id);
    res.json({ success: true, data: { autoExecute: enabled } });
  } catch (err) { next(err); }
});

// PATCH /portfolios/:id/auto-execute — enable/disable auto-execution
router.patch("/:id/auto-execute", authenticate, async (req, res, next) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") throw new AppError("enabled must be boolean", 400, "BAD_REQUEST");

    const portfolio = await assertPortfolioAccess(req.params.id, req.user.id, { permission: "manage_portfolios" });
    await setAutoExecute(portfolio.workspaceId, enabled);

    await prisma.auditEvent.create({
      data: {
        workspaceId: portfolio.workspaceId,
        actorId:     req.user.id,
        entityType:  "Portfolio",
        entityId:    portfolio.id,
        action:      "UPDATE",
        beforeState: { autoExecute: !enabled },
        afterState:  { autoExecute: enabled },
        ipAddress:   req.ip,
      },
    });

    res.json({ success: true, data: { autoExecute: enabled } });
  } catch (err) { next(err); }
});

module.exports = router;
