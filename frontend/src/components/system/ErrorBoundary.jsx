import { Component } from "react";

// Catches all unhandled React errors
// Shows a recovery UI instead of a blank screen
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production: send to error tracking service
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh",
        background: "#0A0A0F",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', monospace",
        color: "#E8F4F8",
        padding: "24px",
      }}>
        <div style={{ maxWidth: 480, width: "100%" }}>
          <div style={{ color: "#FF4D6D", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            Application Error
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 12, color: "#5A6478", lineHeight: 1.6, marginBottom: 24 }}>
            The application encountered an unexpected error. Your session and data are safe.
          </div>
          <div style={{
            background: "#111118",
            border: "1px solid #1E1E2E",
            borderRadius: 6,
            padding: "12px 16px",
            fontSize: 11,
            color: "#5A6478",
            marginBottom: 24,
            wordBreak: "break-word",
          }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#00D4AA",
              color: "#0A0A0F",
              border: "none",
              borderRadius: 4,
              padding: "10px 20px",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }
}
