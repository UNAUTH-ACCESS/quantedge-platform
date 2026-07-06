import { useState } from "react";
import { marketing } from "../../api/endpoints";
import { colors } from "../../lib/tokens";

export default function SubscribePage() {
  const [email,  setEmail]  = useState("");
  const [name,   setName]   = useState("");
  const [state,  setState]  = useState("idle"); // idle | submitting | done | error
  const [error,  setError]  = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState("submitting");
    setError(null);
    try {
      await marketing.subscribe(email, name || null, "website");
      setState("done");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setState("error");
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
      <div style={{ width: "100%", maxWidth: 480 }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40 }}>
          <div style={{
            width: 28, height: 28,
            background: colors.green,
            clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
          }}/>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em" }}>
              QuantEdge
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Systematic Trading
            </div>
          </div>
        </div>

        {state === "done" ? (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.green}44`,
            borderRadius: 8, padding: 32, textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>You're on the list</div>
            <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.6 }}>
              We'll reach out when early access opens. In the meantime, check your inbox for a welcome email.
            </div>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, color: colors.green,
                letterSpacing: "0.1em", textTransform: "uppercase",
                marginBottom: 12,
              }}>
                Private Beta
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3, marginBottom: 16 }}>
                Systematic trading,<br/>built on validated research
              </h1>
              <p style={{ fontSize: 14, color: colors.muted, lineHeight: 1.7 }}>
                QuantEdge runs a quantitative signal engine on live market data — not tips,
                not copy trading, not vibes. Every signal passes 8 statistical gates before
                it reaches your portfolio.
              </p>
            </div>

            {/* Features */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
              {[
                ["⚡", "Research-validated signals", "8-gate walk-forward validation, deflated Sharpe, noise stress testing"],
                ["🔐", "Self-custody execution",    "Your keys, your funds. Every trade requires your wallet signature"],
                ["🔄", "Regime-aware",              "Knows when the market is trending, ranging, or in stress"],
                ["🤖", "Fully autonomous",          "Entry, monitoring, and exit without manual intervention"],
              ].map(([icon, title, desc]) => (
                <div key={title} style={{
                  display: "flex", gap: 12, alignItems: "flex-start",
                  padding: "12px 16px",
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
                    <div style={{ fontSize: 11, color: colors.muted, lineHeight: 1.5 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Form */}
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border2}`,
              borderRadius: 8, padding: 24,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                Get early access
              </div>
              <div style={{ fontSize: 12, color: colors.muted, marginBottom: 20 }}>
                Join the waitlist. Early access invites go to this list first.
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", fontSize: 11, color: colors.muted, marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Name (optional)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    disabled={state === "submitting"}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: colors.surface2,
                      border: `1px solid ${colors.border2}`,
                      borderRadius: 4, padding: "10px 12px",
                      fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      color: colors.text, outline: "none",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, color: colors.muted, marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Email *
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    disabled={state === "submitting"}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: colors.surface2,
                      border: `1px solid ${colors.border2}`,
                      borderRadius: 4, padding: "10px 12px",
                      fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      color: colors.text, outline: "none",
                    }}
                  />
                </div>

                {error && (
                  <div style={{
                    background: "#FF4D6D11", border: "1px solid #FF4D6D44",
                    borderRadius: 4, padding: "10px 12px", marginBottom: 14,
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.red,
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={state === "submitting" || !email}
                  style={{
                    width: "100%",
                    background: state === "submitting" ? colors.surface2 : colors.green,
                    color:      state === "submitting" ? colors.muted     : colors.bg,
                    border: "none", borderRadius: 4, padding: "12px",
                    fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700, letterSpacing: "0.06em",
                    cursor: state === "submitting" ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  {state === "submitting" ? "Joining…" : "Join the waitlist →"}
                </button>

                <div style={{ marginTop: 12, fontSize: 10, color: colors.muted, textAlign: "center" }}>
                  No spam. Unsubscribe any time.
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
