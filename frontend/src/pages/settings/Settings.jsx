import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { portfolios as portfoliosApi, wallets as walletsApi } from "../../api/endpoints";
import client from "../../api/client";
import useAuthStore from "../../store/auth.store";
import useSystemStore from "../../store/system.store";
import { ErrorState, LoadingState } from "../../components/system/SystemStatus";
import { usePermissions } from "../../hooks/usePermissions";
import { colors, regime as regimeMeta } from "../../lib/tokens";
import { fmt } from "../../lib/format";

function Section({ title, children }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, valueColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 11, color: colors.muted }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, color: valueColor || colors.text }}>
        {value}
      </span>
    </div>
  );
}

function AutoExecuteToggle({ portfolioId }) {
  const [enabled, setEnabled]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState(null);
  const workspaceId = useAuthStore(s => s.activeWorkspace?.id);

  useEffect(() => {
    if (!portfolioId) return;
    client.get(`/portfolios/${portfolioId}/auto-execute`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then(res => setEnabled(res.data.data.autoExecute))
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, [portfolioId]);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await client.patch(`/portfolios/${portfolioId}/auto-execute`, { enabled: !enabled }, {
        headers: { "x-workspace-id": workspaceId },
      });
      setEnabled(res.data.data.autoExecute);
    } catch (err) {
      setError(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.muted }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
        <div>
          <div style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>Auto-Execute Signals</div>
          <div style={{ fontSize: 10, color: colors.muted, opacity: 0.7, maxWidth: 240 }}>
            Automatically signs and executes approved proposals without user action.
          </div>
        </div>
        <button onClick={toggle} disabled={saving} style={{
          width: 48, height: 26, borderRadius: 13,
          background: enabled ? colors.green : colors.border2,
          border: "none", cursor: saving ? "not-allowed" : "pointer",
          position: "relative", transition: "background 0.2s", flexShrink: 0,
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            background: "white",
            position: "absolute", top: 3,
            left: enabled ? 24 : 4,
            transition: "left 0.2s",
            boxShadow: "0 1px 3px #00000040",
          }}/>
        </button>
      </div>
      {enabled && (
        <div style={{
          background: "#00D4AA11", border: "1px solid #00D4AA44",
          borderRadius: 4, padding: "8px 10px",
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.green,
        }}>
          ⚡ Active — proposals will execute automatically when signals pass risk evaluation
        </div>
      )}
      {!enabled && (
        <div style={{
          background: colors.surface2, border: `1px solid ${colors.border2}`,
          borderRadius: 4, padding: "8px 10px",
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted,
        }}>
          Manual mode — proposals require your signature to execute
        </div>
      )}
      {error && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.red }}>{error}</div>}
    </div>
  );
}

export default function Settings() {
  const { user, activeWorkspace } = useAuthStore();
  const { canManagePortfolios, isAccountAdmin } = usePermissions();
  const { wsStatus, regime }      = useSystemStore();
  const regMeta = regime ? regimeMeta[regime.state] : null;

  const { data: portfolios, loading: loadingP } = useApi(() => portfoliosApi.list(), []);
  const { data: wallets,    loading: loadingW } = useApi(() => walletsApi.list(), []);

  const portfolio = portfolios?.[0];
  const rc = portfolio?.riskConfig;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600 }}>Settings</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>

        <Section title="Account">
          <Row label="Name"      value={user?.name}/>
          <Row label="Email"     value={user?.email}/>
          <Row label="Workspace" value={activeWorkspace?.name}/>
          <Row label="Role"      value={activeWorkspace?.role} valueColor={colors.green}/>
        </Section>

        <Section title="Subscription">
          <Row label="Plan"        value="Pro"    valueColor={colors.green}/>
          <Row label="Status"      value="Active" valueColor={colors.green}/>
          <Row label="Billing"     value="Stripe — coming soon"/>
          <Row label="Next charge" value="—"/>
        </Section>

        <Section title="Execution Mode">
          {loadingP
            ? <LoadingState rows={2}/>
            : canManagePortfolios
              ? <AutoExecuteToggle portfolioId={portfolio?.id}/>
              : <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.muted }}>
                  View only — account admin access required to change execution mode
                </div>
          }
        </Section>

        <Section title="Signal Engine">
          {loadingP
            ? <LoadingState rows={4}/>
            : portfolio?.signalConfigs?.map(psc => (
              <div key={psc.signalConfigId}>
                <Row label="Strategy"       value={psc.signalConfig?.strategy?.name || "—"}/>
                <Row label="Config version" value={`v${psc.signalConfig?.version}`}/>
                <Row label="Status"         value={psc.signalConfig?.status} valueColor={colors.green}/>
                <Row label="Bar frequency"  value={psc.signalConfig?.barFrequency}/>
              </div>
            ))
          }
        </Section>

        <Section title="Risk Parameters">
          {!isAccountAdmin && (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                         color: colors.muted, marginBottom: 8,
                         padding: "6px 10px", background: colors.surface2,
                         borderRadius: 4 }}>
              Read only — account admin access required to edit
            </div>
          )}
          {loadingP ? <LoadingState rows={4}/> : rc ? (<>
            <Row label="Max Position Size"   value={`${rc.maxPositionPct}%`}/>
            <Row label="Stop Loss"           value={`${rc.stopLossPct}%`}/>
            <Row label="Kelly Fraction"      value={`${rc.kellyFraction}×`}/>
            <Row label="Max Drawdown Halt"   value={`${rc.maxDrawdownPct}%`}/>
            <Row label="Stress Cap"          value={`${rc.stressExposureCapPct}%`}/>
            <Row label="Strength Floor"      value={rc.signalStrengthThreshold}/>
          </>) : <span style={{ fontSize: 11, color: colors.muted }}>No risk config</span>}
        </Section>

        <Section title="Execution Venues">
          <Row label="SOL Perps"   value="Drift Protocol"/>
          <Row label="EVM Perps"   value="Hyperliquid"/>
          <Row label="SOL Spot"    value="Jupiter"/>
          <Row label="EVM Spot"    value="1inch"/>
        </Section>

        <Section title="Wallets">
          {loadingW ? <LoadingState rows={2}/> : wallets?.map(w => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ fontSize: 14 }}>
                {w.provider === "PHANTOM" ? "👻" : w.provider === "METAMASK" ? "🦊" : "🛡️"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500 }}>{w.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>{fmt.addr(w.address)}</div>
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: w.status === "CONNECTED" ? colors.green : colors.red }}>
                {w.status === "CONNECTED" ? "Connected" : "Disconnected"}
              </span>
            </div>
          ))}
        </Section>

        <Section title="System">
          <Row label="API connection"    value={wsStatus === "connected" ? "Live" : wsStatus} valueColor={wsStatus === "connected" ? colors.green : colors.red}/>
          <Row label="Data feed"         value="Bybit WebSocket" valueColor={colors.green}/>
          <Row label="Regime"            value={regMeta?.label || "—"} valueColor={regMeta?.color}/>
          <Row label="Regime confidence" value={regime ? fmt.pct(regime.confidence * 100) : "—"}/>
          <Row label="BTC Stress Index"  value={regime ? fmt.num(regime.btcStressIndex, 3) : "—"}/>
          <Row label="Signal interval"   value="2 minutes"/>
          <Row label="Price feed"        value="30 seconds"/>
          <Row label="Snapshot interval" value="5 minutes"/>
          <Row label="Version"           value="0.1.0-mvp"/>
        </Section>

      </div>
    </div>
  );
}
