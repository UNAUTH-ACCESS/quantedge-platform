const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

const VALID_STAGES = [3, 4, 5, 6, 7, 8, 9];

// GET /onboarding — return current onboarding state
router.get("/", authenticate, async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"];
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new AppError("Workspace not found", 404, "NOT_FOUND");
    const onboarding = workspace.settings?.onboarding || { stage: 3, complete: false, data: {} };
    res.json({ success: true, data: onboarding });
  } catch (err) { next(err); }
});

// POST /onboarding/stage/:n — save stage data and advance
router.post("/stage/:n", authenticate, async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"];
    const stage = parseInt(req.params.n);
    if (!VALID_STAGES.includes(stage)) throw new AppError("Invalid stage", 400, "VALIDATION_ERROR");

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new AppError("Workspace not found", 404, "NOT_FOUND");

    const current = workspace.settings?.onboarding || { stage: 3, complete: false, data: {} };

    // Don't allow skipping stages
    if (stage > current.stage) throw new AppError(`Must complete stage ${current.stage} first`, 400, "STAGE_ORDER");

    const nextStage = stage + 1;
    const complete  = stage === 9;

    const updated = {
      ...current,
      stage:    complete ? 9 : nextStage,
      complete,
      data:     { ...current.data, [`stage${stage}`]: req.body },
    };

    const settings = { ...(workspace.settings || {}), onboarding: updated };

    // If Stage 8 — apply capital allocation to portfolio riskConfig
    if (stage === 8 && req.body.stopLossPct) {
      const portfolio = await prisma.portfolio.findFirst({ where: { workspaceId } });
      if (portfolio?.riskConfig?.id) {
        await prisma.riskConfig.update({
          where: { id: portfolio.riskConfig.id },
          data: {
            stopLossPct:          req.body.stopLossPct          ?? undefined,
            maxDrawdownPct:       req.body.maxDrawdownPct       ?? undefined,
            maxPositionPct:       req.body.maxPositionPct       ?? undefined,
            signalStrengthThreshold: req.body.signalStrengthThreshold ?? undefined,
          },
        });
      }
    }

    await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });

    res.json({ success: true, data: { stage: nextStage, complete } });
  } catch (err) { next(err); }
});

// POST /onboarding/reset — dev only
router.post("/reset", authenticate, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") throw new AppError("Not allowed", 403, "FORBIDDEN");
    const workspaceId = req.headers["x-workspace-id"];
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    const settings = { ...(workspace.settings || {}), onboarding: { stage: 3, complete: false, data: {} } };
    await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
