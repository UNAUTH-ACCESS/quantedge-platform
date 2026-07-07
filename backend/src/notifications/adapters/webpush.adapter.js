/**
 * Web Push Adapter
 *
 * Sends browser push notifications via Web Push Protocol (VAPID).
 * Fetches all active push subscriptions for the user and sends to each.
 * Handles expired/invalid subscriptions by deactivating them.
 */

const webpush = require("web-push");
const prisma  = require("../../lib/prisma");
const logger  = require("../../lib/logger");
const config  = require("../../lib/config");

// Configure VAPID on first use
let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;

  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    throw new Error("VAPID keys not configured. Run: node scripts/generate-vapid.js");
  }

  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  vapidConfigured = true;
}

async function deliver(notification) {
  ensureVapid();

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: notification.userId, active: true },
  });

  if (subscriptions.length === 0) {
    logger.debug("[webpush] No active subscriptions", { userId: notification.userId });
    return { success: true, sent: 0 };
  }

  const payload = JSON.stringify({
    title:      notification.title,
    body:       notification.body,
    icon:       "/icon-192.png",
    badge:      "/badge-72.png",
    tag:        notification.id,
    data: {
      notificationId: notification.id,
      entityType:     notification.entityType,
      entityId:       notification.entityId,
      url:            buildDeepLink(notification.entityType, notification.entityId),
    },
  });

  let sent = 0;
  const errors = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 } // 24h TTL
      );
      sent++;
    } catch (err) {
      // 404/410 = subscription expired — deactivate it
      if (err.statusCode === 404 || err.statusCode === 410) {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data:  { active: false },
        });
        logger.info("[webpush] Subscription deactivated (expired)", { subId: sub.id });
      } else {
        errors.push(err.message);
        logger.warn("[webpush] Send failed", { subId: sub.id, error: err.message });
      }
    }
  }

  if (errors.length > 0 && sent === 0) {
    throw new Error(`All push sends failed: ${errors.join(", ")}`);
  }

  logger.info("[webpush] Delivered", { notificationId: notification.id, sent, total: subscriptions.length });
  return { success: true, sent };
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
