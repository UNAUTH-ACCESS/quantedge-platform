// All formatting for display — internal IDs, enums, and values
// are transformed here before reaching the UI layer

export const fmt = {
  usd: (v, decimals = 2) =>
    v == null ? "—" :
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v),

  pct: (v, decimals = 2) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`,

  num: (v, decimals = 4) =>
    v == null ? "—" : v.toFixed(decimals),

  addr: (a) =>
    !a ? "—" : `${a.slice(0, 6)}…${a.slice(-4)}`,

  ts: (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
  },

  tsShort: (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });
  },

  // Human-readable duration from now
  ago: (s) => {
    if (!s) return "—";
    const diff = Math.floor((Date.now() - new Date(s)) / 1000);
    if (diff < 60)  return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  // Strength bar percentage
  strength: (v) => `${(v * 100).toFixed(0)}%`,

  // Kelly size display
  kelly: (v) => v == null ? "—" : `${(v * 100).toFixed(1)}% Kelly`,

  // Direction display
  direction: (d) => d === "LONG" ? "Long" : d === "SHORT" ? "Short" : d,

  // Chain display
  chain: (c) => c === "SOLANA" ? "SOL" : c === "EVM" ? "EVM" : c,
};
