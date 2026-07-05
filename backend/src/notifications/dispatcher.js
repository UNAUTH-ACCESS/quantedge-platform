/**
 * Notification Dispatcher
 *
 * Orchestrates the full delivery lifecycle:
 *   1. Creates notification record (system of record)
 *   2. Resolves channels via preference engine
 *   3. Creates delivery records (idempotency guard)
 *   4. Delivers via each adapter
 *   5. Updates delivery status
 *   6. Schedules retries on failure
 *
 * Retry schedule (exponential backoff):
 *   attempt 1 → immediate
 *   attempt 2 → +10 seconds
 *   attempt 3 → +1 minute
 *   attempt 4 → +3 minutes
 *   → FAILED after attempt 4
 *
 * Idempotency: unique constraint on (notificationId, channel)
 * A notification can never be delivered twice to the same channel.
 */

const prisma          = require("../lib/prisma");
const logger          = require("../lib/logger");
const { resolveChannels } = require("./preferences");
const inapp     = require("./adapters/inapp.adapter");
const webpush   = require("./adapters/webpush.adapter");
const email     = require("./adapters/email.adapter");
const websocket = require("./adapters/websocket.adapter");

const RETRY_DELAYS_MS = [0, 10_000, 60_000, 180_000]; // 4 attempts
const MAX_ATTEMPTS    = 4;

const ADAPTERS = {
  INAPP:     inapp,
  WEBPUSH:   webpush,
  EMAIL:     email,
  WEBSOCKET: websocket,
};

/**
 * Dispatch a notification to all resolved channels.
 *
 * @param {string} userId
 * @param {string} workspaceId
 * @param {string} eventType
 * @param {object} payload — from templates.buildNotification()
 */
async function dispatch(userId, workspaceId, eventType, payload) {
  try {
    // 1. Create notification (system of record)
    const notification = await prisma.notification.create({
      data: {
        userId,
        workspaceId,
        type:       payload.type,
        priority:   payload.priority,
        title:      payload.title,
        body:       payload.body,
        entityId:   payload.entityId   || null,
        entityType: payload.entityType || null,
        read:       false,
      },
    });

    logger.info("[dispatcher] Notification created", {
      notificationId: notification.id,
      eventType,
      priority: payload.priority,
    });

    // 2. Resolve channels
    const channels = await resolveChannels(userId, workspaceId, payload.priority, eventType);

    logger.debug("[dispatcher] Channels resolved", { channels, notificationId: notification.id });

    // 3. Create delivery records (idempotency guard)
    for (const channel of channels) {
      await prisma.notificationDelivery.upsert({
        where: {
          notificationId_channel: {
            notificationId: notification.id,
            channel,
          },
        },
        update: {}, // Never update existing — idempotency
        create: {
          notificationId: notification.id,
          channel,
          status:         "PENDING",
          attempts:       0,
          nextRetryAt:    new Date(),
        },
      });
    }

    // 4. Deliver — INAPP always first
    const orderedChannels = [
      "INAPP",
      ...channels.filter(c => c !== "INAPP"),
    ];

    // Get user email for email adapter
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { email: true },
    });

    for (const channel of orderedChannels) {
      await deliverToChannel(notification, channel, user?.email);
    }

    return notification;

  } catch (err) {
    logger.error("[dispatcher] Dispatch failed", { userId, eventType, error: err.message });
    // Never throw — notification failures must not crash the trading engine
    return null;
  }
}

/**
 * Deliver to a single channel, updating delivery record.
 */
async function deliverToChannel(notification, channel, userEmail) {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: {
      notificationId_channel: {
        notificationId: notification.id,
        channel,
      },
    },
  });

  if (!delivery) return;
  if (delivery.status === "DELIVERED") return; // Idempotency guard

  try {
    const adapter = ADAPTERS[channel];
    if (!adapter) throw new Error(`No adapter for channel: ${channel}`);

    if (channel === "EMAIL") {
      await adapter.deliver(notification, userEmail);
    } else {
      await adapter.deliver(notification);
    }

    // Mark delivered
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status:      "DELIVERED",
        attempts:    delivery.attempts + 1,
        deliveredAt: new Date(),
        lastError:   null,
        nextRetryAt: null,
      },
    });

    logger.info("[dispatcher] Delivered", {
      notificationId: notification.id,
      channel,
      attempt: delivery.attempts + 1,
    });

  } catch (err) {
    const attempts = delivery.attempts + 1;
    const isFinal  = attempts >= MAX_ATTEMPTS;

    const nextRetryAt = isFinal
      ? null
      : new Date(Date.now() + RETRY_DELAYS_MS[attempts] || 180_000);

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status:     isFinal ? "FAILED" : "PENDING",
        attempts,
        lastError:  err.message,
        nextRetryAt,
      },
    });

    logger.warn("[dispatcher] Delivery failed", {
      notificationId: notification.id,
      channel,
      attempt: attempts,
      isFinal,
      error: err.message,
    });
  }
}

/**
 * Retry worker — processes all PENDING deliveries past their nextRetryAt.
 * Called on a schedule (every 30 seconds) by the API process.
 */
async function processRetries() {
  const pending = await prisma.notificationDelivery.findMany({
    where: {
      status:     "PENDING",
      attempts:   { gt: 0 }, // Only retries, not initial attempts
      nextRetryAt: { lte: new Date() },
    },
    include: { notification: true },
    take: 50, // Process in batches
  });

  if (pending.length === 0) return;

  logger.info("[dispatcher] Processing retries", { count: pending.length });

  for (const delivery of pending) {
    const user = await prisma.user.findUnique({
      where:  { id: delivery.notification.userId },
      select: { email: true },
    });
    await deliverToChannel(delivery.notification, delivery.channel, user?.email);
  }
}

module.exports = { dispatch, processRetries };
