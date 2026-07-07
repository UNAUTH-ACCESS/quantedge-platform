const express = require("express");
const prisma   = require("../../../lib/prisma");
const { authenticate, requireWorkspace } = require("../../../middleware/auth");
const { AppError }     = require("../../../middleware/error");

const router = express.Router();

// GET /push/vapid-public-key — frontend needs this to subscribe
router.get("/vapid-public-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ success: false, error: { message: "Push notifications not configured" } });
  res.json({ success: true, data: { publicKey: key } });
});

// POST /push/subscribe — create or update subscription
router.post("/subscribe", authenticate, requireWorkspace, async (req, res, next) => {
  try {
    const { endpoint, p256dh, auth, userAgent } = req.body;
    if (!endpoint || !p256dh || !auth) throw new AppError("endpoint, p256dh, auth required", 400, "BAD_REQUEST");

    const sub = await prisma.pushSubscription.upsert({
      where:  { endpoint },
      update: { p256dh, auth, active: true, updatedAt: new Date() },
      create: {
        userId: req.user.id,
        workspaceId: req.workspace.id,
        endpoint, p256dh, auth,
        userAgent: userAgent || null,
        active: true,
      },
    });

    res.json({ success: true, data: { id: sub.id } });
  } catch (err) { next(err); }
});

// DELETE /push/subscribe — remove subscription
router.delete("/subscribe", authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) throw new AppError("endpoint required", 400, "BAD_REQUEST");
    await prisma.pushSubscription.updateMany({
      where: { endpoint, userId: req.user.id },
      data:  { active: false },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /push/subscriptions — list user's active subscriptions
router.get("/subscriptions", authenticate, async (req, res, next) => {
  try {
    const subs = await prisma.pushSubscription.findMany({
      where:   { userId: req.user.id, active: true },
      select:  { id: true, endpoint: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: subs });
  } catch (err) { next(err); }
});

module.exports = router;
