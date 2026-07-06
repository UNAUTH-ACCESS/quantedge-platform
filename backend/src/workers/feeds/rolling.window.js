/**
 * Rolling Window State Manager
 *
 * Maintains in-memory circular buffers for market data, written by
 * WebSocket callbacks and read by feature computation.
 *
 * All operations are synchronous — Node.js is single-threaded so no
 * explicit locking is needed. WebSocket callbacks and the signal loop
 * share the same event loop thread.
 *
 * ⚠️  PUBLIC REPO NOTICE: the specific instruments tracked, buffer
 * capacities, and feature-readiness requirements are tuned to QuantEdge's
 * proprietary feature set and have been generalized in this public copy.
 * The CircularBuffer implementation and ingestion pattern below are real
 * and unmodified.
 */

const logger = require("../../lib/logger");

// Capacities are illustrative — real values are tuned per feature requirements.
const CAPACITY = {
  PRIMARY_INTERVAL:   6,
  SECONDARY_INTERVAL: 24,
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
    this.primary   = new CircularBuffer(CAPACITY.PRIMARY_INTERVAL);
    this.secondary  = new CircularBuffer(CAPACITY.SECONDARY_INTERVAL);

    // Order book state: current + previous for lag computation
    this.orderbook = {
      current:  null,
      previous: null,
      updatedAt: null,
    };

    this._lastPrimaryTs   = null;
    this._lastSecondaryTs = null;
  }

  // ── Kline ingestion ───────────────────────────────────────────────────────

  onPrimaryKline(bar) {
    if (!bar.confirm) return;
    if (bar.timestamp === this._lastPrimaryTs) return; // deduplicate
    this._lastPrimaryTs = bar.timestamp;
    this.primary.push(bar);
    logger.debug("[rolling.window] primary bar", {
      ts: new Date(bar.timestamp).toISOString(),
      close: bar.close,
      bufSize: this.primary.size(),
    });
  }

  onSecondaryKline(bar) {
    if (!bar.confirm) return;
    if (bar.timestamp === this._lastSecondaryTs) return;
    this._lastSecondaryTs = bar.timestamp;
    this.secondary.push(bar);
    logger.debug("[rolling.window] secondary bar", {
      ts: new Date(bar.timestamp).toISOString(),
      close: bar.close,
      bufSize: this.secondary.size(),
    });
  }

  // ── Order book ingestion ──────────────────────────────────────────────────

  onOrderbook(data) {
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

    this.orderbook.previous = this.orderbook.current;
    this.orderbook.current  = snapshot;
    this.orderbook.updatedAt = Date.now();
  }

  // ── Readiness checks ──────────────────────────────────────────────────────

  isReady() {
    // [REDACTED] Real readiness thresholds are tuned to the proprietary
    // feature set's specific lag requirements.
    return (
      this.primary.hasAtLeast(3) &&
      this.secondary.hasAtLeast(3) &&
      this.orderbook.previous !== null
    );
  }

  readinessReport() {
    return {
      primaryBars:    this.primary.size(),
      secondaryBars:  this.secondary.size(),
      hasObPrevious:  this.orderbook.previous !== null,
      ready:          this.isReady(),
    };
  }

  // ── Regime computation inputs ─────────────────────────────────────────────

  btcClosesForRegime() {
    return this.primary.all().map(b => b.close);
  }
}

module.exports = RollingWindowState;
