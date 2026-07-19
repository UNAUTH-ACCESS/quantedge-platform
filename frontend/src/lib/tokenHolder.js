/**
 * tokenHolder.js
 * Holds the access token in memory only - never localStorage, never a cookie
 * JS can read. An XSS payload that runs in this page can still steal it
 * (it's in memory, reachable by any running script), but it can no longer
 * persist across a page reload/new tab the way localStorage did, and it
 * expires in 15 minutes regardless. The refresh token (the long-lived,
 * more dangerous credential) lives in an httpOnly cookie the JS layer
 * never touches at all.
 *
 * Deliberately a standalone module with zero imports, so both client.js
 * and auth.store.js can depend on it without creating a circular import
 * between them (auth.store.js -> api/endpoints.js -> client.js).
 */
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}
