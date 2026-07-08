import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useAuthStore from "../../store/auth.store";
import { colors } from "../../lib/tokens";

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: colors.surface,
  border: `1px solid ${colors.border2}`,
  borderRadius: 4,
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  color: colors.text,
  outline: "none",
};

const labelStyle = {
  display: "block", fontSize: 11, color: colors.muted, marginBottom: 6,
  letterSpacing: "0.06em", textTransform: "uppercase",
};

function Field({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} {...props} />
    </div>
  );
}

export default function SignupPage() {
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [name, setName]               = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError]             = useState(null);
  const { register, status }          = useAuthStore();
  const navigate                      = useNavigate();
  const loading                       = status === "authenticating";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    const result = await register(email, password, name, workspaceName);
    if (result.ok) {
      navigate("/onboarding", { replace: true });
    } else {
      setError(result.error);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: colors.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
          <div style={{
            width: 28, height: 28,
            background: colors.green,
            clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
          }}/>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", color: colors.text }}>
              QuantEdge
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Systematic Trading
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={loading} placeholder="Jane Trader" />
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} placeholder="you@example.com" />
          <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} placeholder="At least 8 characters" />
          <Field label="Workspace Name" type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} required disabled={loading} placeholder="My Trading Desk" />

          {error && (
            <div style={{
              background: "#FF4D6D11", border: "1px solid #FF4D6D44", borderRadius: 4,
              padding: "10px 12px", marginBottom: 16,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.red,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password || !name || !workspaceName}
            style={{
              width: "100%",
              background: loading ? colors.surface2 : colors.green,
              color: loading ? colors.muted : colors.bg,
              border: "none", borderRadius: 4, padding: "11px",
              fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700, letterSpacing: "0.06em",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, textAlign: "center" }}>
          Already have an account? <a href="/login" style={{ color: colors.green, textDecoration: "none" }}>Sign in</a>
        </div>
      </div>
    </div>
  );
}
