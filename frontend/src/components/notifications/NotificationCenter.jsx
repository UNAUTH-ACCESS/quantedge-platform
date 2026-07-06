import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import useNotificationStore from "../../hooks/useNotifications";
import useAuthStore from "../../store/auth.store";
import { colors } from "../../lib/tokens";
import { fmt } from "../../lib/format";

const PRIORITY_COLORS = {
  CRITICAL: colors.red,
  HIGH:     colors.orange,
  MEDIUM:   colors.violet,
  LOW:      colors.muted,
};

const TYPE_ICONS = {
  SIGNAL: "⚡",
  TRADE:  "✅",
  RISK:   "⚠️",
  REGIME: "🔄",
  SYSTEM: "ℹ️",
};

const ENTITY_PATHS = {
  TradeProposal: "/proposals",
  Position:      "/positions",
  Signal:        "/signals",
  Portfolio:     "/portfolio",
};

const TYPE_FILTERS = ["ALL", "SIGNAL", "TRADE", "RISK", "REGIME", "SYSTEM"];

function NotificationItem({ notification, onRead }) {
  const navigate    = useNavigate();
  const priorityColor = PRIORITY_COLORS[notification.priority] || colors.muted;
  const icon          = TYPE_ICONS[notification.type] || "ℹ️";

  const handleClick = () => {
    if (!notification.read) onRead(notification.id);
    const path = ENTITY_PATHS[notification.entityType];
    if (path) navigate(path);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        padding:     "12px 16px",
        borderBottom: `1px solid ${colors.border}`,
        cursor:       notification.entityType ? "pointer" : "default",
        background:   notification.read ? "transparent" : colors.surface2,
        display:      "flex", gap: 10, alignItems: "flex-start",
        transition:   "background 0.1s",
      }}
    >
      {/* Unread dot */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%", marginTop: 5, flexShrink: 0,
        background: notification.read ? "transparent" : priorityColor,
        border:     notification.read ? `1px solid ${colors.border2}` : "none",
      }}/>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 12 }}>{icon}</span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, fontWeight: notification.read ? 400 : 600,
            color: colors.text, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {notification.title}
          </span>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, color: colors.muted, lineHeight: 1.5,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {notification.body}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted, marginTop: 4 }}>
          {fmt.ago(notification.createdAt)}
        </div>
      </div>
    </div>
  );
}

export default function NotificationCenter() {
  const [open,   setOpen]   = useState(false);
  const [filter, setFilter] = useState("ALL");
  const panelRef  = useRef(null);
  const bottomRef = useRef(null);

  const workspaceId  = useAuthStore(s => s.activeWorkspace?.id);
  const {
    notifications, unreadCount, hasMore, loading,
    init, loadMore, markRead, markAllRead,
  } = useNotificationStore();

  // Init on mount
  useEffect(() => {
    if (workspaceId) init(workspaceId);
  }, [workspaceId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Infinite scroll observer
  const observer = useRef(null);
  const lastItemRef = useCallback((node) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore(workspaceId);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore, workspaceId]);

  const filtered = filter === "ALL"
    ? notifications
    : notifications.filter(n => n.type === filter);

  return (
    <div style={{ position: "relative" }} ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background:   "transparent",
          border:       `1px solid ${open ? colors.green : colors.border2}`,
          borderRadius: 6,
          padding:      "5px 10px",
          cursor:       "pointer",
          display:      "flex", alignItems: "center", gap: 6,
          color:        open ? colors.green : colors.muted,
          position:     "relative",
          transition:   "all 0.15s",
        }}
      >
        <span style={{ fontSize: 14 }}>🔔</span>
        {unreadCount > 0 && (
          <span style={{
            position:   "absolute", top: -5, right: -5,
            background: colors.red, color: "white",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize:   9, fontWeight: 700,
            padding:    "1px 4px", borderRadius: 8,
            minWidth:   16, textAlign: "center",
          }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position:   "absolute", top: 44, right: 0,
          width:      360, maxHeight: 500,
          background: colors.surface,
          border:     `1px solid ${colors.border2}`,
          borderRadius: 8, zIndex: 300,
          display:    "flex", flexDirection: "column",
          boxShadow:  "0 8px 32px #00000060",
          overflow:   "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding:      "12px 16px",
            borderBottom: `1px solid ${colors.border}`,
            display:      "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              Notifications {unreadCount > 0 && (
                <span style={{ color: colors.muted, fontWeight: 400 }}>({unreadCount} unread)</span>
              )}
            </span>
            {unreadCount > 0 && (
              <button onClick={() => markAllRead(workspaceId)} style={{
                background: "transparent", border: "none",
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                color: colors.green, cursor: "pointer",
              }}>
                Mark all read
              </button>
            )}
          </div>

          {/* Filters */}
          <div style={{
            display:      "flex", gap: 4, padding: "8px 12px",
            borderBottom: `1px solid ${colors.border}`,
            overflowX:    "auto", flexShrink: 0,
          }}>
            {TYPE_FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background:   filter === f ? colors.green : "transparent",
                color:        filter === f ? colors.bg    : colors.muted,
                border:       `1px solid ${filter === f ? colors.green : colors.border2}`,
                borderRadius: 3, padding: "3px 8px",
                fontSize:     9, fontFamily: "'JetBrains Mono', monospace",
                fontWeight:   filter === f ? 700 : 400,
                cursor:       "pointer", whiteSpace: "nowrap",
                flexShrink:   0,
              }}>
                {f}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && !loading && (
              <div style={{
                padding:    "32px 16px", textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize:   11, color: colors.muted,
              }}>
                No notifications
              </div>
            )}

            {filtered.map((n, i) => (
              <div key={n.id} ref={i === filtered.length - 1 ? lastItemRef : null}>
                <NotificationItem
                  notification={n}
                  onRead={(id) => markRead(id, workspaceId)}
                />
              </div>
            ))}

            {loading && (
              <div style={{
                padding:    "12px 16px", textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize:   10, color: colors.muted,
              }}>
                Loading…
              </div>
            )}

            {!hasMore && filtered.length > 0 && (
              <div style={{
                padding:    "8px 16px", textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize:   9, color: colors.muted,
              }}>
                All notifications loaded
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
