import { create } from "zustand";
import { audit as auditApi } from "../api/endpoints";
import client from "../api/client";

const useNotificationStore = create((set, get) => ({
  notifications:  [],
  unreadCount:    0,
  hasMore:        false,
  nextCursor:     null,
  loading:        false,
  initialized:    false,

  // Fetch initial page
  init: async (workspaceId) => {
    if (get().initialized) return;
    set({ loading: true });
    try {
      const res = await client.get("/notifications", {
        params:  { limit: 20 },
        headers: { "x-workspace-id": workspaceId },
      });
      const { notifications, nextCursor, hasMore, unreadCount } = res.data.data;
      set({ notifications, nextCursor, hasMore, unreadCount, initialized: true });
    } catch {
      // Silently fail — notification center is non-critical
    } finally {
      set({ loading: false });
    }
  },

  // Load next page (infinite scroll)
  loadMore: async (workspaceId) => {
    const { nextCursor, loading, hasMore } = get();
    if (loading || !hasMore || !nextCursor) return;
    set({ loading: true });
    try {
      const res = await client.get("/notifications", {
        params:  { limit: 20, cursor: nextCursor },
        headers: { "x-workspace-id": workspaceId },
      });
      const { notifications, nextCursor: nc, hasMore: hm } = res.data.data;
      set(s => ({
        notifications: [...s.notifications, ...notifications],
        nextCursor:    nc,
        hasMore:       hm,
      }));
    } catch {}
    finally { set({ loading: false }); }
  },

  // Called when socket emits notification:new
  addLive: (notification) => {
    set(s => ({
      notifications: [notification, ...s.notifications],
      unreadCount:   s.unreadCount + 1,
    }));
  },

  // Mark one as read
  markRead: async (id, workspaceId) => {
    try {
      await client.patch(`/notifications/${id}/read`, {}, {
        headers: { "x-workspace-id": workspaceId },
      });
      set(s => ({
        notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
        unreadCount:   Math.max(0, s.unreadCount - 1),
      }));
    } catch {}
  },

  // Mark all as read
  markAllRead: async (workspaceId) => {
    try {
      await client.patch("/notifications/read-all", {}, {
        headers: { "x-workspace-id": workspaceId },
      });
      set(s => ({
        notifications: s.notifications.map(n => ({ ...n, read: true })),
        unreadCount:   0,
      }));
    } catch {}
  },

  setUnreadCount: (count) => set({ unreadCount: count }),
}));

export default useNotificationStore;
