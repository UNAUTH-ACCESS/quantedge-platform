/**
 * Rolling Window State Manager
 *
 * Maintains in-memory circular buffers for each instrument/interval.
 * Written by WebSocket callbacks, read by feature computation.
 *
 * Buffers:
 *   BTC  30m kline  — minimum 3 bars  (need lag-2 = 1h back, plus current)
 *   SOL  5m  kline  — minimum 13 bars (need lag-2 at 5m = 10m back, but
 *                                       we keep 13 for regime vol computation)
 *   SOL  orderbook  — current + previous snapshot (for 30m lag)
 *
 * All operations are synchronous — Node.js is single-threaded so no
 * explicit locking is needed. WebSocket callbacks and the signal loop
 * share the same event loop thread.
 */

const logger = require("../../lib/logger");

// How many bars to retain per instrument
const CAPACITY = {
  BTC_30M:  6,   // 3 hours of 30m bars
  SOL_5M:   24,  // 2 hours of 5m bars
};

class CircularBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf      = [];
  }

  push(item) {
    this.buf.push(item);
    if (this.buf.length > this.capacity) {
      this.buf.shift();
    }
  }

  // Most recent item
  latest() {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1] : null;
  }

  // Item at offset from end: offset=0 → latest, offset=1 → previous, etc.
  atOffset(offset) {
    const idx = this.buf.length - 1 - offset;
    return idx >= 0 ? this.buf[idx] : null;
  }

  size() { return this.buf.length; }

  hasAtLeast(n) { return this.buf.length >= n; }

  // Return all items oldest-first
  all() { return [...this.buf]; }
}

class RollingWindowState {
  constructor() {
    this.btc30m  = new CircularBuffer(CAPACITY.BTC_30M);
    this.sol5m   = new CircularBuffer(CAPACITY.SOL_5M);

    // Order book state: current + previous for lag computation
    this.orderbook = {
      current:  null,
      previous: null,
      updatedAt: null,
    };

    // Track last bar timestamp to deduplicate
    this._lastBtcTs  = null;
    this._lastSolTs  = null;
  }

  // ── Kline ingestion ───────────────────────────────────────────────────────

  onBtcKline(bar) {
    if (!bar.confirm) return;
    if (bar.timestamp === this._lastBtcTs) return; // deduplicate
    this._lastBtcTs = bar.timestamp;
    this.btc30m.push(bar);
    logger.debug("[rolling.window] BTC 30m bar", {
      ts: new Date(bar.timestamp).toISOString(),
      close: bar.close,
      bufSize: this.btc30m.size(),
    });
  }

  onSolKline(bar) {
    if (!bar.confirm) return;
    if (bar.timestamp === this._lastSolTs) return;
    this._lastSolTs = bar.timestamp;
    this.sol5m.push(bar);
    logger.debug("[rolling.window] SOL 5m bar", {
      ts: new Date(bar.timestamp).toISOString(),
      close: bar.close,
      bufSize: this.sol5m.size(),
    });
  }

  // ── Order book ingestion ──────────────────────────────────────────────────

  onOrderbook(data) {
    // Bybit orderbook.1 sends snapshot (type=snapshot) and delta (type=delta)
    // For top-of-book imbalance we only need the snapshot/full update
    // Delta updates are too granular — we use 30s snapshots from the price feed loop

    const bids = data?.data?.b || [];
    const asks = data?.data?.a || [];

    if (bids.length === 0 && asks.length === 0) return;

    const topBid = bids[0] ? parseFloat(bids[0][1]) : 0; // [price, size]
    const topAsk = asks[0] ? parseFloat(asks[0][1]) : 0;

    const snapshot = {
      topBidSize: topBid,
      topAskSize: topAsk,
      imbalance:  topBid + topAsk > 0 ? (topBid - topAsk) / (topBid + topAsk) : 0,
      ts:         Date.now(),
    };

    // Rotate: previous ← current, current ← new
    this.orderbook.previous = this.orderbook.current;
    this.orderbook.current  = snapshot;
    this.orderbook.updatedAt = Date.now();
  }

  // ── Readiness checks ──────────────────────────────────────────────────────

  // Returns true when enough history exists to compute all three features
  isReady() {
    return (
      this.btc30m.hasAtLeast(3)   &&   // need lag-2: bars[0]=t-2, bars[1]=t-1, bars[2]=t
      this.sol5m.hasAtLeast(3)    &&   // need lag-2 at 5m
      this.orderbook.previous !== null  // need previous snapshot for lag
    );
  }

  readinessReport() {
    return {
      btc30mBars:       this.btc30m.size(),
      sol5mBars:        this.sol5m.size(),
      hasObPrevious:    this.orderbook.previous !== null,
      ready:            this.isReady(),
    };
  }

  // ── Regime computation inputs ─────────────────────────────────────────────

  // Returns array of BTC 30m closes for volatility computation (oldest first)
  btcClosesForRegime() {
    return this.btc30m.all().map(b => b.close);
  }

  // Returns array of SOL 5m closes (oldest first)
  solClosesForRegime() {
    return this.sol5m.all().map(b => b.close);
  }
}

module.exports = RollingWindowState;
