/**
 * marketSnapshotBuffer.js
 *
 * In-memory rolling buffer of timestamped market snapshots per asset, feeding
 * deterministic fill derivation for the simulation.
 *
 * Design decisions (agreed):
 * - In-memory only. Snapshots vanish on worker restart. Fine for live sim;
 *   a replay can only use what was captured in the current process lifetime.
 * - Rolling 90-second window per symbol. Older snapshots are evicted.
 * - Default fill model: NEXT-AFTER-SIGNAL. A signal at time T fills at the
 *   first snapshot with ts >= T. This is the honest model - you cannot fill
 *   before your signal exists. No Math.random() anywhere: identical inputs
 *   always produce an identical fill, which is what makes replays reproducible.
 *
 * A snapshot is { ts: Date, price: number, bid: number|null, ask: number|null }.
 */

const WINDOW_MS = 90 * 1000;

class MarketSnapshotBuffer {
  constructor(windowMs = WINDOW_MS) {
    this.windowMs = windowMs;
    // symbol -> array of snapshots, kept sorted ascending by ts
    this.buffers = new Map();
  }

  /**
   * Record a snapshot for a symbol. Called from the feed callbacks on every
   * kline close / orderbook tick. Evicts anything older than the window.
   */
  record(symbol, price, bid = null, ask = null, ts = new Date()) {
    if (!Number.isFinite(price) || price <= 0) return; // never store a bad price
    let buf = this.buffers.get(symbol);
    if (!buf) {
      buf = [];
      this.buffers.set(symbol, buf);
    }
    buf.push({ ts: ts instanceof Date ? ts : new Date(ts), price, bid, ask });
    this._evict(symbol);
  }

  _evict(symbol) {
    const buf = this.buffers.get(symbol);
    if (!buf) return;
    const cutoff = Date.now() - this.windowMs;
    // buffer is append-only in ts order, so drop from the front
    let i = 0;
    while (i < buf.length && buf[i].ts.getTime() < cutoff) i++;
    if (i > 0) buf.splice(0, i);
  }

  /**
   * Deterministically derive a fill for a signal at time `signalTs`.
   * Returns the FIRST snapshot at or after signalTs (next-after-signal).
   *
   * Returns { price, snapshotTs, method: "next_after_signal", wasLive: true }
   * on success, or null if no snapshot at/after the signal exists in the
   * buffer (caller must then fall back to the estimate and flag wasLive:false).
   */
  deriveFill(symbol, signalTs) {
    const buf = this.buffers.get(symbol);
    if (!buf || buf.length === 0) return null;
    const t = (signalTs instanceof Date ? signalTs : new Date(signalTs)).getTime();

    // buffer is sorted ascending; find first snapshot with ts >= t
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].ts.getTime() >= t) {
        return {
          price: buf[i].price,
          snapshotTs: buf[i].ts,
          method: "next_after_signal",
          wasLive: true,
        };
      }
    }
    // No snapshot at/after the signal - the signal is newer than anything
    // buffered. Caller falls back to estimate rather than filling on a stale
    // pre-signal price (which would be look-ahead-free but not next-after).
    return null;
  }

  /** Most recent snapshot for a symbol, or null. Used for live mark-to-market. */
  latest(symbol) {
    const buf = this.buffers.get(symbol);
    if (!buf || buf.length === 0) return null;
    return buf[buf.length - 1];
  }

  /** Snapshot count per symbol - for readiness/debugging. */
  size(symbol) {
    return this.buffers.get(symbol)?.length || 0;
  }
}

module.exports = { MarketSnapshotBuffer, WINDOW_MS };
