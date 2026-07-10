const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate, requireWorkspace } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

const VALID_STAGES = [3, 4, 5, 6, 7, 8, 9, 10];

// GET /onboarding — return current onboarding state
router.get("/", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const onboarding = req.workspace.settings?.onboarding || { stage: 3, complete: false, data: {} };
    res.json({ success: true, data: onboarding });
  } catch (err) { next(err); }
});

// POST /onboarding/stage/:n — save stage data and advance
router.post("/stage/:n", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const stage = parseInt(req.params.n);
    if (!VALID_STAGES.includes(stage)) throw new AppError("Invalid stage", 400, "VALIDATION_ERROR");

    const workspaceId = req.workspace.id;
    const current = req.workspace.settings?.onboarding || { stage: 3, complete: false, data: {} };

    // Don't allow skipping stages
    if (stage > current.stage) throw new AppError(`Must complete stage ${current.stage} first`, 400, "STAGE_ORDER");

    const nextStage = stage + 1;
    const complete  = stage === 10;

    const updated = {
      ...current,
      stage:    complete ? 10 : nextStage,
      complete,
      data:     { ...current.data, [`stage${stage}`]: req.body },
    };

    const settings = { ...(req.workspace.settings || {}), onboarding: updated };

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

    // Stage 10 — final legal agreement (e-signature). Record a durable,
    // independent audit trail: typed name, agreement version, IP, timestamp.
    // This is the record that matters if the in-app settings blob is ever
    // edited/reset — the audit log is the actual evidence of consent.
    if (stage === 10) {
      if (!req.body.typedFullName || !req.body.agreed) {
        throw new AppError("Signature and agreement confirmation required", 400, "VALIDATION_ERROR");
      }
      await prisma.auditEvent.create({
        data: {
          workspaceId,
          actorId:     req.user.id,
          entityType:  "Workspace",
          entityId:    workspaceId,
          action:      "E_SIGNATURE",
          beforeState: { complete: false },
          afterState:  {
            typedFullName: req.body.typedFullName,
            agreementVersion: req.body.agreementVersion || "v1",
            agreedAt: new Date().toISOString(),
          },
          ipAddress:   req.ip,
        },
      });
    }

    await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });

    res.json({ success: true, data: { stage: nextStage, complete } });
  } catch (err) { next(err); }
});

// POST /onboarding/reset — dev only
router.post("/reset", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") throw new AppError("Not allowed", 403, "FORBIDDEN");
    const settings = { ...(req.workspace.settings || {}), onboarding: { stage: 3, complete: false, data: {} } };
    await prisma.workspace.update({ where: { id: req.workspace.id }, data: { settings } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
