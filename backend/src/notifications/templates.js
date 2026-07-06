/**
 * Notification Templates
 *
 * Maps event types to structured notification payloads.
 * Single source of truth for all notification content.
 * Adding a new event type requires only adding a case here.
 */

const PRIORITY = {
  CRITICAL: "CRITICAL",
  HIGH:     "HIGH",
  MEDIUM:   "MEDIUM",
  LOW:      "LOW",
};

/**
 * Build a notification payload from an event.
 *
 * @param {string} eventType
 * @param {object} data
 * @returns {{ type, priority, title, body, entityId, entityType }}
 */
function buildNotification(eventType, data = {}) {
  switch (eventType) {

    // ── CRITICAL ────────────────────────────────────────────────────────
    case "DRAWDOWN_BREACH":
      return {
        type:       "RISK",
        priority:   PRIORITY.CRITICAL,
        title:      `🚨 Drawdown breach: ${data.portfolioName || "Portfolio"}`,
        body:       `Portfolio down ${data.drawdownPct?.toFixed(2)}% — strategy paused. Threshold: ${data.threshold}%`,
        entityId:   data.portfolioId,
        entityType: "Portfolio",
      };

    case "LIQUIDATION":
      return {
        type:       "RISK",
        priority:   PRIORITY.CRITICAL,
        title:      `🚨 Position liquidated: ${data.asset}`,
        body:       `${data.asset} ${data.side} position liquidated on ${data.venue}`,
        entityId:   data.positionId,
        entityType: "Position",
      };

    case "SETTLEMENT_FAILED":
      return {
        type:       "RISK",
        priority:   PRIORITY.CRITICAL,
        title:      `🚨 Settlement failed — funds not returned`,
        body:       `On-chain settlement failed after retries for position ${data.positionId}. Amount owed: $${data.returnAmount?.toFixed(2)} on ${data.chainKey}. Error: ${data.error}. Manual intervention required.`,
        entityId:   data.positionId,
        entityType: "Position",
      };

    // ── HIGH ─────────────────────────────────────────────────────────────
    case "STOP_LOSS":
      return {
        type:       "RISK",
        priority:   PRIORITY.HIGH,
        title:      `⚠️ Stop loss: ${data.asset}`,
        body:       `${data.asset} position down ${data.pnlPct?.toFixed(2)}% — auto-closing. Threshold: ${data.threshold}%`,
        entityId:   data.positionId,
        entityType: "Position",
      };

    case "TRADE_EXECUTED":
      return {
        type:       "TRADE",
        priority:   PRIORITY.HIGH,
        title:      `✅ Trade filled: ${data.asset} ${data.direction}`,
        body:       `${data.asset} ${data.direction} ${data.size?.toFixed(4)} @ $${data.fillPrice?.toFixed(2)} via ${data.venue} | Fee: $${data.feePaid?.toFixed(2)}`,
        entityId:   data.proposalId,
        entityType: "TradeProposal",
      };

    case "POSITION_CLOSED":
      return {
        type:       "TRADE",
        priority:   PRIORITY.HIGH,
        title:      `${data.realizedPnl >= 0 ? "✅" : "🔴"} Position closed: ${data.asset}`,
        body:       `${data.asset} ${data.side} closed | Realized P&L: ${data.realizedPnl >= 0 ? "+" : ""}$${data.realizedPnl?.toFixed(2)} | Reason: ${data.reason?.replace(/_/g, " ")}`,
        entityId:   data.positionId,
        entityType: "Position",
      };

    case "RISK_EVENT":
      return {
        type:       "RISK",
        priority:   PRIORITY.HIGH,
        title:      `⚠️ Risk event: ${data.type?.replace(/_/g, " ")}`,
        body:       `Value: ${data.value?.toFixed(2)} | Threshold: ${data.threshold} | Action: ${data.actionTaken || "logged"}`,
        entityId:   data.portfolioId,
        entityType: "Portfolio",
      };

    // ── MEDIUM ───────────────────────────────────────────────────────────
    case "SIGNAL_GENERATED":
      return {
        type:       "SIGNAL",
        priority:   PRIORITY.MEDIUM,
        title:      `⚡ Signal: ${data.asset} ${data.direction}`,
        body:       `Strength ${data.strength?.toFixed(3)} | Kelly ${(data.kellySize * 100)?.toFixed(1)}% | Regime: ${data.regime?.replace(/_/g, " ")}`,
        entityId:   data.signalId,
        entityType: "Signal",
      };

    case "PROPOSAL_CREATED":
      return {
        type:       "SIGNAL",
        priority:   PRIORITY.MEDIUM,
        title:      `📋 Proposal ready: ${data.asset} ${data.direction}`,
        body:       `$${data.notional?.toFixed(2)} via ${data.venue} | Est. entry: $${data.estEntry?.toFixed(2)} | Awaiting signature`,
        entityId:   data.proposalId,
        entityType: "TradeProposal",
      };

    case "REGIME_TRANSITION":
      return {
        type:       "REGIME",
        priority:   PRIORITY.MEDIUM,
        title:      `🔄 Regime: ${data.from?.replace(/_/g, " ")} → ${data.to?.replace(/_/g, " ")}`,
        body:       `Confidence: ${(data.confidence * 100)?.toFixed(1)}% | BTC Stress: ${data.btcStressIndex?.toFixed(3)} | Transition prob: ${(data.transitionProb * 100)?.toFixed(1)}%`,
        entityId:   data.signalConfigId,
        entityType: "SignalConfig",
      };

    // ── LOW ──────────────────────────────────────────────────────────────
    case "PORTFOLIO_SNAPSHOT":
      return {
        type:       "SYSTEM",
        priority:   PRIORITY.LOW,
        title:      `📊 Portfolio snapshot`,
        body:       `NAV: $${data.nav?.toFixed(2)} | Unrealized: $${data.unrealizedPnl?.toFixed(2)} | Invested: $${data.invested?.toFixed(2)}`,
        entityId:   data.portfolioId,
        entityType: "Portfolio",
      };

    default:
      return {
        type:       "SYSTEM",
        priority:   PRIORITY.LOW,
        title:      eventType,
        body:       JSON.stringify(data).slice(0, 200),
        entityId:   null,
        entityType: null,
      };
  }
}

// Deep link paths for entity types
function entityPath(entityType, entityId) {
  const paths = {
    TradeProposal: `/proposals`,
    Position:      `/positions`,
    Signal:        `/signals`,
    Portfolio:     `/portfolio`,
    SignalConfig:  `/settings`,
  };
  return paths[entityType] || "/dashboard";
}

module.exports = { buildNotification, entityPath, PRIORITY };
