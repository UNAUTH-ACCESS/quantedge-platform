import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import useSystemStore from "../store/system.store";
import useNotificationStore from "./useNotifications";
import useAuthStore from "../store/auth.store";

let socket = null;

export function useSocket() {
  const { setWsStatus, setRegime, setLastSignal, setLastProposalUpdate, incrementUnread } = useSystemStore();
  const { addLive } = useNotificationStore();
  const { status: authStatus, activeWorkspace } = useAuthStore();
  const portfolioId = useRef(null);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    // Connect once
    if (!socket) {
      setWsStatus("connecting");

      socket = io("/", {
        path: "/socket.io",
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        reconnectionAttempts: Infinity,
      });

      socket.on("connect", () => {
        setWsStatus("connected");
        socket.emit("subscribe:signals");
        // Subscribe to user and workspace rooms for notifications
        const userId      = localStorage.getItem("qe_user_id");
        const workspaceId = localStorage.getItem("qe_workspace_id");
        if (userId)      socket.emit("subscribe:user",      userId);
        if (workspaceId) socket.emit("subscribe:workspace", workspaceId);
      });

      socket.on("disconnect", (reason) => {
        setWsStatus("disconnected", `Disconnected: ${reason}`);
      });

      socket.on("connect_error", (err) => {
        setWsStatus("error", err.message);
      });

      socket.on("reconnect", () => {
        setWsStatus("connected");
        socket.emit("subscribe:signals");
        // Resubscribe to portfolio if we had one
        if (portfolioId.current) {
          socket.emit("subscribe:portfolio", portfolioId.current);
        }
      });

      // Signal events
      socket.on("signal:new", (data) => {
        setLastSignal(data);
        incrementUnread();
      });

      // Proposal status updates
      socket.on("proposal:created", (data) => {
        setLastProposalUpdate({ type: "created", ...data });
        incrementUnread();
      });

      socket.on("proposal:status", (data) => {
        setLastProposalUpdate({ type: "status", ...data });
      });

      // Position updates
      socket.on("position:updated", (data) => {
        setLastProposalUpdate({ type: "position", ...data });
      });

      // Regime transitions
      socket.on("regime:transition", (data) => {
        setRegime(data);
      });

      // Notifications — update store in real time
      socket.on("notification:new", (data) => {
        if (data?.id) {
          addLive(data);
        } else {
          incrementUnread();
        }
      });
    }

    return () => {
      // Don't disconnect on component unmount — keep socket alive for app lifetime
    };
  }, [authStatus]);

  // Subscribe to portfolio room when active workspace changes
  useEffect(() => {
    if (!socket || !activeWorkspace) return;
    // Fetch portfolioId from store when available
    // Portfolio subscription happens in portfolio hook
  }, [activeWorkspace]);

  return socket;
}

export function subscribeToPortfolio(pid) {
  if (socket && pid) {
    socket.emit("subscribe:portfolio", pid);
  }
}

export function getSocket() {
  return socket;
}
