import { useApi, usePolling } from "../../hooks/useApi";
import { portfolios as portfoliosApi, reports as reportsApi } from "../../api/endpoints";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import { colors } from "../../lib/tokens";
import { fmt } from "../../lib/format";
import { useState } from "react";

function RiskConfigPanel({ config, portfolioId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [form, setForm]       = useState(config || {});

  const fields = [
    { key: "maxPositionPct",          label: "Max Position Size",      suffix: "%" },
    { key: "stopLossPct",             label: "Stop Loss",              suffix: "%" },
    { key: "kellyFraction",           label: "Kelly Fraction",         suffix: "×" },
    { key: "maxDrawdownPct",          label: "Max Drawdown Halt",      suffix: "%" },
    { key: "stressExposureCapPct",    label: "Stress Exposure Cap",    suffix: "%" },
    { key: "signalStrengthThreshold", label: "Signal Strength Floor",  suffix: ""  },
  ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await portfoliosApi.updateRisk(portfolioId, form);
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <div style={{
        padding: "10px 16px", borderBottom: `1px solid ${colors.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Risk Configuration</span>
        <button onClick={() => setEditing(!editing)} style={{
          background: "transparent", border: `1px solid ${colors.border2}`,
          borderRadius: 4, padding: "4px 10px",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          color: editing ? colors.red : colors.muted, cursor: "pointer",
        }}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {error && <ErrorState error={{ message: error }}/>}
        {fields.map(({ key, label, suffix }) => (
          <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: colors.muted }}>{label}</span>
            {editing ? (
              <input
                type="number"
                step="0.01"
                value={form[key] ?? ""}
                onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) }))}
                style={{
                  width: 80, textAlign: "right",
                  background: colors.surface2,
                  border: `1px solid ${colors.border2}`,
                  borderRadius: 4, padding: "4px 8px",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                  color: colors.text,
                }}
              />
            ) : (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 500 }}>
                {config?.[key]}{suffix}
              </span>
            )}
          </div>
        ))}

        {editing && (
          <button onClick={save} disabled={saving} style={{
            background: saving ? colors.surface2 : colors.green,
            color: saving ? colors.muted : colors.bg,
            border: "none", borderRadius: 4, padding: "8px",
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
            marginTop: 4,
          }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        )}
      </div>
    </div>
  );
}

function chainMeta(w) {
  const type = w.chain?.type || "";
  if (type === "SOLANA") return { label: "SOL", bg: "#9945FF22", fg: "#9945FF" };
  if (type === "TRON")   return { label: "TRX", bg: "#FF060A22", fg: "#FF060A" };
  return { label: "EVM", bg: "#627EEA22", fg: "#627EEA" };
}

function providerIcon(provider) {
  if (provider === "PHANTOM")  return "👻";
  if (provider === "METAMASK") return "🦊";
  if (provider === "TRONLINK") return "◈";
  return "🛡️";
}

function WalletList({ wallets }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Connected Wallets ({wallets?.length || 0})
        </span>
      </div>
      <div style={{ padding: "0 16px" }}>
        {(!wallets || wallets.length === 0) && <EmptyState message="No wallets connected"/>}
        {wallets?.map(pw => {
          const w = pw.wallet;
          const cm = chainMeta(w);
          return (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${colors.border}` }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: cm.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                {providerIcon(w.provider)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{w.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>{fmt.addr(w.address)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: cm.bg, color: cm.fg, border: `1px solid ${cm.fg}44` }}>
                  {cm.label}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: w.delegateApproved ? colors.green : colors.muted }}>
                  {w.delegateApproved ? "Delegate Active" : "Connected"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportPanel({ portfolioId }) {
  const [period, setPeriod] = useState("monthly");
  const { data: report, loading, error, refetch } = useApi(
    () => reportsApi.get(portfolioId, period),
    [portfolioId, period]
  );
  const s = report?.summary;
  const n = report?.nav;

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Performance Report</span>
        <div style={{ display: "flex", gap: 4 }}>
          {["daily","weekly","monthly","all"].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? colors.green : "transparent",
              color: period === p ? colors.bg : colors.muted,
              border: `1px solid ${period === p ? colors.green : colors.border2}`,
              borderRadius: 3, padding: "3px 8px",
              fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
              fontWeight: period === p ? 700 : 400, cursor: "pointer",
            }}>{p}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {loading && <LoadingState rows={4}/>}
        {error && <ErrorState error={error} onRetry={refetch}/>}
        {report && s && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {[
              ["Total Trades",    s.totalTrades,                      colors.text],
              ["Win Rate",        `${s.winRate?.toFixed(1)}%`,         s.winRate >= 50 ? colors.green : colors.red],
              ["Net P&L",        `$${s.netPnl?.toFixed(2)}`,          s.netPnl >= 0 ? colors.green : colors.red],
              ["Profit Factor",   s.profitFactor?.toFixed(2) || "—",  colors.text],
              ["Avg Hold",        `${s.avgHoldTimeMin?.toFixed(0)}m`,  colors.text],
              ["Max Drawdown",    `${n.maxDrawdown?.toFixed(2)}%`,     n.maxDrawdown > 10 ? colors.red : colors.green],
              ["Sharpe",          n.sharpe?.toFixed(3),                n.sharpe > 1 ? colors.green : colors.text],
              ["NAV Return",      `${n.returnPct?.toFixed(2)}%`,       n.returnPct >= 0 ? colors.green : colors.red],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background: colors.surface2, borderRadius: 4, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color }}>{value ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
        {report?.bestTrade && (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              ["Best Trade",  report.bestTrade,  colors.green],
              ["Worst Trade", report.worstTrade, colors.red],
            ].map(([label, trade, color]) => trade && (
              <div key={label} style={{ background: colors.surface2, borderRadius: 4, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color }}>${trade.pnl?.toFixed(2)}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginTop: 2 }}>
                  {trade.asset} {trade.side}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Portfolio() {
  const { data: portfolios, loading, error, refetch } = useApi(() => portfoliosApi.list(), []);
  const portfolio = portfolios?.[0];

  const { data: snapshots } = useApi(
    () => portfolio ? portfoliosApi.snapshots(portfolio.id, { limit: 50 }) : Promise.resolve({ data: { data: [] } }),
    [portfolio?.id]
  );

  const snap     = portfolio?.latestSnapshot;
  const inception = snapshots?.[0]?.nav;
  const pnlTotal  = snap && inception ? snap.nav - inception : null;
  const pnlPct    = pnlTotal && inception ? (pnlTotal / inception) * 100 : null;

  if (loading) return <LoadingState rows={6}/>;
  if (error)   return <ErrorState error={error} onRetry={refetch}/>;
  if (!portfolio) return <EmptyState message="No portfolio found"/>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600 }}>{portfolio.name}</h1>

      {/* Summary metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {[
          { label: "NAV",         value: fmt.usd(snap?.nav),          color: colors.green },
          { label: "Invested",    value: fmt.usd(snap?.invested),      color: colors.text  },
          { label: "Unrealized",  value: fmt.usd(snap?.unrealizedPnl), color: snap?.unrealizedPnl >= 0 ? colors.green : colors.red },
          { label: "Total P&L",   value: pnlTotal ? fmt.usd(pnlTotal) : "—", color: pnlTotal >= 0 ? colors.green : colors.red },
          { label: "Return",      value: pnlPct ? fmt.pct(pnlPct) : "—", color: pnlPct >= 0 ? colors.green : colors.red },
          { label: "Base Currency", value: portfolio.baseCurrency, color: colors.text },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 6, padding: "12px 14px",
          }}>
            <div style={{ fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              {label}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* NAV snapshot table */}
      {snapshots && snapshots.length > 0 && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              NAV History ({snapshots.length} snapshots)
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {["Time","NAV","Invested","Unrealized P&L","Realized P&L"].map(h => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: h === "Time" ? "left" : "right",
                      fontSize: 10, color: colors.muted, fontWeight: 500,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().slice(0, 20).map(s => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: "8px 12px", fontSize: 10, color: colors.muted }}>{fmt.ts(s.snappedAt)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 500 }}>{fmt.usd(s.nav)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmt.usd(s.invested)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", color: s.unrealizedPnl >= 0 ? colors.green : colors.red }}>
                      {fmt.usd(s.unrealizedPnl)}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", color: s.realizedPnl >= 0 ? colors.green : colors.red }}>
                      {fmt.usd(s.realizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Performance report */}
      <ReportPanel portfolioId={portfolio.id}/>

      {/* Two column: risk config + wallets */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <RiskConfigPanel
          config={portfolio.riskConfig}
          portfolioId={portfolio.id}
          onSaved={refetch}
        />
        <WalletList wallets={portfolio.wallets}/>
      </div>
    </div>
  );
}
