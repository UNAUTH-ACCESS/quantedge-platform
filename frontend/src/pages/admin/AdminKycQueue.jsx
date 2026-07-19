import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import { kyc as kycApi } from "../../api/endpoints";
import { ErrorState, LoadingState, EmptyState } from "../../components/system/SystemStatus";
import { colors } from "../../lib/tokens";
import { fmt } from "../../lib/format";
import useAuthStore from "../../store/auth.store";

function DocImage({ label, base64 }) {
  if (!base64) return null;
  return (
    <div>
      <div style={{ fontSize: 9, color: colors.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <img
        src={`data:image/jpeg;base64,${base64}`}
        alt={label}
        style={{
          maxWidth: "100%", maxHeight: 320, borderRadius: 4,
          border: `1px solid ${colors.border2}`, display: "block",
        }}
      />
    </div>
  );
}

function DetailPanel({ submissionId, onDecided }) {
  const { data, loading, error } = useApi(() => kycApi.adminGet(submissionId), [submissionId]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);

  const handleDecision = async (decision) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await kycApi.adminReview(submissionId, decision, notes);
      onDecided();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || "Review failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}><LoadingState rows={4}/></div>;
  if (error) return <ErrorState error={error}/>;
  if (!data) return null;

  const { submission, documents } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 11 }}>
        <div><span style={{ color: colors.muted }}>Legal name: </span>{submission.legalName}</div>
        <div><span style={{ color: colors.muted }}>DOB: </span>{new Date(submission.dateOfBirth).toLocaleDateString()}</div>
        <div><span style={{ color: colors.muted }}>Residence: </span>{submission.countryResidence}</div>
        <div><span style={{ color: colors.muted }}>Citizenship: </span>{submission.countryCitizenship}</div>
        <div style={{ gridColumn: "span 2" }}><span style={{ color: colors.muted }}>Address: </span>{submission.address}</div>
        <div><span style={{ color: colors.muted }}>ID type: </span>{submission.idType}</div>
        <div><span style={{ color: colors.muted }}>ID number: </span>{submission.idNumber}</div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <DocImage label="ID Front" base64={documents.idDocFront}/>
        <DocImage label="ID Back" base64={documents.idDocBack}/>
        <DocImage label="Selfie" base64={documents.selfie}/>
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
        {submission.attestNotPep && <span style={{ color: colors.green }}>✓ Not PEP</span>}
        {submission.attestNoSanctions && <span style={{ color: colors.green }}>✓ Not sanctioned</span>}
        {submission.attestAccurate && <span style={{ color: colors.green }}>✓ Attested accurate</span>}
      </div>

      {submission.status === "PENDING_REVIEW" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Review notes (optional)"
            style={{
              background: colors.surface2, border: `1px solid ${colors.border2}`,
              borderRadius: 4, padding: 8, fontSize: 11, color: colors.muted,
              fontFamily: "'JetBrains Mono', monospace", minHeight: 60, resize: "vertical",
            }}
          />
          {actionError && <div style={{ color: colors.red, fontSize: 10 }}>{actionError}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={submitting}
              onClick={() => handleDecision("APPROVED")}
              style={{
                flex: 1, background: colors.green, color: colors.bg, border: "none",
                borderRadius: 4, padding: "8px 12px", fontSize: 11, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace", cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Approve
            </button>
            <button
              disabled={submitting}
              onClick={() => handleDecision("REJECTED")}
              style={{
                flex: 1, background: "transparent", color: colors.red,
                border: `1px solid ${colors.red}`, borderRadius: 4, padding: "8px 12px",
                fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1,
              }}
            >
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: colors.muted }}>
          Already reviewed — status: <strong style={{ color: submission.status === "APPROVED" ? colors.green : colors.red }}>{submission.status}</strong>
          {submission.reviewNotes && <div style={{ marginTop: 4 }}>Notes: {submission.reviewNotes}</div>}
        </div>
      )}
    </div>
  );
}

export default function AdminKycQueue() {
  const { user } = useAuthStore();
  if (!user?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  const { data, loading, error, refetch } = useApi(() => kycApi.adminPending(), []);
  const [selectedId, setSelectedId] = useState(null);

  const pending = data?.pending || [];

  const handleDecided = () => {
    setSelectedId(null);
    refetch();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600 }}>KYC Review Queue</h1>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted }}>
          {pending.length} pending
        </span>
        <button onClick={refetch} style={{
          marginLeft: "auto",
          background: "transparent", border: `1px solid ${colors.border2}`,
          borderRadius: 4, padding: "5px 10px",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          color: colors.muted, cursor: "pointer",
        }}>Refresh</button>
      </div>

      {error && <ErrorState error={error} onRetry={refetch}/>}

      <div style={{ display: "grid", gridTemplateColumns: selectedId ? "320px 1fr" : "1fr", gap: 16 }}>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, overflow: "hidden" }}>
          {loading && <div style={{ padding: 24 }}><LoadingState rows={4}/></div>}
          {!loading && pending.length === 0 && <EmptyState message="No submissions pending review"/>}
          {!loading && pending.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                padding: "10px 14px", borderBottom: `1px solid ${colors.border}`,
                cursor: "pointer", background: selectedId === p.id ? colors.surface2 : "transparent",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500 }}>{p.legalName}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginTop: 2 }}>
                {p.countryResidence} · {p.idType} · {new Date(p.submittedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>

        {selectedId && (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 16 }}>
            <DetailPanel submissionId={selectedId} onDecided={handleDecided}/>
          </div>
        )}
      </div>
    </div>
  );
}
