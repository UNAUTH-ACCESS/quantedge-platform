/**
 * Email Adapter — Resend API
 *
 * Sends transactional emails for HIGH and CRITICAL notifications.
 * Plain structured text, no heavy HTML.
 * Sender configured via FROM_EMAIL env var, verified domain required in Resend.
 */

const logger = require("../../lib/logger");

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_ADDRESS   = process.env.FROM_EMAIL || "QuantEdge <onboarding@resend.dev>";
const APP_URL        = `https://${process.env.DOMAIN || "quantedge.exchange"}`;

async function deliver(notification, userEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  if (!userEmail) throw new Error("No email address for user");

  const { subject, html } = buildEmail(notification);

  const res = await fetch(RESEND_API_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to:      [userEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  logger.info("[email] Delivered", { notificationId: notification.id, resendId: data.id, to: userEmail });
  return { success: true, resendId: data.id };
}

function buildEmail(notification) {
  const priorityLabel = {
    CRITICAL: "🚨 CRITICAL",
    HIGH:     "⚠️ HIGH",
    MEDIUM:   "📋 MEDIUM",
    LOW:      "ℹ️ LOW",
  }[notification.priority] || notification.priority;

  const subject = `[QuantEdge ${priorityLabel}] ${notification.title}`;

  const deepLink = buildDeepLink(notification.entityType, notification.entityId);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="background:#0A0A0F;color:#E8F4F8;font-family:'Courier New',monospace;padding:32px;margin:0;">
  <div style="max-width:520px;margin:0 auto;">

    <div style="margin-bottom:24px;">
      <span style="font-size:11px;color:#5A6478;letter-spacing:0.1em;text-transform:uppercase;">QuantEdge Alert</span>
    </div>

    <div style="background:#111118;border:1px solid #1E1E2E;border-radius:6px;padding:20px;margin-bottom:16px;">
      <div style="font-size:11px;color:#5A6478;margin-bottom:8px;letter-spacing:0.06em;text-transform:uppercase;">
        ${notification.type} · ${priorityLabel}
      </div>
      <div style="font-size:16px;font-weight:600;margin-bottom:12px;color:#E8F4F8;">
        ${notification.title}
      </div>
      <div style="font-size:13px;color:#9BA8B4;line-height:1.6;">
        ${notification.body}
      </div>
    </div>

    <div style="margin-bottom:24px;">
      <div style="font-size:10px;color:#5A6478;">
        ${new Date().toUTCString()}
      </div>
    </div>

    ${deepLink ? `
    <a href="${APP_URL}${deepLink}"
       style="display:inline-block;background:#00D4AA;color:#0A0A0F;padding:10px 20px;
              border-radius:4px;font-size:12px;font-weight:700;text-decoration:none;
              letter-spacing:0.04em;">
      View in QuantEdge →
    </a>
    ` : ""}

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1E1E2E;
                font-size:10px;color:#5A6478;">
      You are receiving this because you have email notifications enabled for your workspace.
      Manage preferences at ${APP_URL.replace("https://", "")}/settings
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

function buildDeepLink(entityType, entityId) {
  const paths = {
    TradeProposal: "/proposals",
    Position:      "/positions",
    Signal:        "/signals",
    Portfolio:     "/portfolio",
  };
  return paths[entityType] || "/dashboard";
}

module.exports = { deliver };
