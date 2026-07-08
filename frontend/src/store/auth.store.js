import { create } from "zustand";
import { auth as authApi } from "../api/endpoints";

const useAuthStore = create((set, get) => ({
  user:        null,
  workspaces:  [],
  activeWorkspace: null,
  accessToken: localStorage.getItem("qe_access_token"),
  status:      localStorage.getItem("qe_access_token") ? "authenticated" : "unauthenticated",
  // status: unauthenticated | authenticating | authenticated | error

  login: async (email, password) => {
    set({ status: "authenticating", error: null });
    try {
      const { data } = await authApi.login(email, password);
      const { accessToken, refreshToken, user, workspaces } = data.data;

      localStorage.setItem("qe_access_token",  accessToken);
      localStorage.setItem("qe_refresh_token", refreshToken);
      localStorage.setItem("qe_user_id",       user.id);

      // Default to first workspace
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

      return { ok: true };
    } catch (err) {
      set({ status: "error", error: err.message || "Login failed" });
      return { ok: false, error: err.message };
    }
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

  logout: async () => {
    try {
      const refreshToken = localStorage.getItem("qe_refresh_token");
      await authApi.logout(refreshToken);
    } catch { /* ignore */ } finally {
      localStorage.clear();
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
