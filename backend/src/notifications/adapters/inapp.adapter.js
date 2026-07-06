/**
 * In-App Adapter
 *
 * System of record. Always executes first.
 * Writes to notifications table and fires pg_notify for real-time UI.
 * Never fails silently — errors are logged and re-thrown for dispatcher.
 */

const { Client } = require("pg");
const prisma  = require("../../lib/prisma");
const logger  = require("../../lib/logger");

async function deliver(notification, delivery) {
  // Notification already exists in DB (created by dispatcher before adapter runs)
  // Just fire pg_notify so the API broadcasts to connected clients
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [
      "notification_new",
      JSON.stringify({
        notificationId: notification.id,
        userId:         notification.userId,
        workspaceId:    notification.workspaceId,
        type:           notification.type,
        priority:       notification.priority,
        title:          notification.title,
        body:           notification.body,
        entityId:       notification.entityId,
        entityType:     notification.entityType,
      }),
    ]);
    logger.debug("[inapp] pg_notify fired", { notificationId: notification.id });
    return { success: true };
  } catch (err) {
    logger.error("[inapp] pg_notify failed", { error: err.message });
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { deliver };
