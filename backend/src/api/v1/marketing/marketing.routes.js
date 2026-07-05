const express = require("express");
const { authenticate, requirePlatformAdmin } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");
const { subscribe, unsubscribe, getSubscribers, sendCampaign } = require("../../../services/marketing.service");

const router = express.Router();

// POST /marketing/subscribe — public endpoint
router.post("/subscribe", async (req, res, next) => {
  try {
    const { email, name, source = "website" } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError("Valid email required", 400, "VALIDATION_ERROR");
    }
    const result = await subscribe(email, name, source);
    res.json({ success: true, data: { status: result.status } });
  } catch (err) { next(err); }
});

// GET /marketing/unsubscribe — handles unsubscribe link click
router.get("/unsubscribe", async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) throw new AppError("Token required", 400, "BAD_REQUEST");
    const result = await unsubscribe(token);
    // Return a simple HTML page
    res.send(`
      <!DOCTYPE html><html>
      <head><meta charset="utf-8"><title>Unsubscribed — QuantEdge</title></head>
      <body style="background:#0A0A0F;color:#E8F4F8;font-family:monospace;
                   display:flex;align-items:center;justify-content:center;
                   min-height:100vh;margin:0;">
        <div style="text-align:center;">
          <div style="font-size:24px;margin-bottom:12px;">✓</div>
          <div style="font-size:16px;margin-bottom:8px;">Unsubscribed</div>
          <div style="font-size:12px;color:#5A6478;">${result.email || "Your email"} has been removed.</div>
        </div>
      </body></html>
    `);
  } catch (err) { next(err); }
});

// POST /marketing/unsubscribe — API version
router.post("/unsubscribe", async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) throw new AppError("Token required", 400, "BAD_REQUEST");
    const result = await unsubscribe(token);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /marketing/subscribers — platform admin only
router.get("/subscribers", authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const { status = "SUBSCRIBED", limit = 100, offset = 0 } = req.query;
    const result = await getSubscribers(status, parseInt(limit), parseInt(offset));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /marketing/campaign — platform admin only, send to all subscribers
router.post("/campaign", authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const { subject, html } = req.body;
    if (!subject || !html) throw new AppError("subject and html required", 400, "BAD_REQUEST");
    const result = await sendCampaign(subject, html);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
