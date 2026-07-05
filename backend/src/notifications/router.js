/**
 * Notification Router
 *
 * Public interface for the notification system.
 * All trading engine code calls notify() — never the dispatcher directly.
 *
 * Usage:
 *   const { notify } = require("./notifications/router");
 *   await notify(userId, workspaceId, "TRADE_EXECUTED", { asset, fillPrice, ... });
 *
 * This is the only file other modules need to import.
 */

const logger     = require("../lib/logger");
const { dispatch } = require("./dispatcher");
const { buildNotification } = require("./templates");

/**
 * Route a notification event.
 *
 * @param {string} userId
 * @param {string} workspaceId
 * @param {string} eventType — must match a case in templates.js
 * @param {object} data — event-specific payload
 */
async function notify(userId, workspaceId, eventType, data = {}) {
  try {
    const payload = buildNotification(eventType, data);
    return await dispatch(userId, workspaceId, eventType, payload);
  } catch (err) {
    // Log but never throw — notifications must never crash trading logic
    logger.error("[router] notify() failed", { userId, eventType, error: err.message });
    return null;
  }
}

/**
 * Notify all members of a workspace.
 * Used for workspace-wide events (regime transitions, system alerts).
 */
async function notifyWorkspace(workspaceId, eventType, data = {}) {
  const { PrismaClient } = require("@prisma/client");
  const prisma = require("../lib/prisma");

  try {
    const members = await prisma.membership.findMany({
      where:  { workspaceId, status: "ACTIVE" },
      select: { userId: true },
    });

    const results = await Promise.allSettled(
      members.map(m => notify(m.userId, workspaceId, eventType, data))
    );

    const failed = results.filter(r => r.status === "rejected").length;
    if (failed > 0) {
      logger.warn("[router] Some workspace notifications failed", { workspaceId, eventType, failed });
    }

    return results;
  } catch (err) {
    logger.error("[router] notifyWorkspace() failed", { workspaceId, eventType, error: err.message });
    return null;
  }
}

module.exports = { notify, notifyWorkspace };
