import { useState } from "react";
import { usePolling } from "../../hooks/useApi";
import { positions as positionsApi, portfolios as portfoliosApi } from "../../api/endpoints";
import { EmptyState, LoadingState, ErrorState } from "../../components/system/SystemStatus";
import { colors } from "../../lib/tokens";
import { fmt } from "../../lib/format";

function pnlColor(v) {
  if (v == null) return colors.text;
  return v >= 0 ? colors.green : colors.red;
}

function holdTime(openedAt, closedAt) {
  const ms = new Date(closedAt || Date.now()) - new Date(openedAt);
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function SummaryMetric({ label, value, valueColor, sub }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 600, color: valueColor || colors.text }}>{value}</div>
      {sub && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: colors.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ChainTag({ chain }) {
  const chainType = chain?.type || chain || "";
  const isSol  = chainType === "SOLANA";
  const isTron = chainType === "TRON";
  const bg    = isSol ? "#9945FF22" : isTron ? "#FF060622" : "#627EEA22";
  const fg    = isSol ? "#9945FF"   : isTron ? "#FF0606"   : "#627EEA";
  const label = isSol ? "SOL" : isTron ? "TRX" : "EVM";
  return (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: bg, color: fg, border: `1px solid ${fg}44` }}>
      {label}
    </span>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div style={{ padding: "10px 16px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
      {count != null && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted, background: colors.surface2, border: `1px solid ${colors.border2}`, borderRadius: 3, padding: "1px 6px" }}>{count}</span>
      )}
    </div>
  );
}

function TableHead({ cols }) {
  return (
    <thead>
      <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
        {cols.map(({ label, align = "right" }) => (
          <th key={label} style={{ padding: "8px 12px", textAlign: align === "left" ? "left" : "right", fontSize: 10, color: colors.muted, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{label}</th>
        ))}
      </tr>
    </thead>
  );
}

function Cell({ children, align = "right", color }) {
  return (
    <td style={{ padding: "9px 12px", textAlign: align, fontSize: 11, color: color || colors.text, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{children}</td>
  );
}

function ChainBalancePanel({ openPositions }) {
  const byChain = {};
  for (const p of openPositions) {
    const key = p.chain?.type || "UNKNOWN";
    if (!byChain[key]) byChain[key] = { chain: p.chain, invested: 0, unrealized: 0, count: 0 };
    byChain[key].invested   += p.size * p.entryPrice;
    byChain[key].unrealized += p.unrealizedPnl;
    byChain[key].count      += 1;
  }
  const rows = Object.entries(byChain);
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <SectionHeader title="Wallet Balance by Chain" count={rows.length}/>
      {rows.length === 0 ? <EmptyState message="No active positions"/> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <TableHead cols={[{ label: "Chain", align: "left" }, { label: "Positions" }, { label: "Deployed" }, { label: "Unrealized" }, { label: "Net Value" }]}/>
            <tbody>
              {rows.map(([key, { chain, invested, unrealized, count }]) => (
                <tr key={key} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <Cell align="left"><ChainTag chain={chain}/></Cell>
                  <Cell>{count}</Cell>
                  <Cell>{fmt.usd(invested)}</Cell>
                  <Cell color={pnlColor(unrealized)}>{fmt.usd(unrealized)}</Cell>
                  <Cell color={pnlColor(invested + unrealized)}>{fmt.usd(invested + unrealized)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OpenPositionsTable({ positions }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <SectionHeader title="Open Positions" count={positions.length}/>
      {positions.length === 0 ? <EmptyState message="No open positions"/> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <TableHead cols={[
              { label: "Asset", align: "left" }, { label: "Chain", align: "left" }, { label: "Side", align: "left" },
              { label: "Size" }, { label: "Entry" }, { label: "Current" }, { label: "Entry Notional" }, { label: "Unrealized" }, { label: "Open" },
            ]}/>
            <tbody>
              {positions.map(p => {
                const entryNotional = p.size * p.entryPrice;
                const priceDelta    = p.currentPrice - p.entryPrice;
                const priceDeltaPct = (priceDelta / p.entryPrice) * 100;
                return (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <Cell align="left"><span style={{ fontWeight: 600 }}>{p.asset?.symbol || "—"}</span></Cell>
                    <Cell align="left"><ChainTag chain={p.chain}/></Cell>
                    <Cell align="left"><span style={{ color: p.side === "LONG" ? colors.green : colors.red, fontSize: 10, fontWeight: 700 }}>{p.side}</span></Cell>
                    <Cell>{fmt.num(p.size, 4)}</Cell>
                    <Cell>{fmt.usd(p.entryPrice, 4)}</Cell>
                    <Cell color={pnlColor(priceDelta)}>
                      {fmt.usd(p.currentPrice, 4)}<span style={{ fontSize: 9, marginLeft: 4 }}>({fmt.pct(priceDeltaPct, 2)})</span>
                    </Cell>
                    <Cell>{fmt.usd(entryNotional)}</Cell>
                    <Cell color={pnlColor(p.unrealizedPnl)}>
                      <span style={{ fontWeight: 600 }}>{fmt.usd(p.unrealizedPnl)}</span>
                      <div style={{ fontSize: 9, marginTop: 1 }}>{fmt.pct((p.unrealizedPnl / entryNotional) * 100)}</div>
                    </Cell>
                    <Cell>{fmt.ago(p.openedAt)}</Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClosedPositionsTable({ positions }) {
  const [limit, setLimit] = useState(20);
  const shown = positions.slice(0, limit);
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <SectionHeader title="Closed Positions" count={positions.length}/>
      {positions.length === 0 ? <EmptyState message="No closed positions yet"/> : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <TableHead cols={[
                { label: "Asset", align: "left" }, { label: "Chain", align: "left" }, { label: "Side", align: "left" },
                { label: "Size" }, { label: "Entry" }, { label: "Entry Notional" }, { label: "Return Amount" }, { label: "Realized P&L" }, { label: "Hold" }, { label: "Closed" },
              ]}/>
              <tbody>
                {shown.map(p => {
                  const entryNotional = p.size * p.entryPrice;
                  const returnAmount  = entryNotional + p.realizedPnl;
                  return (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <Cell align="left"><span style={{ fontWeight: 600 }}>{p.asset?.symbol || "—"}</span></Cell>
                      <Cell align="left"><ChainTag chain={p.chain}/></Cell>
                      <Cell align="left"><span style={{ color: p.side === "LONG" ? colors.green : colors.red, fontSize: 10, fontWeight: 700 }}>{p.side}</span></Cell>
                      <Cell>{fmt.num(p.size, 4)}</Cell>
                      <Cell>{fmt.usd(p.entryPrice, 4)}</Cell>
                      <Cell>{fmt.usd(entryNotional)}</Cell>
                      <Cell color={pnlColor(p.realizedPnl)}>{fmt.usd(returnAmount)}</Cell>
                      <Cell color={pnlColor(p.realizedPnl)}>
                        <span style={{ fontWeight: 600 }}>{fmt.usd(p.realizedPnl)}</span>
                        <div style={{ fontSize: 9, marginTop: 1 }}>{fmt.pct((p.realizedPnl / entryNotional) * 100)}</div>
                      </Cell>
                      <Cell>{holdTime(p.openedAt, p.closedAt)}</Cell>
                      <Cell>{fmt.ts(p.closedAt)}</Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {positions.length > limit && (
            <div style={{ padding: "12px 16px", borderTop: `1px solid ${colors.border}` }}>
              <button onClick={() => setLimit(l => l + 20)} style={{ background: "transparent", border: `1px solid ${colors.border2}`, borderRadius: 4, padding: "6px 14px", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: colors.muted, cursor: "pointer" }}>
                Load more ({positions.length - limit} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PnLDashboard() {
  const { data: openData,   loading: loadingOpen,   error: errorOpen }   = usePolling(() => positionsApi.list({ status: "OPEN" }),   15000);
  const { data: closedData, loading: loadingClosed }                     = usePolling(() => positionsApi.list({ status: "CLOSED" }), 30000);
  const { data: portfolios }                                              = usePolling(() => portfoliosApi.list(), 30000);

  const openPositions   = openData   || [];
  const closedPositions = closedData || [];
  const snap            = portfolios?.[0]?.latestSnapshot;

  const totalUnrealized = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalRealized   = closedPositions.reduce((s, p) => s + p.realizedPnl, 0);
  const netPnl          = totalRealized + totalUnrealized;
  const totalDeployed   = openPositions.reduce((s, p) => s + p.size * p.entryPrice, 0);

  if (loadingOpen) return <LoadingState rows={6}/>;
  if (errorOpen)   return <ErrorState error={errorOpen}/>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>P&L</h1>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted, letterSpacing: "0.06em" }}>LIVE · 15s</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <SummaryMetric label="Net P&L"      value={fmt.usd(netPnl)}          valueColor={pnlColor(netPnl)}          sub="Realized + Unrealized"/>
        <SummaryMetric label="Realized"      value={fmt.usd(totalRealized)}   valueColor={pnlColor(totalRealized)}   sub={`${closedPositions.length} closed`}/>
        <SummaryMetric label="Unrealized"    value={fmt.usd(totalUnrealized)} valueColor={pnlColor(totalUnrealized)} sub={`${openPositions.length} open`}/>
        <SummaryMetric label="Deployed"      value={fmt.usd(totalDeployed)}   sub="Entry notional, open"/>
        <SummaryMetric label="Portfolio NAV" value={snap?.nav ? fmt.usd(snap.nav) : "—"} valueColor={colors.green} sub="Latest snapshot"/>
      </div>
      <ChainBalancePanel openPositions={openPositions}/>
      <OpenPositionsTable positions={openPositions}/>
      {loadingClosed ? <LoadingState rows={4}/> : <ClosedPositionsTable positions={closedPositions}/>}
    </div>
  );
}
