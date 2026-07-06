import { useState } from "react";
import { useApi } from "../../hooks/useApi";
import { audit as auditApi } from "../../api/endpoints";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import { colors } from "../../lib/tokens";
import { fmt } from "../../lib/format";

const TYPE_COLORS = {
  SIGNAL: colors.green,
  REGIME: colors.violet,
  RISK:   colors.red,
  TRADE:  colors.green,
  SYSTEM: colors.muted,
};

const EVENT_COLORS = {
  CREATE:  colors.green,
  UPDATE:  colors.orange,
  DELETE:  colors.red,
  LOGIN:   colors.muted,
  LOGOUT:  colors.muted,
  SIGN:    colors.violet,
  CANCEL:  colors.muted,
  APPROVE: colors.green,
  REJECT:  colors.red,
  INVITE:  colors.violet,
  SUSPEND: colors.red,
  ACTIVATE:colors.green,
};

export default function AuditLog() {
  const [filter, setFilter] = useState("all");

  const { data, loading, error, refetch } = useApi(
    () => auditApi.events({ limit: 100 }),
    []
  );

  const { data: notifications, refetch: refetchNotif } = useApi(
    () => auditApi.notifications({ limit: 50 }),
    []
  );

  const events = data?.events || [];
  const filtered = filter === "all" ? events : events.filter(e => e.entityType === filter);
  const entityTypes = [...new Set(events.map(e => e.entityType))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>Audit Log</h1>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
          {events.length} events
        </span>
        <button onClick={refetch} style={{
          marginLeft: "auto",
          background: "transparent", border: `1px solid ${colors.border2}`,
          borderRadius: 4, padding: "5px 10px",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          color: colors.muted, cursor: "pointer",
        }}>Refresh</button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["all", ...entityTypes].map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            background: filter === t ? colors.green : "transparent",
            color: filter === t ? colors.bg : colors.muted,
            border: `1px solid ${filter === t ? colors.green : colors.border2}`,
            borderRadius: 4, padding: "4px 10px",
            fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            fontWeight: filter === t ? 700 : 400,
            cursor: "pointer", letterSpacing: "0.04em",
          }}>
            {t === "all" ? "All" : t}
          </button>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={refetch}/>}

      {/* Events table */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {["Time","Actor","Entity","Action","Detail"].map(h => (
                <th key={h} style={{
                  padding: "8px 12px", textAlign: "left",
                  fontSize: 10, color: colors.muted, fontWeight: 500,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 24 }}><LoadingState rows={5}/></td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5}><EmptyState message="No audit events"/></td></tr>
            )}
            {!loading && filtered.map(e => {
              const actionColor = EVENT_COLORS[e.action] || colors.muted;
              return (
                <tr key={e.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: "8px 12px", fontSize: 10, color: colors.muted, whiteSpace: "nowrap" }}>
                    {fmt.ts(e.ts)}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 11 }}>
                    {e.actor?.name || "System"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                      background: colors.surface2, color: colors.muted,
                      border: `1px solid ${colors.border2}`, letterSpacing: "0.04em",
                    }}>
                      {e.entityType}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 10, color: actionColor, fontWeight: 600, letterSpacing: "0.04em" }}>
                      {e.action}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 10, color: colors.muted, maxWidth: 240 }}>
                    {e.afterState
                      ? `Status → ${e.afterState.status || JSON.stringify(e.afterState).slice(0, 40)}`
                      : "—"
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notifications */}
      {notifications && notifications.length > 0 && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Notifications
            </span>
          </div>
          <div style={{ padding: "0 16px" }}>
            {notifications.map(n => (
              <div key={n.id} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "10px 0", borderBottom: `1px solid ${colors.border}`,
                opacity: n.read ? 0.5 : 1,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                  background: TYPE_COLORS[n.type] || colors.muted,
                }}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: n.read ? 400 : 600 }}>
                    {n.title}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginTop: 2 }}>
                    {n.body}
                  </div>
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, flexShrink: 0 }}>
                  {fmt.ago(n.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
