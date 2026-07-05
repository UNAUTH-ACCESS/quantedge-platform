/**
 * Lifecycle Email Service
 *
 * Sends triggered emails based on user actions and system events.
 * Separate from marketing (subscribers) and notifications (alerts).
 *
 * Triggers:
 *   welcome          — workspace created
 *   first_trade      — first confirmed fill
 *   drawdown_alert   — max drawdown breached
 *   weekly_summary   — every Monday 00:00 UTC
 *   inactivity       — no login in 14 days
 */

const prisma = require("../lib/prisma");
const logger = require("../lib/logger");

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_ADDRESS   = "QuantEdge <onboarding@resend.dev>";
const APP_URL        = process.env.APP_URL || "https://quantedge-live.duckdns.org";

// ── Triggers ──────────────────────────────────────────────────────────────────

async function sendWelcome(userId, workspaceId) {
  try {
    const user      = await prisma.user.findUnique({ where: { id: userId } });
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!user || !workspace) return;

    await send(user.email, `Welcome to QuantEdge, ${user.name}`, buildWelcome(user, workspace));
    logger.info("[lifecycle] Welcome email sent", { userId, email: user.email });
  } catch (err) {
    logger.warn("[lifecycle] Welcome email failed", { userId, error: err.message });
  }
}

async function sendFirstTrade(userId, workspaceId, tradeData) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    await send(user.email, "Your first trade on QuantEdge", buildFirstTrade(user, tradeData));
    logger.info("[lifecycle] First trade email sent", { userId });
  } catch (err) {
    logger.warn("[lifecycle] First trade email failed", { userId, error: err.message });
  }
}

async function sendDrawdownAlert(userId, workspaceId, portfolioName, drawdownPct, threshold) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    await send(
      user.email,
      `⚠️ Drawdown alert: ${portfolioName} is down ${drawdownPct.toFixed(1)}%`,
      buildDrawdownAlert(user, portfolioName, drawdownPct, threshold)
    );
    logger.info("[lifecycle] Drawdown alert sent", { userId, drawdownPct });
  } catch (err) {
    logger.warn("[lifecycle] Drawdown alert failed", { userId, error: err.message });
  }
}

async function sendWeeklySummary(userId, workspaceId, report) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    await send(user.email, `QuantEdge weekly summary — ${formatDate(new Date())}`, buildWeeklySummary(user, report));
    logger.info("[lifecycle] Weekly summary sent", { userId });
  } catch (err) {
    logger.warn("[lifecycle] Weekly summary failed", { userId, error: err.message });
  }
}

// ── Scheduled jobs (called from worker) ──────────────────────────────────────

async function runWeeklySummaries() {
  const { generateReport } = require("./reporting.service");

  const workspaces = await prisma.workspace.findMany({
    where:   { status: "ACTIVE" },
    include: { portfolios: true, owner: true },
  });

  for (const workspace of workspaces) {
    for (const portfolio of workspace.portfolios) {
      try {
        const report = await generateReport(portfolio.id, "weekly");
        await sendWeeklySummary(workspace.ownerId, workspace.id, report);
      } catch (err) {
        logger.warn("[lifecycle] Weekly summary job failed", { workspaceId: workspace.id, error: err.message });
      }
    }
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function buildWelcome(user, workspace) {
  return layout(`
    <p style="font-size:18px;font-weight:600;margin-bottom:16px;color:#E8F4F8;">
      Welcome, ${user.name}
    </p>
    <p style="margin-bottom:16px;color:#9BA8B4;">
      Your workspace <strong style="color:#E8F4F8;">${workspace.name}</strong> is ready.
      QuantEdge is now running systematic signal detection on live market data.
    </p>
    <p style="margin-bottom:16px;color:#9BA8B4;">
      Here's what happens next:
    </p>
    <ol style="margin-bottom:20px;padding-left:20px;color:#9BA8B4;">
      <li style="margin-bottom:8px;">Connect your wallet in Settings</li>
      <li style="margin-bottom:8px;">Review your risk configuration</li>
      <li style="margin-bottom:8px;">Wait for the first signal — it fires every 2 minutes when the edge is there</li>
      <li style="margin-bottom:8px;">Sign your first trade proposal or enable auto-execute</li>
    </ol>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#00D4AA;color:#0A0A0F;
       padding:12px 24px;border-radius:4px;font-weight:700;text-decoration:none;font-size:13px;">
      Open Dashboard →
    </a>
  `);
}

function buildFirstTrade(user, trade) {
  const pnlSign = (trade.realizedPnl || 0) >= 0 ? "+" : "";
  return layout(`
    <p style="font-size:16px;font-weight:600;margin-bottom:16px;color:#E8F4F8;">
      ✅ Your first trade is confirmed
    </p>
    <div style="background:#0A0A0F;border:1px solid #1E1E2E;border-radius:6px;padding:16px;margin-bottom:20px;">
      ${tradeRow("Asset",      `${trade.asset} ${trade.direction}`)}
      ${tradeRow("Venue",      trade.venue)}
      ${tradeRow("Fill Price", `$${trade.fillPrice?.toFixed(2)}`)}
      ${tradeRow("Size",       trade.size?.toFixed(4))}
      ${tradeRow("Fee Paid",   `$${trade.feePaid?.toFixed(2)}`)}
    </div>
    <a href="${APP_URL}/positions" style="display:inline-block;background:#00D4AA;color:#0A0A0F;
       padding:12px 24px;border-radius:4px;font-weight:700;text-decoration:none;font-size:13px;">
      View Position →
    </a>
  `);
}

function buildDrawdownAlert(user, portfolioName, drawdownPct, threshold) {
  return layout(`
    <p style="font-size:16px;font-weight:600;margin-bottom:16px;color:#FF4D6D;">
      ⚠️ Drawdown alert
    </p>
    <p style="margin-bottom:16px;color:#9BA8B4;">
      <strong style="color:#E8F4F8;">${portfolioName}</strong> has reached a drawdown of
      <strong style="color:#FF4D6D;">${drawdownPct.toFixed(2)}%</strong>,
      which exceeds your configured threshold of ${threshold}%.
    </p>
    <p style="margin-bottom:20px;color:#9BA8B4;">
      The strategy has been automatically paused. All open positions are being monitored.
      Review your portfolio and adjust risk parameters if needed.
    </p>
    <a href="${APP_URL}/portfolio" style="display:inline-block;background:#FF4D6D;color:white;
       padding:12px 24px;border-radius:4px;font-weight:700;text-decoration:none;font-size:13px;">
      Review Portfolio →
    </a>
  `);
}

function buildWeeklySummary(user, report) {
  const s = report.summary;
  const n = report.nav;
  const pnlColor = s.totalPnl >= 0 ? "#00D4AA" : "#FF4D6D";

  return layout(`
    <p style="font-size:16px;font-weight:600;margin-bottom:16px;color:#E8F4F8;">
      Weekly Summary — ${report.portfolioName}
    </p>
    <div style="background:#0A0A0F;border:1px solid #1E1E2E;border-radius:6px;padding:16px;margin-bottom:16px;">
      <div style="font-size:24px;font-weight:700;color:${pnlColor};margin-bottom:4px;">
        ${s.totalPnl >= 0 ? "+" : ""}$${(s.totalPnl || 0).toFixed(2)}
      </div>
      <div style="font-size:11px;color:#5A6478;">Realized P&L this week</div>
    </div>
    <div style="background:#0A0A0F;border:1px solid #1E1E2E;border-radius:6px;padding:16px;margin-bottom:20px;">
      ${tradeRow("Trades",       s.totalTrades)}
      ${tradeRow("Win Rate",     `${(s.winRate || 0).toFixed(1)}%`)}
      ${tradeRow("Profit Factor", s.profitFactor ? s.profitFactor.toFixed(2) : "—")}
      ${tradeRow("Max Drawdown", `${(n.maxDrawdown || 0).toFixed(2)}%`)}
      ${tradeRow("Sharpe Ratio", (n.sharpe || 0).toFixed(3))}
      ${tradeRow("NAV",          `$${(n.end || 0).toFixed(2)}`)}
    </div>
    <a href="${APP_URL}/portfolio" style="display:inline-block;background:#00D4AA;color:#0A0A0F;
       padding:12px 24px;border-radius:4px;font-weight:700;text-decoration:none;font-size:13px;">
      Full Report →
    </a>
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function layout(body) {
  return `
<!DOCTYPE html><html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#0A0A0F;color:#E8F4F8;font-family:'Courier New',monospace;padding:32px;margin:0;">
  <div style="max-width:540px;margin:0 auto;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
      <div style="width:18px;height:18px;background:#00D4AA;
                  clip-path:polygon(50% 0%,100% 100%,0% 100%);"></div>
      <span style="font-size:13px;font-weight:700;letter-spacing:0.08em;">QuantEdge</span>
    </div>
    <div style="background:#111118;border:1px solid #1E1E2E;border-radius:6px;padding:24px;margin-bottom:20px;">
      ${body}
    </div>
    <div style="font-size:10px;color:#5A6478;">
      QuantEdge · ${APP_URL}
    </div>
  </div>
</body></html>`;
}

function tradeRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;padding:6px 0;
                border-bottom:1px solid #1E1E2E;font-size:12px;">
      <span style="color:#5A6478;">${label}</span>
      <span style="color:#E8F4F8;font-weight:500;">${value ?? "—"}</span>
    </div>`;
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

async function send(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch(RESEND_API_URL, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return res.json();
}

module.exports = {
  sendWelcome, sendFirstTrade, sendDrawdownAlert,
  sendWeeklySummary, runWeeklySummaries,
};
