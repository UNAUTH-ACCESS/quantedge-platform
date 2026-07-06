import { useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { signals as signalsApi } from "../../api/endpoints";
import useSystemStore from "../../store/system.store";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import { colors, statusMap, regime as regimeMeta } from "../../lib/tokens";
import { fmt } from "../../lib/format";

function SignalCard({ signal }) {
  const dirColor = signal.direction === "LONG" ? colors.green : colors.red;
  const eval_ = signal.evaluations?.[0];
  const evalStatus = eval_ ? statusMap[eval_.evaluationStatus] : null;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${eval_?.evaluationStatus === "APPROVED" ? colors.green + "44" : colors.border}`,
      borderRadius: 6,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700 }}>
          {signal.asset?.symbol}/USDT
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
          padding: "2px 6px", borderRadius: 3,
          background: dirColor + "22", color: dirColor,
          border: `1px solid ${dirColor}44`,
          letterSpacing: "0.06em",
        }}>
          {fmt.direction(signal.direction)}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
          {fmt.ago(signal.generatedAt)}
        </span>
      </div>

      {/* Strength bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>Signal Strength</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.text }}>
            {fmt.num(signal.strength, 3)}
          </span>
        </div>
        <div style={{ height: 3, background: colors.border, borderRadius: 2 }}>
          <div style={{
            height: "100%", borderRadius: 2,
            width: `${signal.strength * 100}%`,
            background: signal.strength >= 0.7 ? colors.green : signal.strength >= 0.5 ? colors.orange : colors.red,
            transition: "width 0.3s",
          }}/>
        </div>
      </div>

      {/* Features */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {signal.featuresSnapshot && Object.entries(signal.featuresSnapshot).map(([k, v]) => (
          <span key={k} style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            padding: "3px 7px",
            background: colors.surface2,
            border: `1px solid ${colors.border2}`,
            borderRadius: 3,
            color: colors.muted,
          }}>
            {k.split("_").slice(-1)[0]}: <span style={{ color: v > 0 ? colors.green : colors.red }}>{fmt.num(v, 2)}</span>
          </span>
        ))}
      </div>

      {/* Evaluation result */}
      {evalStatus && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px",
          background: colors.surface2,
          borderRadius: 4,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: evalStatus.color, flexShrink: 0 }}/>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: evalStatus.color }}>
            {evalStatus.label}
          </span>
          {eval_.kellySizeApplied && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginLeft: "auto" }}>
              {fmt.kelly(eval_.kellySizeApplied)}
            </span>
          )}
        </div>
      )}

      {/* Expiry */}
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        Expires {fmt.ts(signal.expiresAt)}
      </div>
    </div>
  );
}

export default function Signals() {
  const { lastSignal, resetUnread } = useSystemStore();
  const { data, loading, error, refetch } = useApi(
    () => signalsApi.list({ limit: 20 }),
    []
  );

  // Refetch when new signal arrives via socket
  useEffect(() => {
    if (lastSignal) {
      refetch();
      resetUnread();
    }
  }, [lastSignal]);

  const signalList = data?.signals || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>Signals</h1>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
          {data?.total != null ? `${data.total} total` : ""}
        </span>
        <button onClick={refetch} style={{
          marginLeft: "auto",
          background: "transparent", border: `1px solid ${colors.border2}`,
          borderRadius: 4, padding: "5px 10px",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          color: colors.muted, cursor: "pointer",
        }}>
          Refresh
        </button>
      </div>

      {error && <ErrorState error={error} onRetry={refetch}/>}
      {loading && <LoadingState rows={4}/>}
      {!loading && !error && signalList.length === 0 && (
        <EmptyState message="No signals yet" sub="The engine generates signals every 2 minutes"/>
      )}
      {!loading && signalList.map(s => <SignalCard key={s.id} signal={s}/>)}
    </div>
  );
}
