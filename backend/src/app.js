require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// Validates all shared/critical config at boot — fails fast with a clear,
// consolidated report if anything required is missing or malformed. See H2.
const config = require("./lib/config");
config.assertApiConfig(); // this process also needs JWT + CORS validated

const logger = require("./lib/logger");
const { initSocket } = require("./lib/socket");
const prisma = require("./lib/prisma");
const { notFound, errorHandler } = require("./middleware/error");

// Routes
const authRoutes       = require("./api/v1/auth/auth.routes");
const signalRoutes     = require("./api/v1/signals/signals.routes");
const proposalRoutes   = require("./api/v1/proposals/proposals.routes");
const portfolioRoutes  = require("./api/v1/portfolios/portfolios.routes");
const positionRoutes   = require("./api/v1/positions/positions.routes");
const walletRoutes     = require("./api/v1/wallets/wallets.routes");
const auditRoutes          = require("./api/v1/audit/audit.routes");
const notificationRoutes   = require("./api/v1/notifications/notifications.routes");
const pushRoutes            = require("./api/v1/push/push.routes");
const { processRetries }    = require("./notifications/dispatcher");
const websocketAdapter      = require("./notifications/adapters/websocket.adapter");
const reportRoutes          = require("./api/v1/reports/reports.routes");
const marketingRoutes       = require("./api/v1/marketing/marketing.routes");
const onboardingRoutes     = require("./api/v1/onboarding/onboarding.routes");
const { runWeeklySummaries } = require("./services/lifecycle.service");

const app = express();
const server = http.createServer(app);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected", ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/v1/auth",       authRoutes);
app.use("/api/v1/signals",    signalRoutes);
app.use("/api/v1/proposals",  proposalRoutes);
app.use("/api/v1/portfolios", portfolioRoutes);
app.use("/api/v1/positions",  positionRoutes);
app.use("/api/v1/wallets",    walletRoutes);
app.use("/api/v1/audit",         auditRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/push",          pushRoutes);
app.use("/api/v1/reports",       reportRoutes);
app.use("/api/v1/marketing",     marketingRoutes);
app.use("/api/v1/onboarding",    onboardingRoutes);
app.use("/api/v1/chains",        require("./api/v1/chains/chains.routes"));
app.use("/unsubscribe",          marketingRoutes);

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = initSocket(server);
websocketAdapter.setIo(io);

// ── Notification retry worker — runs every 30 seconds ─────────────────────────
setInterval(async () => {
  try { await processRetries(); }
  catch (err) { logger.error("Retry worker error", { error: err.message }); }
}, 30_000);

// Weekly summary — runs every Monday at 00:00 UTC
setInterval(async () => {
  const now = new Date();
  if (now.getUTCDay() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() < 1) {
    try { await runWeeklySummaries(); }
    catch (err) { logger.error("Weekly summary error", { error: err.message }); }
  }
}, 60_000);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`QuantEdge API running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("API shutting down...");
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

module.exports = { app, server };
