import { useApi, usePolling } from "../../hooks/useApi";
import { portfolios as portfoliosApi, proposals as proposalsApi, positions as positionsApi, audit as auditApi } from "../../api/endpoints";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import useSystemStore from "../../store/system.store";
import { colors, regime as regimeMeta, statusMap } from "../../lib/tokens";
import { fmt } from "../../lib/format";

function Metric({ label, value, sub, valueColor }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 6, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 600, color: valueColor || colors.text }}>
        {value}
      </div>
      {sub && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Sparkline({ snapshots }) {
  if (!snapshots || snapshots.length < 2) return (
    <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>Insufficient data</span>
    </div>
  );

  const vals = snapshots.map(s => s.nav);
  const min = Math.min(...vals), max = Math.max(...vals);
  const w = 400, h = 80;
  const x = (i) => (i / (vals.length - 1)) * w;
  const y = (v) => max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 8) - 4;
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
  const isUp = vals[vals.length - 1] >= vals[0];
  const lineColor = isUp ? colors.green : colors.red;

  return (
    <div style={{ height: 80, position: "relative" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={lineColor} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={`M ${pts} L ${x(vals.length-1)},${h} L 0,${h} Z`} fill="url(#sparkGrad)"/>
        <path d={`M ${pts}`} fill="none" stroke={lineColor} strokeWidth="1.5"/>
        <circle cx={x(vals.length-1)} cy={y(vals[vals.length-1])} r="3" fill={lineColor}/>
      </svg>
    </div>
  );
}

function RegimePanel({ regime }) {
  if (!regime) return <div style={{ padding: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.muted }}>Loading regime…</div>;
  const meta = regimeMeta[regime.state] || regimeMeta.QUIET_BULLISH;
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {Object.entries(regimeMeta).filter(([k]) => k !== "TRANSITIONING").map(([k, v]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: v.color, opacity: k === regime.state ? 1 : 0.2, flexShrink: 0 }}/>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: k === regime.state ? colors.text : colors.muted,
            fontWeight: k === regime.state ? 600 : 400, flex: 1,
          }}>{v.label}</span>
          {k === regime.state && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: v.color }}>
              {fmt.pct(regime.confidence * 100)}
            </span>
          )}
        </div>
      ))}
      <hr style={{ border: "none", borderTop: `1px solid ${colors.border}`, margin: "4px 0" }}/>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        BTC Stress: <span style={{ color: regime.btcStressIndex > 0.5 ? colors.red : colors.green }}>{fmt.num(regime.btcStressIndex, 3)}</span>
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        Transition prob: <span style={{ color: colors.text }}>{fmt.pct(regime.transitionProb * 100)}</span>
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        Since: <span style={{ color: colors.text }}>{fmt.ts(regime.validFrom)}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { regime } = useSystemStore();

  const { data: portfolios, loading: loadingP } = usePolling(() => portfoliosApi.list(), 30000);
  const { data: openPositions }                 = usePolling(() => positionsApi.list({ status: "OPEN" }), 30000);
  const { data: pendingProposals }              = usePolling(() => proposalsApi.list({ status: "PENDING", limit: 5 }), 30000);
  const { data: recentAudit }                   = usePolling(() => auditApi.notifications({ limit: 8 }), 60000);

  const portfolio   = portfolios?.[0];
  const nav         = portfolio?.latestSnapshot?.nav;
  const unrealized  = (openPositions || []).reduce((s, p) => s + p.unrealizedPnl, 0);
  const snapshots   = portfolio ? null : null; // Fetched separately below
  const { data: snapshotData } = usePolling(
    () => portfolio ? portfoliosApi.snapshots(portfolio.id, { limit: 48 }) : Promise.resolve({ data: { data: [] } }),
    300000,
    [portfolio?.id]
  );

  const auditColors = { info: colors.muted, warn: colors.orange, regime: colors.violet, success: colors.green, SIGNAL: colors.green, REGIME: colors.violet, RISK: colors.red, TRADE: colors.green, SYSTEM: colors.muted };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600 }}>Dashboard</h1>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <Metric label="Portfolio NAV"   value={nav ? fmt.usd(nav) : "—"} sub="Live" valueColor={colors.green}/>
        <Metric label="Unrealized P&L"  value={fmt.usd(unrealized)} valueColor={unrealized >= 0 ? colors.green : colors.red}/>
        <Metric label="Open Positions"  value={openPositions?.length ?? "—"} sub="Active"/>
        <Metric label="Pending Proposals" value={pendingProposals?.proposals?.length ?? "—"} sub="Awaiting signature" valueColor={colors.violet}/>
      </div>

      {/* NAV chart + Regime */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>NAV History</span>
          </div>
          <div style={{ padding: "12px 16px" }}>
            <Sparkline snapshots={snapshotData || []}/>
          </div>
        </div>

        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Regime</span>
          </div>
          <RegimePanel regime={regime}/>
        </div>
      </div>

      {/* Recent activity */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Recent Activity</span>
        </div>
        <div style={{ padding: "0 16px" }}>
          {!recentAudit || recentAudit.length === 0
            ? <EmptyState message="No recent activity"/>
            : recentAudit.map(n => (
              <div key={n.id} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "10px 0", borderBottom: `1px solid ${colors.border}`,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                  background: auditColors[n.type] || colors.muted,
                }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.text }}>{n.title}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginTop: 2 }}>{n.body}</div>
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, flexShrink: 0 }}>
                  {fmt.ago(n.createdAt)}
                </span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
