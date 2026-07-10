/**
 * device.js
 * Generates and persists a stable per-browser device identifier, used to
 * recognize "this device" across logins (Stage 11 — known-device tracking
 * and new-device email alerts).
 *
 * A random UUID persisted in localStorage is far more reliable than
 * User-Agent alone (which many users legitimately share, and which several
 * mobile in-app browsers report identically regardless of device).
 */

const KEY = "qe_device_id";

export function getOrCreateDeviceId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
