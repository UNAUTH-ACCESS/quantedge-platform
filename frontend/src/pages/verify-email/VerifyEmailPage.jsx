import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import useAuthStore from "../../store/auth.store";
import { auth as authApi } from "../../api/endpoints";
import { colors } from "../../lib/tokens";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { user, markEmailVerified } = useAuthStore();

  const [state, setState] = useState(token ? "verifying" : "awaiting");
  const [error, setError] = useState(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token) return;
    authApi.verifyEmail(token)
      .then(() => {
        markEmailVerified();
        setState("success");
      })
      .catch((err) => {
        setError(err.response?.data?.error?.message || "This verification link is invalid or has expired.");
        setState("error");
      });
  }, [token]);

  const handleResend = async () => {
    setError(null);
    try {
      await authApi.resendVerification();
      setResent(true);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Couldn't resend — try again in a moment.");
    }
  };

  const wrapStyle = {
    minHeight: "100vh", background: colors.bg,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24, fontFamily: "'Inter', sans-serif",
  };
  const cardStyle = { width: "100%", maxWidth: 380, textAlign: "center" };
  const titleStyle = { fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, color: colors.text, marginBottom: 12 };
  const bodyStyle = { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: colors.muted, lineHeight: 1.6, marginBottom: 20 };
  const buttonStyle = {
    background: colors.green, color: colors.bg, border: "none", borderRadius: 4,
    padding: "11px 24px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer",
  };

  if (state === "verifying") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={titleStyle}>Verifying…</div>
          <div style={bodyStyle}>Confirming your email address.</div>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
          <div style={titleStyle}>Email verified</div>
          <div style={bodyStyle}>You're all set — continue setting up your account.</div>
          <button style={buttonStyle} onClick={() => navigate("/onboarding", { replace: true })}>
            Continue →
          </button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={titleStyle}>Couldn't verify email</div>
          <div style={{ ...bodyStyle, color: colors.red }}>{error}</div>
          {user && !resent && (
            <button style={buttonStyle} onClick={handleResend}>Send a new link</button>
          )}
          {resent && <div style={{ ...bodyStyle, color: colors.green }}>New verification email sent — check your inbox.</div>}
        </div>
      </div>
    );
  }

  // "awaiting" — no token in URL, user landed here directly (e.g. right after signup)
  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
        <div style={titleStyle}>Check your email</div>
        <div style={bodyStyle}>
          We sent a verification link to {user?.email || "your email address"}.
          Click it to confirm your account.
        </div>
        {!resent ? (
          <button style={buttonStyle} onClick={handleResend}>Resend email</button>
        ) : (
          <div style={{ ...bodyStyle, color: colors.green }}>Sent — check your inbox.</div>
        )}
        {error && <div style={{ ...bodyStyle, color: colors.red, marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
