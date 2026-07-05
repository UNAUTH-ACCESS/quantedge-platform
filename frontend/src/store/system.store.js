import { create } from "zustand";

const useSystemStore = create((set, get) => ({
  // WebSocket connection
  wsStatus: "disconnected", // disconnected | connecting | connected | error
  wsError:  null,

  // Regime state
  regime: null,
  regimeLoading: false,

  // Unread notification count
  unreadCount: 0,

  // Last signal received
  lastSignal: null,

  // Last proposal status update
  lastProposalUpdate: null,

  setWsStatus: (wsStatus, wsError = null) => set({ wsStatus, wsError }),

  setRegime: (regime) => set({ regime }),

  setLastSignal: (signal) => set({ lastSignal: signal }),

  setLastProposalUpdate: (update) => set({ lastProposalUpdate: update }),

  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),

  resetUnread: () => set({ unreadCount: 0 }),
}));

export default useSystemStore;
