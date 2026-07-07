const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate, requireWorkspace } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /audit
router.get("/", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const { entity, from, to, limit = 100, offset = 0 } = req.query;

    const where = {
      workspaceId: req.workspace.id,
      ...(entity ? { entityType: entity } : {}),
      ...(from || to ? { ts: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    };

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { ts: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.auditEvent.count({ where }),
    ]);

    res.json({ success: true, data: { events, total } });
  } catch (err) { next(err); }
});

// GET /audit/notifications
router.get("/notifications", authenticate, async (req, res, next) => {
  try {
    const { unread } = req.query;
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user.id,
        ...(unread === "true" ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ success: true, data: notifications });
  } catch (err) { next(err); }
});

// PATCH /audit/notifications/:id/read
router.patch("/notifications/:id/read", authenticate, async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification || notification.userId !== req.user.id) {
      throw new AppError("Not found", 404, "NOT_FOUND");
    }
    await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
