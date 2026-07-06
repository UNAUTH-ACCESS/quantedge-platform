/**
 * Notification Preferences
 *
 * Resolves which channels to deliver to for a given user,
 * event type, and priority level.
 *
 * Priority rules (cannot be overridden by user preferences):
 *   CRITICAL → all enabled channels
 *   HIGH     → inapp, webpush, email
 *   MEDIUM   → inapp, webpush
 *   LOW      → inapp only
 *
 * User preferences can suppress webpush and email.
 * INAPP is always on — it is the system of record.
 */

const prisma = require("../lib/prisma");

const PRIORITY_CHANNELS = {
  CRITICAL: ["INAPP", "WEBPUSH", "EMAIL"],
  HIGH:     ["INAPP", "WEBPUSH", "EMAIL"],
  MEDIUM:   ["INAPP", "WEBPUSH"],
  LOW:      ["INAPP"],
};

/**
 * Resolve active delivery channels for a user/event/priority combination.
 *
 * @param {string} userId
 * @param {string} workspaceId
 * @param {string} priority
 * @param {string} eventType
 * @returns {Promise<string[]>} array of channel names
 */
async function resolveChannels(userId, workspaceId, priority, eventType) {
  const baseChannels = PRIORITY_CHANNELS[priority] || ["INAPP"];

  // INAPP is always included regardless of preferences
  const alwaysOn = new Set(["INAPP"]);

  // Load user preferences for this workspace
  const prefs = await prisma.notificationPreference.findMany({
    where: {
      userId,
      workspaceId,
      channel: { in: baseChannels.filter(c => c !== "INAPP") },
    },
  });

  const resolved = new Set(["INAPP"]);

  for (const channel of baseChannels) {
    if (alwaysOn.has(channel)) continue;

    // Find specific preference for this event type
    const specific = prefs.find(p => p.channel === channel && p.eventType === eventType);
    // Find general preference (ALL)
    const general  = prefs.find(p => p.channel === channel && p.eventType === "ALL");

    if (specific) {
      if (specific.enabled) resolved.add(channel);
    } else if (general) {
      if (general.enabled) resolved.add(channel);
    } else {
      // Default: enabled for HIGH and CRITICAL, disabled for MEDIUM/LOW on email
      if (channel === "EMAIL" && !["CRITICAL", "HIGH"].includes(priority)) continue;
      resolved.add(channel);
    }
  }

  return [...resolved];
}

/**
 * Get all preferences for a user in a workspace.
 */
async function getUserPreferences(userId, workspaceId) {
  return prisma.notificationPreference.findMany({
    where: { userId, workspaceId },
    orderBy: [{ channel: "asc" }, { eventType: "asc" }],
  });
}

/**
 * Upsert a preference.
 */
async function setPreference(userId, workspaceId, channel, eventType, enabled) {
  return prisma.notificationPreference.upsert({
    where: {
      userId_workspaceId_channel_eventType: {
        userId, workspaceId, channel, eventType,
      },
    },
    update:  { enabled },
    create:  { userId, workspaceId, channel, eventType, enabled },
  });
}

/**
 * Seed default preferences for a new user.
 * Called on workspace join.
 */
async function seedDefaultPreferences(userId, workspaceId) {
  const defaults = [
    { channel: "WEBPUSH", eventType: "ALL",     enabled: true  },
    { channel: "EMAIL",   eventType: "ALL",     enabled: true  },
    { channel: "EMAIL",   eventType: "SIGNAL",  enabled: false },
    { channel: "EMAIL",   eventType: "REGIME",  enabled: false },
  ];

  for (const d of defaults) {
    await prisma.notificationPreference.upsert({
      where: {
        userId_workspaceId_channel_eventType: {
          userId, workspaceId,
          channel:   d.channel,
          eventType: d.eventType,
        },
      },
      update:  {},
      create:  { userId, workspaceId, ...d },
    });
  }
}

module.exports = { resolveChannels, getUserPreferences, setPreference, seedDefaultPreferences };
