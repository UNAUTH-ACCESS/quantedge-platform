/**
 * WebSocket Adapter (SSE)
 *
 * Broadcasts real-time events to connected dashboard clients via socket.io.
 * Ephemeral — no delivery log written (intentional per spec).
 * Used for live P&L updates, position changes, order status.
 *
 * Bridges from notification system to existing socket.io infrastructure.
 * Does not duplicate the pg_notify path — this fires in addition to it
 * for clients that are already connected and subscribed.
 */

const logger = require("../../lib/logger");

// Reference to socket.io instance — injected at startup
let _io = null;

function setIo(io) {
  _io = io;
}

async function deliver(notification) {
  if (!_io) {
    logger.debug("[websocket] No socket.io instance — skipping broadcast");
    return { success: true, skipped: true };
  }

  try {
    // Broadcast to user-specific room
    _io.to(`user:${notification.userId}`).emit("notification:new", {
      id:         notification.id,
      type:       notification.type,
      priority:   notification.priority,
      title:      notification.title,
      body:       notification.body,
      entityId:   notification.entityId,
      entityType: notification.entityType,
      createdAt:  notification.createdAt,
    });

    // Also broadcast to workspace room for shared dashboards
    _io.to(`workspace:${notification.workspaceId}`).emit("notification:new", {
      id:         notification.id,
      type:       notification.type,
      priority:   notification.priority,
      title:      notification.title,
      body:       notification.body,
    });

    logger.debug("[websocket] Broadcast sent", { notificationId: notification.id });
    return { success: true };
  } catch (err) {
    logger.warn("[websocket] Broadcast failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

module.exports = { deliver, setIo };
