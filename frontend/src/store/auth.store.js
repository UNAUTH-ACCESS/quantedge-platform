import { create } from "zustand";
import { auth as authApi } from "../api/endpoints";
import { getOrCreateDeviceId } from "../lib/device";

// Clears auth-specific keys only — qe_device_id must survive logout/invalid-
// token cases, since it identifies the physical device across sessions,
// not the current login (Stage 11 device tracking would otherwise treat
// every post-logout login as a brand-new device, forever).
function clearAuthStorage() {
  localStorage.removeItem("qe_access_token");
  localStorage.removeItem("qe_refresh_token");
  localStorage.removeItem("qe_user_id");
  localStorage.removeItem("qe_workspace_id");
}

const useAuthStore = create((set, get) => ({
  user:        null,
  workspaces:  [],
  activeWorkspace: null,
  accessToken: localStorage.getItem("qe_access_token"),
  // A stored token means we WERE logged in, but user/workspaces only ever
  // live in memory — start as "authenticating" so RouteGuard shows a loading
  // state instead of rendering with a null user, until bootstrap() (called
  // once on app mount) confirms the token and fetches fresh data.
  status:      localStorage.getItem("qe_access_token") ? "authenticating" : "unauthenticated",
  // status: unauthenticated | authenticating | authenticated | error

  // Refetches fresh user/workspaces from the server using the stored token.
  // Call once on app mount. Clears everything and forces re-login if the
  // token turns out to be invalid/expired.
  bootstrap: async () => {
    const token = localStorage.getItem("qe_access_token");
    if (!token) {
      set({ status: "unauthenticated" });
      return;
    }
    try {
      const { data } = await authApi.me();
      const { user, workspaces } = data.data;
      const storedWorkspaceId = localStorage.getItem("qe_workspace_id");
      const active = workspaces.find(w => w.id === storedWorkspaceId) || workspaces[0] || null;
      if (active) localStorage.setItem("qe_workspace_id", active.id);
      set({ user, workspaces, activeWorkspace: active, accessToken: token, status: "authenticated" });
    } catch {
      clearAuthStorage();
      set({ user: null, workspaces: [], activeWorkspace: null, accessToken: null, status: "unauthenticated" });
    }
  },

  login: async (email, password) => {
    set({ status: "authenticating", error: null });
    try {
      const { data } = await authApi.login(email, password, getOrCreateDeviceId());

      if (data.data.requires2FA) {
        // Don't set status:authenticated yet — caller (LoginPage) shows a
        // code-entry step and calls verify2FA with this pendingToken.
        set({ status: "unauthenticated", error: null });
        return { ok: true, requires2FA: true, pendingToken: data.data.pendingToken };
      }

      const { accessToken, refreshToken, user, workspaces } = data.data;
      get()._applySession(accessToken, refreshToken, user, workspaces);
      return { ok: true };
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || "Login failed";
      set({ status: "error", error: message });
      return { ok: false, error: message };
    }
  },

  verify2FA: async (pendingToken, code) => {
    set({ status: "authenticating", error: null });
    try {
      const { data } = await authApi.verify2FALogin(pendingToken, code, getOrCreateDeviceId());
      const { accessToken, refreshToken, user, workspaces } = data.data;
      get()._applySession(accessToken, refreshToken, user, workspaces);
      return { ok: true };
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || "Invalid code";
      set({ status: "unauthenticated", error: message });
      return { ok: false, error: message };
    }
  },

  // Shared by login() and verify2FA() — populates full session state once
  // real tokens are issued, from either path.
  _applySession: (accessToken, refreshToken, user, workspaces) => {
    localStorage.setItem("qe_access_token",  accessToken);
    localStorage.setItem("qe_refresh_token", refreshToken);
    localStorage.setItem("qe_user_id",       user.id);

    const active = workspaces[0];
    if (active) localStorage.setItem("qe_workspace_id", active.id);

    set({
      user,
      workspaces,
      activeWorkspace: active || null,
      accessToken,
      status: "authenticated",
      error: null,
    });
  },

  register: async (email, password, name, workspaceName) => {
    set({ status: "authenticating", error: null });
    try {
      await authApi.register(email, password, name, workspaceName);
      // Registration succeeded — log in normally so full state (workspaces,
      // roles, etc.) populates through the same tested path as a real login,
      // rather than hand-reconstructing partial state from register's response.
      return await get().login(email, password);
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || "Registration failed";
      set({ status: "error", error: message });
      return { ok: false, error: message };
    }
  },

  // Called after successful email verification to update local state
  // without requiring a full re-login.
  markEmailVerified: () => {
    set((state) => ({ user: state.user ? { ...state.user, emailVerified: true } : state.user }));
  },

  setTwoFactorEnabled: (enabled) => {
    set((state) => ({ user: state.user ? { ...state.user, twoFactorEnabled: enabled } : state.user }));
  },

  logout: async () => {
    try {
      const refreshToken = localStorage.getItem("qe_refresh_token");
      await authApi.logout(refreshToken);
    } catch { /* ignore */ } finally {
      clearAuthStorage();
      set({ user: null, workspaces: [], activeWorkspace: null, accessToken: null, status: "unauthenticated", error: null });
    }
  },

  setWorkspace: (workspace) => {
    localStorage.setItem("qe_workspace_id", workspace.id);
    set({ activeWorkspace: workspace });
  },

  clearError: () => set({ error: null }),
}));

export default useAuthStore;
