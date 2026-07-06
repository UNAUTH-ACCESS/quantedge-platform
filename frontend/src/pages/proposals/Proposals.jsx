import { useState, useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { proposals as proposalsApi } from "../../api/endpoints";
import useSystemStore from "../../store/system.store";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import { usePermissions } from "../../hooks/usePermissions";
import { colors, statusMap } from "../../lib/tokens";
import { fmt } from "../../lib/format";

// ── Sign Modal ────────────────────────────────────────────────────────────────
function SignModal({ proposal, onClose, onDone }) {
  const [step, setStep] = useState("review"); // review | signing | submitted | confirmed | failed
  const [error, setError] = useState(null);

  const signal = proposal.evaluation?.signal;
  const asset  = signal?.asset;
  const dirColor = proposal.direction === "LONG" ? colors.green : colors.red;

  const sign = async () => {
    setStep("signing");
    setError(null);
    try {
      await proposalsApi.sign(proposal.id);
      setStep("submitted");
      // Poll for confirmation
      const poll = setInterval(async () => {
        try {
          const res = await proposalsApi.get(proposal.id);
          const status = res.data.data.status;
          if (status === "CONFIRMED") { clearInterval(poll); setStep("confirmed"); onDone(); }
          if (status === "FAILED")    { clearInterval(poll); setStep("failed"); }
        } catch { clearInterval(poll); }
      }, 2000);
      // Safety timeout
      setTimeout(() => clearInterval(poll), 30000);
    } catch (err) {
      setError(err.message);
      setStep("failed");
    }
  };

  const steps = [
    { label: "Proposal reviewed",     done: true },
    { label: "Wallet signature",       done: ["submitted","confirmed","failed"].includes(step), active: step === "signing" },
    { label: "Transaction broadcast",  done: ["confirmed","failed"].includes(step), active: step === "submitted" },
    { label: "Position confirmed",     done: step === "confirmed", failed: step === "failed" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#000000CC",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200, padding: 16,
    }} onClick={(e) => e.target === e.currentTarget && step === "review" && onClose()}>
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border2}`,
        borderRadius: 8,
        width: "100%", maxWidth: 420,
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {step === "review"    && "Review Trade"}
            {step === "signing"   && "Awaiting Signature"}
            {step === "submitted" && "Broadcasting"}
            {step === "confirmed" && "Confirmed"}
            {step === "failed"    && "Execution Failed"}
          </span>
          {["review", "confirmed", "failed"].includes(step) && (
            <span onClick={onClose} style={{ color: colors.muted, cursor: "pointer", fontSize: 16 }}>✕</span>
          )}
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {step === "review" && (<>
            {/* Wallet info */}
            <div style={{
              background: colors.surface2, border: `1px solid ${colors.border2}`,
              borderRadius: 6, padding: "10px 12px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: colors.violet,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0,
              }}>🔐</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{proposal.wallet?.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
                  {fmt.addr(proposal.wallet?.address)}
                </div>
              </div>
              <span style={{
                marginLeft: "auto",
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
                padding: "2px 6px", borderRadius: 3,
                background: proposal.wallet?.chain?.type === "SOLANA" ? "#9945FF22" : "#627EEA22",
                color: proposal.wallet?.chain?.type === "SOLANA" ? "#9945FF" : "#627EEA",
                border: `1px solid ${proposal.wallet?.chain?.type === "SOLANA" ? "#9945FF44" : "#627EEA44"}`,
              }}>
                {proposal.wallet?.chain?.type === "SOLANA" ? "SOL" : "EVM"}
              </span>
            </div>

            {/* Trade details */}
            {[
              ["Asset",        `${asset?.symbol}/USDT`],
              ["Direction",    fmt.direction(proposal.direction)],
              ["Venue",        proposal.venue?.name],
              ["Notional",     fmt.usd(proposal.notional)],
              ["Est. Entry",   fmt.usd(proposal.estEntry)],
              ["Est. Fee",     `${proposal.estFeeBps} bps`],
              ["Signal Strength", fmt.num(signal?.strength, 3)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: colors.muted }}>{k}</span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 500,
                  color: k === "Direction" ? dirColor : colors.text,
                }}>{v}</span>
              </div>
            ))}
          </>)}

          {/* Progress steps */}
          {step !== "review" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, flexShrink: 0,
                    background: s.failed ? colors.red : s.done ? colors.green : s.active ? colors.violet : colors.border,
                    color: (s.done || s.active || s.failed) ? (s.failed ? "white" : s.active ? "white" : colors.bg) : colors.muted,
                    animation: s.active ? "spin 1s linear infinite" : "none",
                  }}>
                    {s.failed ? "✕" : s.done ? "✓" : s.active ? "◌" : i + 1}
                  </div>
                  <span style={{ fontSize: 12, color: s.done ? colors.text : s.active ? colors.violet : s.failed ? colors.red : colors.muted }}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{
              background: "#FF4D6D11", border: "1px solid #FF4D6D44",
              borderRadius: 4, padding: "10px 12px",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.red,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${colors.border}`,
          display: "flex", gap: 8, justifyContent: "flex-end",
        }}>
          {step === "review" && (<>
            <button onClick={onClose} style={{
              background: "transparent", border: `1px solid ${colors.border2}`,
              borderRadius: 4, padding: "8px 16px",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              color: colors.muted, cursor: "pointer",
            }}>Cancel</button>
            <button onClick={sign} style={{
              background: colors.green, color: colors.bg,
              border: "none", borderRadius: 4, padding: "8px 16px",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700, cursor: "pointer",
            }}>Sign & Execute →</button>
          </>)}
          {["signing", "submitted"].includes(step) && (
            <button disabled style={{
              background: colors.surface2, color: colors.muted,
              border: "none", borderRadius: 4, padding: "8px 16px",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            }}>Processing…</button>
          )}
          {(step === "confirmed" || step === "failed") && (
            <button onClick={onClose} style={{
              background: step === "confirmed" ? colors.green : colors.surface2,
              color: step === "confirmed" ? colors.bg : colors.muted,
              border: "none", borderRadius: 4, padding: "8px 16px",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700, cursor: "pointer",
            }}>
              {step === "confirmed" ? "Done" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Proposal Row ──────────────────────────────────────────────────────────────
function ProposalRow({ proposal, onSign }) {
  const { canExecuteTrades } = usePermissions();
  const s = statusMap[proposal.status] || { label: proposal.status, color: colors.muted };
  const dirColor = proposal.direction === "LONG" ? colors.green : colors.red;
  const signal = proposal.evaluation?.signal;

  return (
    <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600 }}>
        {signal?.asset?.symbol || "—"}/USDT
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
          padding: "2px 6px", borderRadius: 3,
          background: dirColor + "22", color: dirColor, border: `1px solid ${dirColor}44`,
        }}>
          {fmt.direction(proposal.direction)}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.muted }}>
        {proposal.venue?.name}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.usd(proposal.notional)}
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textAlign: "right" }}>
        {fmt.num(signal?.strength, 3)}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
          padding: "2px 6px", borderRadius: 3, letterSpacing: "0.06em",
          background: s.color + "22", color: s.color, border: `1px solid ${s.color}44`,
        }}>
          {s.label}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
        {fmt.ago(proposal.proposedAt)}
      </td>
      <td style={{ padding: "10px 12px" }}>
        {proposal.status === "PENDING" && canExecuteTrades && (
          <button onClick={() => onSign(proposal)} style={{
            background: colors.green, color: colors.bg,
            border: "none", borderRadius: 4, padding: "5px 12px",
            fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em",
          }}>
            Sign →
          </button>
        )}
        {proposal.transaction?.txHash && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.violet }}>
            {fmt.addr(proposal.transaction.txHash)}
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Proposals() {
  const [signing, setSigning] = useState(null);
  const { lastProposalUpdate } = useSystemStore();
  const { data, loading, error, refetch } = useApi(
    () => proposalsApi.list({ limit: 50 }),
    []
  );

  useEffect(() => {
    if (lastProposalUpdate) refetch();
  }, [lastProposalUpdate]);

  const list = data?.proposals || [];
  const pending = list.filter(p => p.status === "PENDING");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {signing && (
        <SignModal
          proposal={signing}
          onClose={() => setSigning(null)}
          onDone={() => { setSigning(null); refetch(); }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>Proposals</h1>
        {pending.length > 0 && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
            padding: "2px 8px", borderRadius: 3,
            background: colors.violet + "22", color: colors.violet,
            border: `1px solid ${colors.violet}44`,
          }}>
            {pending.length} pending
          </span>
        )}
        <button onClick={refetch} style={{
          marginLeft: "auto",
          background: "transparent", border: `1px solid ${colors.border2}`,
          borderRadius: 4, padding: "5px 10px",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          color: colors.muted, cursor: "pointer",
        }}>Refresh</button>
      </div>

      {error && <ErrorState error={error} onRetry={refetch}/>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {["Asset","Direction","Venue","Notional","Strength","Status","Age","Action"].map(h => (
                <th key={h} style={{
                  padding: "8px 12px", textAlign: h === "Notional" || h === "Strength" ? "right" : "left",
                  fontSize: 10, color: colors.muted, fontWeight: 500,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={{ padding: 24 }}><LoadingState rows={3}/></td></tr>
            )}
            {!loading && list.length === 0 && (
              <tr><td colSpan={8}><EmptyState message="No proposals" sub="Proposals appear when signals pass risk evaluation"/></td></tr>
            )}
            {!loading && list.map(p => (
              <ProposalRow key={p.id} proposal={p} onSign={setSigning}/>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
