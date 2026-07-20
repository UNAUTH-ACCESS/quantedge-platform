/**
 * fillDerivation.js
 *
 * Shared by execution.service.js (entry fills) and exit.service.js (exit
 * fills) so both use identical logic rather than two copies drifting apart.
 *
 * The snapshot buffer is only injected by the simulation worker
 * (simulation.worker.js calls setSnapshotBuffer() once at startup). The API
 * process (manual "sign" via POST /proposals/:id/sign) never injects one, so
 * snapshotBuffer stays null there and deriveFillPrice() automatically falls
 * back to the estimate, flagged wasLive:false. No branching needed at call
 * sites - this function does the right thing based on which process it's
 * running in.
 */

let snapshotBuffer = null;

function setSnapshotBuffer(buffer) {
  snapshotBuffer = buffer;
}

/**
 * Derive a fill price for a signal at `signalTs` on `symbol`.
 *
 * @param {string} symbol - asset symbol as tracked in the snapshot buffer (e.g. "BTC", "SOL")
 * @param {Date|string} signalTs - when the signal/proposal was generated (proposal.proposedAt)
 * @param {number} estimateFallback - price to use if no live snapshot is available
 *   (proposal.estEntry for entries, position.currentPrice for exits)
 * @returns {{ fillPrice: number, sourceSnapshotTs: Date|null, fillMethod: string, wasLive: boolean }}
 */
function deriveFillPrice(symbol, signalTs, estimateFallback) {
  if (snapshotBuffer) {
    const derived = snapshotBuffer.deriveFill(symbol, signalTs);
    if (derived) {
      return {
        fillPrice: derived.price,
        sourceSnapshotTs: derived.snapshotTs,
        fillMethod: derived.method, // "next_after_signal"
        wasLive: true,
      };
    }
  }
  // No buffer injected (API/manual-sign process), or the signal is newer
  // than anything buffered yet (feed lag/startup) - fall back honestly.
  return {
    fillPrice: estimateFallback,
    sourceSnapshotTs: null,
    fillMethod: "estimate_fallback",
    wasLive: false,
  };
}

module.exports = { setSnapshotBuffer, deriveFillPrice };
