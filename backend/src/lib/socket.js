const { Client } = require("pg");
const { Server } = require("socket.io");
const logger = require("./logger");
const { events, EVENTS } = require("./events");

// Listen for Postgres NOTIFY from worker process
async function startPgListener(io) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("LISTEN signal_created");
    await client.query("LISTEN proposal_executed");
    await client.query("LISTEN position_closed");
    await client.query("LISTEN notification_new");
    logger.info("Postgres LISTEN active on channel: signal_created");

    client.on("notification", (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        // Emit to global signals room
        io.to("signals:global").emit(EVENTS.SIGNAL_NEW, payload);
        // Emit proposal:created to each affected portfolio room
        if (payload.proposals) {
          for (const p of payload.proposals) {
            if (p.evaluationStatus === "APPROVED") {
              io.to(`portfolio:${p.portfolioId}`).emit(EVENTS.PROPOSAL_CREATED, p);
            }
          }
        }
        // Route by channel
        if (msg.channel === "proposal_executed") {
          io.to(`portfolio:${payload.portfolioId}`).emit(EVENTS.PROPOSAL_STATUS, payload);
          io.to(`portfolio:${payload.portfolioId}`).emit(EVENTS.POSITION_UPDATED, payload);
        } else if (msg.channel === "position_closed") {
          io.to(`portfolio:${payload.portfolioId}`).emit(EVENTS.POSITION_UPDATED, payload);
        }
        if (msg.channel === "notification_new") {
          io.to(`user:${payload.userId}`).emit("notification:new", payload);
        }
        logger.debug("Socket broadcast from pg_notify", { channel: msg.channel, payload });
      } catch (err) {
        logger.warn("Failed to parse pg_notify payload", { error: err.message });
      }
    });

    client.on("error", (err) => {
      logger.error("Postgres listener error", { error: err.message });
    });
  } catch (err) {
    logger.error("Failed to start Postgres listener", { error: err.message });
  }
}

let io;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.debug("Socket connected", { socketId: socket.id });

    // Client subscribes to a portfolio room
    socket.on("subscribe:portfolio", (portfolioId) => {
      socket.join(`portfolio:${portfolioId}`);
      logger.debug("Socket joined portfolio room", { socketId: socket.id, portfolioId });
    });

    // Client subscribes to global signal feed
    socket.on("subscribe:signals", () => {
      socket.join("signals:global");
      logger.debug("Socket joined signals room", { socketId: socket.id });
    });

    socket.on("subscribe:user", (userId) => {
      socket.join(`user:${userId}`);
      logger.debug("Socket joined user room", { socketId: socket.id, userId });
    });

    socket.on("subscribe:workspace", (workspaceId) => {
      socket.join(`workspace:${workspaceId}`);
      logger.debug("Socket joined workspace room", { socketId: socket.id, workspaceId });
    });

    socket.on("disconnect", () => {
      logger.debug("Socket disconnected", { socketId: socket.id });
    });
  });

  // Bridge internal events → socket.io rooms
  events.on(EVENTS.SIGNAL_NEW, (data) => {
    io.to("signals:global").emit(EVENTS.SIGNAL_NEW, data);
  });

  events.on(EVENTS.SIGNAL_EVALUATION, (data) => {
    io.to(`portfolio:${data.portfolioId}`).emit(EVENTS.SIGNAL_EVALUATION, data);
  });

  events.on(EVENTS.PROPOSAL_CREATED, (data) => {
    io.to(`portfolio:${data.portfolioId}`).emit(EVENTS.PROPOSAL_CREATED, data);
  });

  events.on(EVENTS.PROPOSAL_STATUS, (data) => {
    io.to(`portfolio:${data.portfolioId}`).emit(EVENTS.PROPOSAL_STATUS, data);
  });

  events.on(EVENTS.POSITION_UPDATED, (data) => {
    io.to(`portfolio:${data.portfolioId}`).emit(EVENTS.POSITION_UPDATED, data);
  });

  events.on(EVENTS.REGIME_TRANSITION, (data) => {
    io.to("signals:global").emit(EVENTS.REGIME_TRANSITION, data);
  });

  events.on(EVENTS.RISK_EVENT, (data) => {
    io.to(`portfolio:${data.portfolioId}`).emit(EVENTS.RISK_EVENT, data);
  });

  events.on(EVENTS.NOTIFICATION_NEW, (data) => {
    io.to(`portfolio:${data.portfolioId}`).emit(EVENTS.NOTIFICATION_NEW, data);
  });

  // Start Postgres NOTIFY listener for worker-generated events
  startPgListener(io);

  logger.info("Socket.io initialized");
  return io;
}

function getIo() {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
}

module.exports = { initSocket, getIo };
