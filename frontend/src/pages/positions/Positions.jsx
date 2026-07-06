import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { positions as positionsApi, proposals as proposalsApi } from "../../api/endpoints";
import client from "../../api/client";
import useSystemStore from "../../store/system.store";
import useAuthStore from "../../store/auth.store";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import { usePermissions } from "../../hooks/usePermissions";
import { colors } from "../../lib/tokens";
import { fmt } from "../../lib/format";

function CloseButton({ position, onClosed }) {
  const [state, setState]   = useState("idle"); // idle | confirming | closing | done | error
  const [error, setError]   = useState(null);
  const workspaceId = useAuthStore(s => s.activeWorkspace?.id);

  const close = async () => {
    if (state === "confirming") {
      setState("closing");
      setError(null);
      try {
        // Find the proposal linked to this position via fill
        const res = await positionsApi.get(position.id);
        const fillId = res.data.data.fill?.id;
        if (!fillId) throw new Error("No fill linked to position");

        // Find proposal by fill
        const propRes = await client.get(`/proposals`, {
          headers: { "x-workspace-id": workspaceId },
          params: { limit: 100 },
        });
        const proposals = propRes.data.data.proposals || [];
        const linked = proposals.find(p => p.fill?.id === fillId || p.fillId === fillId);

        if (!linked) throw new Error("Could not find linked proposal");

        await client.post(`/proposals/${linked.id}/close-position`, {}, {
          headers: { "x-workspace-id": workspaceId },
        });
        setState("done");
        setTimeout(() => { onClosed?.(); }, 1500);
      } catch (err) {
        setError(err.message || "Close failed");
        setState("error");
      }
    } else {
      setState("confirming");
      // Auto-cancel confirmation after 5s
      setTimeout(() => setState(s => s === "confirming" ? "idle" : s), 5000);
    }
  };

  if (state === "done") return (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.green }}>Closed ✓</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      <button onClick={close} disabled={state === "closing"} style={{
        background: state === "confirming" ? colors.red : "transparent",
        color:      state === "confirming" ? "white" : colors.muted,
        border:     `1px solid ${state === "confirming" ? colors.red : colors.border2}`,
        borderRadius: 4, padding: "4px 10px",
        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
        fontWeight: state === "confirming" ? 700 : 400,
        cursor: state === "closing" ? "not-allowed" : "pointer",
        transition: "all 0.15s", whiteSpace: "nowrap",
      }}>
        {state === "idle"       && "Close"}
        {state === "confirming" && "Confirm Close"}
        {state === "closing"    && "Closing…"}
        {state === "error"      && "Retry"}
      </button>
      {state === "confirming" && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted }}>
          Click again to confirm
        </span>
      )}
      {state === "error" && error && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.red }}>
          {error}
        </span>
      )}
    </div>
  );
}

function PositionRow({ position, onClosed }) {
  const { canExecuteTrades } = usePermissions();
  const pnl    = position.unrealizedPnl || 0;
  const pnlPct = position.entryPrice > 0
    ? ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100
      * (position.side === "SHORT" ? -1 : 1)
    : 0;
  const pnlColor  = pnl >= 0 ? colors.green : colors.red;
  const sideColor = position.side === "LONG" || position.side === "SPOT" ? colors.green : colors.red;

  return (
    <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600 }}>
        {position.asset?.symbol}{position.side === "SPOT" ? "/USDT" : "-PERP"}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
          padding: "2px 6px", borderRadius: 3,
          background: sideColor + "22", color: sideColor, border: `1px solid ${sideColor}44`,
        }}>
          {position.side}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.muted }}>
        {position.venue?.name}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.num(position.size, 4)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.usd(position.entryPrice)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.usd(position.currentPrice)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        <span style={{ color: pnlColor }}>
          {fmt.usd(pnl)} <span style={{ fontSize: 10 }}>({fmt.pct(pnlPct)})</span>
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        {fmt.ago(position.openedAt)}
      </td>
      <td style={{ padding: "10px 12px" }}>
        {canExecuteTrades && <CloseButton position={position} onClosed={onClosed}/>}
      </td>
    </tr>
  );
}

function ClosedRow({ position }) {
  const pnl      = position.realizedPnl || 0;
  const pnlColor = pnl >= 0 ? colors.green : colors.red;
  const sideColor = position.side === "LONG" || position.side === "SPOT" ? colors.green : colors.red;

  return (
    <tr style={{ borderBottom: `1px solid ${colors.border}`, opacity: 0.7 }}>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600 }}>
        {position.asset?.symbol}{position.side === "SPOT" ? "/USDT" : "-PERP"}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
          padding: "2px 6px", borderRadius: 3,
          background: sideColor + "22", color: sideColor, border: `1px solid ${sideColor}44`,
        }}>
          {position.side}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.muted }}>
        {position.venue?.name}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.num(position.size, 4)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.usd(position.entryPrice)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right", color: colors.muted }}>
        {fmt.ts(position.closedAt)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        <span style={{ color: pnlColor, fontWeight: 600 }}>{fmt.usd(pnl)}</span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        {fmt.ago(position.closedAt)}
      </td>
      <td style={{ padding: "10px 12px" }}/>
    </tr>
  );
}

function PositionCard({ position, onClosed }) {
  const pnl    = position.unrealizedPnl || 0;
  const pnlPct = position.entryPrice > 0
    ? ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100
      * (position.side === "SHORT" ? -1 : 1)
    : 0;
  const pnlColor  = pnl >= 0 ? colors.green : colors.red;
  const sideColor = position.side === "LONG" || position.side === "SPOT" ? colors.green : colors.red;

  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: 6, padding: 14, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700 }}>
          {position.asset?.symbol}{position.side === "SPOT" ? "/USDT" : "-PERP"}
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
          padding: "2px 6px", borderRadius: 3,
          background: sideColor + "22", color: sideColor, border: `1px solid ${sideColor}44`,
        }}>{position.side}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginLeft: "auto" }}>
          {position.venue?.name}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["Entry",   fmt.usd(position.entryPrice)],
          ["Mark",    fmt.usd(position.currentPrice)],
          ["Size",    fmt.num(position.size, 4)],
          ["Age",     fmt.ago(position.openedAt)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: colors.surface2, borderRadius: 4, padding: "8px 10px" }}>
            <div style={{ fontSize: 9, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 500 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Unrealized P&L</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color: pnlColor }}>
            {fmt.usd(pnl)} <span style={{ fontSize: 11 }}>({fmt.pct(pnlPct)})</span>
          </div>
        </div>
        {canExecuteTrades && <CloseButton position={position} onClosed={onClosed}/>}
      </div>
    </div>
  );
}

export default function Positions() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  const { lastProposalUpdate } = useSystemStore();

  const { data: open,   loading: loadingOpen,   error: errorOpen,   refetch: refetchOpen }   = useApi(() => positionsApi.list({ status: "OPEN" }),   []);
  const { data: closed, loading: loadingClosed, error: errorClosed, refetch: refetchClosed } = useApi(() => positionsApi.list({ status: "CLOSED" }), []);

  useEffect(() => {
    if (lastProposalUpdate) {
      refetchOpen();
      refetchClosed();
    }
  }, [lastProposalUpdate]);

  const openList   = open   || [];
  const closedList = closed || [];
  const totalPnl   = openList.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);

  const headers     = ["Asset","Side","Venue","Size","Entry","Mark","P&L","Age",""];
  const hdrsRight   = ["Size","Entry","Mark","P&L"];
  const hdrsClosd   = ["Asset","Side","Venue","Size","Entry","Closed","Realized P&L","Age",""];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>Positions</h1>
        {openList.length > 0 && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600,
            color: totalPnl >= 0 ? colors.green : colors.red,
          }}>
            {fmt.usd(totalPnl)} unrealized
          </span>
        )}
      </div>

      {/* Open */}
      <div>
        <div style={{ fontSize: 11, color: colors.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
          Open ({openList.length})
        </div>
        {errorOpen && <ErrorState error={errorOpen} onRetry={refetchOpen}/>}
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loadingOpen && <LoadingState rows={2}/>}
            {!loadingOpen && openList.length === 0 && <EmptyState message="No open positions"/>}
            {!loadingOpen && openList.map(p => (
              <PositionCard key={p.id} position={p} onClosed={() => { refetchOpen(); refetchClosed(); }}/>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {headers.map(h => (
                    <th key={h} style={{
                      padding: "8px 12px",
                      textAlign: hdrsRight.includes(h) ? "right" : "left",
                      fontSize: 10, color: colors.muted, fontWeight: 500,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingOpen && <tr><td colSpan={9} style={{ padding: 24 }}><LoadingState rows={2}/></td></tr>}
                {!loadingOpen && openList.length === 0 && (
                  <tr><td colSpan={9}><EmptyState message="No open positions"/></td></tr>
                )}
                {!loadingOpen && openList.map(p => (
                  <PositionRow key={p.id} position={p} onClosed={() => { refetchOpen(); refetchClosed(); }}/>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed */}
      {(closedList.length > 0 || loadingClosed) && (
        <div>
          <div style={{ fontSize: 11, color: colors.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
            Closed ({closedList.length})
          </div>
          {errorClosed && <ErrorState error={errorClosed} onRetry={refetchClosed}/>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {hdrsClosd.map(h => (
                    <th key={h} style={{
                      padding: "8px 12px",
                      textAlign: ["Size","Entry","Realized P&L"].includes(h) ? "right" : "left",
                      fontSize: 10, color: colors.muted, fontWeight: 500,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingClosed && <tr><td colSpan={9} style={{ padding: 24 }}><LoadingState rows={2}/></td></tr>}
                {!loadingClosed && closedList.map(p => <ClosedRow key={p.id} position={p}/>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
