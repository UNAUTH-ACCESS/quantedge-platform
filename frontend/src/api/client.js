import axios from "axios";
import { getAccessToken, setAccessToken, clearAccessToken } from "../lib/tokenHolder";

// All requests go through same origin — no hardcoded URLs
const client = axios.create({
  baseURL: "/api/v1",
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // required to send/receive the httpOnly refresh cookie
});

// ── Request interceptor — inject auth + workspace headers ──────────────────
client.interceptors.request.use((config) => {
  const token = getAccessToken();
  const workspaceId = localStorage.getItem("qe_workspace_id");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (workspaceId) config.headers["x-workspace-id"] = workspaceId;
  return config;
});

// ── Response interceptor — normalize errors, handle token refresh ──────────
let refreshing = false;
let refreshQueue = [];

client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;

    // Token expired — attempt refresh once. No refresh token is ever read
    // here; it lives in an httpOnly cookie sent automatically by the browser
    // via withCredentials, and the server rotates + re-sets it on success.
    if (err.response?.status === 401 && !original._retry) {
      if (refreshing) {
        // Queue requests that arrive while refresh is in progress
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then(() => client(original));
      }

      original._retry = true;
      refreshing = true;

      try {
        const { data } = await axios.post("/api/v1/auth/refresh", {}, { withCredentials: true });
        const { accessToken } = data.data;

        setAccessToken(accessToken);

        refreshQueue.forEach(({ resolve }) => resolve());
        refreshQueue = [];

        original.headers.Authorization = `Bearer ${accessToken}`;
        return client(original);
      } catch {
        // Refresh failed — clear session, redirect to login
        refreshQueue.forEach(({ reject }) => reject());
        refreshQueue = [];
        clearAccessToken();
        localStorage.removeItem("qe_user_id");
        localStorage.removeItem("qe_workspace_id");
        window.location.href = "/login";
        return Promise.reject(normalizeError(err));
      } finally {
        refreshing = false;
      }
    }

    return Promise.reject(normalizeError(err));
  }
);

// Normalize all errors to a consistent shape — no internal details leak
function normalizeError(err) {
  if (err.response?.data?.error) {
    const { code, message } = err.response.data.error;
    return {
      code,
      message: userFacingMessage(code, message),
      status: err.response.status,
    };
  }
  if (err.code === "ECONNABORTED") {
    return { code: "TIMEOUT", message: "Request timed out. Please try again.", status: 408 };
  }
  if (!err.response) {
    return { code: "NETWORK_ERROR", message: "Cannot reach the server. Check your connection.", status: 0 };
  }
  return { code: "UNKNOWN", message: "Something went wrong. Please try again.", status: err.response?.status };
}

// Translate API error codes to user-facing messages
function userFacingMessage(code, fallback) {
  const messages = {
    UNAUTHORIZED:    "Your session has expired. Please sign in again.",
    FORBIDDEN:       "You don't have permission to do this.",
    NOT_FOUND:       "The requested item could not be found.",
    CONFLICT:        "This action is already in progress.",
    VALIDATION_ERROR:"Please check your input and try again.",
    INTERNAL_ERROR:  "Something went wrong on our end. Please try again.",
  };
  return messages[code] || fallback || "Something went wrong.";
}

export default client;
