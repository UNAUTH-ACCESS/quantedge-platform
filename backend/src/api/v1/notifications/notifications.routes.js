const express = require("express");
const prisma   = require("../../../lib/prisma");
const { authenticate, requirePermission, requireWorkspace } = require("../../../middleware/auth");
const { AppError }     = require("../../../middleware/error");
const { getUserPreferences, setPreference } = require("../../../notifications/preferences");

const router = express.Router();

// GET /notifications — paginated, filterable
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { type, read, limit = 20, cursor } = req.query;
    const workspaceId = req.headers["x-workspace-id"];

    const where = {
      userId: req.user.id,
      ...(workspaceId ? { workspaceId } : {}),
      ...(type  ? { type }              : {}),
      ...(read !== undefined ? { read: read === "true" } : {}),
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    };

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    parseInt(limit) + 1, // fetch one extra to detect next page
    });

    const hasMore = notifications.length > parseInt(limit);
    if (hasMore) notifications.pop();

    const nextCursor = hasMore
      ? notifications[notifications.length - 1]?.createdAt?.toISOString()
      : null;

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user.id, read: false },
    });

    res.json({ success: true, data: { notifications, nextCursor, hasMore, unreadCount } });
  } catch (err) { next(err); }
});

// GET /notifications/unread-count
router.get("/unread-count", authenticate, async (req, res, next) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, read: false },
    });
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read
router.patch("/:id/read", authenticate, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data:  { read: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /notifications/read-all
router.patch("/read-all", authenticate, async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"];
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false, ...(workspaceId ? { workspaceId } : {}) },
      data:  { read: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /notifications/preferences
router.get("/preferences", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const prefs = await getUserPreferences(req.user.id, req.workspace.id);
    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
});

// PUT /notifications/preferences
router.put("/preferences", authenticate, requireWorkspace, requirePermission("view_all"), async (req, res, next) => {
  try {
    const { channel, eventType = "ALL", enabled } = req.body;
    if (!channel || typeof enabled !== "boolean") {
      throw new AppError("channel and enabled required", 400, "BAD_REQUEST");
    }
    // INAPP cannot be disabled
    if (channel === "INAPP") throw new AppError("INAPP channel cannot be disabled", 400, "BAD_REQUEST");

    const pref = await setPreference(req.user.id, req.workspace.id, channel, eventType, enabled);
    res.json({ success: true, data: pref });
  } catch (err) { next(err); }
});

// GET /notifications/delivery-log/:id
router.get("/delivery-log/:id", authenticate, async (req, res, next) => {
  try {
    const notification = await prisma.notification.findFirst({
      where:   { id: req.params.id, userId: req.user.id },
      include: { deliveries: true },
    });
    if (!notification) throw new AppError("Notification not found", 404, "NOT_FOUND");
    res.json({ success: true, data: notification });
  } catch (err) { next(err); }
});

module.exports = router;
