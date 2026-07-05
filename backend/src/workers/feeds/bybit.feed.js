/**
 * Bybit WebSocket Feed Manager
 *
 * Maintains a persistent connection to Bybit v5 public linear stream.
 * Subscriptions: kline.30.BTCUSDT, kline.5.SOLUSDT, orderbook.1.SOLUSDT
 *
 * Responsibilities:
 *   - Connect, subscribe, heartbeat, reconnect
 *   - Parse incoming messages and dispatch to rolling window
 *   - Never crash the worker process on any error
 *
 * Does NOT compute features. Does NOT write to Postgres.
 * All state forwarded to rolling window via callbacks.
 */

const WebSocket = require("ws");
const logger    = require("../../lib/logger");

const WS_URL       = "wss://stream.bybit.com/v5/public/linear";
const PING_INTERVAL_MS  = 20_000;   // Bybit requires ping every 20s
const PONG_TIMEOUT_MS   = 10_000;   // If no pong in 10s, reconnect
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 60_000;

const SUBSCRIPTIONS = [
  "kline.30.BTCUSDT",    // 30-min BTC closes
  "kline.5.SOLUSDT",     // 5-min SOL closes
  "orderbook.1.SOLUSDT", // SOL order book top-of-book
];

class BybitFeed {
  constructor(onKline, onOrderbook) {
    this.onKline     = onKline;     // callback(symbol, interval, bar)
    this.onOrderbook = onOrderbook; // callback(symbol, data)

    this.ws          = null;
    this.pingTimer   = null;
    this.pongTimer   = null;
    this.reconnTimer = null;
    this.backoff     = INITIAL_BACKOFF_MS;
    this.stopped     = false;
    this.connected   = false;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    this._clearTimers();
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
      this.ws = null;
    }
    logger.info("[bybit.feed] Stopped");
  }

  _connect() {
    if (this.stopped) return;

    logger.info("[bybit.feed] Connecting…", { url: WS_URL });

    try {
      this.ws = new WebSocket(WS_URL, {
        handshakeTimeout: 10_000,
        perMessageDeflate: false,
      });
    } catch (err) {
      logger.error("[bybit.feed] Failed to create WebSocket", { error: err.message });
      this._scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      logger.info("[bybit.feed] Connected");
      this.connected = true;
      this.backoff   = INITIAL_BACKOFF_MS;
      this._subscribe();
      this._startPing();
    });

    this.ws.on("message", (raw) => {
      try {
        this._handleMessage(JSON.parse(raw));
      } catch (err) {
        logger.warn("[bybit.feed] Failed to parse message", { error: err.message });
      }
    });

    this.ws.on("pong", () => {
      // Native WebSocket pong
      if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    });

    this.ws.on("error", (err) => {
      logger.error("[bybit.feed] WebSocket error", { error: err.message });
      // 'close' event follows automatically
    });

    this.ws.on("close", (code, reason) => {
      this.connected = false;
      this._clearTimers();
      if (!this.stopped) {
        logger.warn("[bybit.feed] Disconnected", { code, reason: reason?.toString() });
        this._scheduleReconnect();
      }
    });
  }

  _subscribe() {
    const msg = JSON.stringify({ op: "subscribe", args: SUBSCRIPTIONS });
    this._send(msg);
    logger.info("[bybit.feed] Subscribed", { topics: SUBSCRIPTIONS });
  }

  _startPing() {
    this._clearTimers();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // Bybit heartbeat: send JSON ping, expect JSON pong
      this._send(JSON.stringify({ op: "ping" }));

      // Also send native WebSocket ping as fallback
      try { this.ws.ping(); } catch {}

      // Set pong timeout
      this.pongTimer = setTimeout(() => {
        logger.warn("[bybit.feed] Pong timeout — reconnecting");
        try { this.ws.terminate(); } catch {}
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    logger.info("[bybit.feed] Reconnecting", { backoffMs: this.backoff });
    this.reconnTimer = setTimeout(() => {
      this._connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  _clearTimers() {
    if (this.pingTimer)  { clearInterval(this.pingTimer);  this.pingTimer  = null; }
    if (this.pongTimer)  { clearTimeout(this.pongTimer);   this.pongTimer  = null; }
    if (this.reconnTimer){ clearTimeout(this.reconnTimer); this.reconnTimer = null; }
  }

  _send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(msg); } catch (err) {
      logger.warn("[bybit.feed] Send failed", { error: err.message });
    }
  }

  _handleMessage(msg) {
    // Bybit pong response
    if (msg.op === "pong" || msg.ret_msg === "pong") {
      if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
      return;
    }

    // Subscription confirmation
    if (msg.op === "subscribe") {
      if (msg.success) {
        logger.info("[bybit.feed] Subscription confirmed");
      } else {
        logger.warn("[bybit.feed] Subscription failed", { msg });
      }
      return;
    }

    const topic = msg.topic || "";

    // ── Kline (candlestick) ───────────────────────────────────────────────
    if (topic.startsWith("kline.")) {
      const parts    = topic.split(".");       // kline.30.BTCUSDT
      const interval = parts[1];               // "30" or "5"
      const symbol   = parts[2];               // "BTCUSDT" or "SOLUSDT"
      const bars     = msg.data;

      if (!Array.isArray(bars)) return;

      for (const bar of bars) {
        // Only process confirmed (closed) bars
        if (!bar.confirm) continue;

        const parsed = {
          timestamp: parseInt(bar.start),
          open:      parseFloat(bar.open),
          high:      parseFloat(bar.high),
          low:       parseFloat(bar.low),
          close:     parseFloat(bar.close),
          volume:    parseFloat(bar.volume),
          interval,
          symbol,
          confirm:   true,
        };

        try {
          this.onKline(symbol, interval, parsed);
        } catch (err) {
          logger.error("[bybit.feed] onKline callback error", { error: err.message });
        }
      }
      return;
    }

    // ── Order book ────────────────────────────────────────────────────────
    if (topic.startsWith("orderbook.")) {
      const parts  = topic.split(".");         // orderbook.1.SOLUSDT
      const symbol = parts[2];

      try {
        this.onOrderbook(symbol, msg);
      } catch (err) {
        logger.error("[bybit.feed] onOrderbook callback error", { error: err.message });
      }
    }
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

module.exports = BybitFeed;
