import useSystemStore from "../../store/system.store";

const WS_LABELS = {
  connected:    { label: "Live",         color: "#00D4AA" },
  connecting:   { label: "Connecting…",  color: "#FF8C00" },
  disconnected: { label: "Disconnected", color: "#FF4D6D" },
  error:        { label: "Error",        color: "#FF4D6D" },
};

// Shown at top of every authenticated page
// Never hidden, never dismissed — connection state is always visible
export function SystemStatus() {
  const { wsStatus, wsError } = useSystemStore();
  const ws = WS_LABELS[wsStatus] || WS_LABELS.disconnected;
  const isLive = wsStatus === "connected";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      color: ws.color,
      letterSpacing: "0.06em",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ws.color,
        animation: isLive ? "blink 1.5s ease-in-out infinite" : "none",
        flexShrink: 0,
      }}/>
      <span>{ws.label}</span>
      {wsError && wsStatus === "error" && (
        <span style={{ color: "#5A6478", marginLeft: 4 }} title={wsError}>(?)</span>
      )}
    </div>
  );
}

// Inline error display — used inside page content
export function ErrorState({ error, onRetry }) {
  if (!error) return null;
  return (
    <div style={{
      background: "#16161F",
      border: "1px solid #FF4D6D44",
      borderRadius: 6,
      padding: "12px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#FF4D6D", fontSize: 12 }}>⚠</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#E8F4F8" }}>
          {error.message || "Failed to load data"}
        </span>
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: "transparent",
          border: "1px solid #252538",
          borderRadius: 4,
          padding: "4px 10px",
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
          color: "#5A6478",
          cursor: "pointer",
          flexShrink: 0,
          letterSpacing: "0.04em",
        }}>
          Retry
        </button>
      )}
    </div>
  );
}

// Loading skeleton — uniform across all pages
export function LoadingState({ rows = 3 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: 40,
          background: "#111118",
          borderRadius: 4,
          animation: "shimmer 1.5s ease-in-out infinite",
          opacity: 1 - i * 0.15,
        }}/>
      ))}
    </div>
  );
}

// Empty state — consistent across all list views
export function EmptyState({ message = "No data available", sub }) {
  return (
    <div style={{
      padding: "40px 24px",
      textAlign: "center",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ fontSize: 12, color: "#5A6478", marginBottom: sub ? 6 : 0 }}>{message}</div>
      {sub && <div style={{ fontSize: 11, color: "#5A6478", opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}
