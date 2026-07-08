import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import useAuthStore from "../../store/auth.store";
import { colors } from "../../lib/tokens";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode]         = useState("");
  const [pendingToken, setPendingToken] = useState(null);
  const [error, setError]       = useState(null);
  const { login, verify2FA, status } = useAuthStore();
  const navigate                = useNavigate();
  const location                = useLocation();
  const from                    = location.state?.from?.pathname || "/dashboard";
  const loading                 = status === "authenticating";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const result = await login(email, password);
    if (result.requires2FA) {
      setPendingToken(result.pendingToken);
      return;
    }
    if (result.ok) {
      navigate(from, { replace: true });
    } else {
      setError(result.error);
    }
  };

  const handleVerify2FA = async (e) => {
    e.preventDefault();
    setError(null);
    const result = await verify2FA(pendingToken, code);
    if (result.ok) {
      navigate(from, { replace: true });
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
        {/* Logo */}
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

        {/* Form */}
        {!pendingToken ? (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, color: colors.muted, marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loading}
              placeholder="you@example.com"
              style={{
                width: "100%", boxSizing: "border-box",
                background: colors.surface,
                border: `1px solid ${colors.border2}`,
                borderRadius: 4,
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                color: colors.text,
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, color: colors.muted, marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              placeholder="••••••••"
              style={{
                width: "100%", boxSizing: "border-box",
                background: colors.surface,
                border: `1px solid ${colors.border2}`,
                borderRadius: 4,
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                color: colors.text,
                outline: "none",
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: "#FF4D6D11",
              border: "1px solid #FF4D6D44",
              borderRadius: 4,
              padding: "10px 12px",
              marginBottom: 16,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: colors.red,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            style={{
              width: "100%",
              background: loading ? colors.surface2 : colors.green,
              color: loading ? colors.muted : colors.bg,
              border: "none",
              borderRadius: 4,
              padding: "11px",
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
              letterSpacing: "0.06em",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        ) : (
        <form onSubmit={handleVerify2FA}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, color: colors.muted, marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Two-Factor Code
            </label>
            <div style={{ fontSize: 11, color: colors.muted, marginBottom: 10 }}>
              Enter the 6-digit code from your authenticator app, or a backup code.
            </div>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              disabled={loading}
              placeholder="000000"
              style={{
                width: "100%", boxSizing: "border-box",
                background: colors.surface,
                border: `1px solid ${colors.border2}`,
                borderRadius: 4,
                padding: "10px 12px",
                fontSize: 15,
                letterSpacing: "0.2em",
                textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                color: colors.text,
                outline: "none",
              }}
            />
          </div>

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
            disabled={loading || !code}
            style={{
              width: "100%",
              background: loading ? colors.surface2 : colors.green,
              color: loading ? colors.muted : colors.bg,
              border: "none", borderRadius: 4, padding: "11px",
              fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700, letterSpacing: "0.06em",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
        )}

        <div style={{ marginTop: 24, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, textAlign: "center" }}>
          Don't have an account? <a href="/signup" style={{ color: colors.green, textDecoration: "none" }}>Create one</a>
        </div>
      </div>
    </div>
  );
}
