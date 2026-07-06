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
