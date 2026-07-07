/**
 * config.js
 * Single source of truth for shared/critical environment configuration.
 *
 * Purpose: this session hit repeated outages from scattered process.env
 * reads with mismatched variable names, missing docker-compose entries, and
 * silently-duplicate .env lines. This module validates everything that
 * would break the whole api/worker process if wrong, ONCE, at boot, with a
 * clear consolidated error report — fail fast instead of a confusing
 * downstream crash or silent misbehavior.
 */

const errors = [];

function requireVar(name, { minLength } = {}) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    errors.push(`Missing required env var: ${name}`);
    return undefined;
  }
  if (minLength && value.trim().length < minLength) {
    errors.push(`${name} looks malformed (length ${value.trim().length}, expected >= ${minLength})`);
  }
  return value.trim();
}

function optionalVar(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

// Truly shared — used by BOTH api and worker processes.
const config = {
  DATABASE_URL: requireVar("DATABASE_URL"),
  DELEGATE_SERVER_URL: requireVar("DELEGATE_SERVER_URL"),
  DELEGATE_SHARED_SECRET: requireVar("DELEGATE_SHARED_SECRET", { minLength: 32 }),
  APP_URL: optionalVar("APP_URL", "https://quantedge.exchange"),
  RESEND_API_KEY: optionalVar("RESEND_API_KEY", null),
  FROM_EMAIL: optionalVar("FROM_EMAIL", "QuantEdge <onboarding@resend.dev>"),
};

function reportAndExitIfErrors() {
  if (errors.length > 0) {
    const report = [
      "",
      "=".repeat(70),
      "  CONFIG VALIDATION FAILED — process cannot start safely",
      "=".repeat(70),
      ...errors.map(e => `  ✗ ${e}`),
      "=".repeat(70),
      "",
    ].join("\n");
    console.error(report);
    process.exit(1);
  }
}

reportAndExitIfErrors();

// API-only — JWT auth + CORS are never touched by the worker process.
// Call this explicitly from app.js only, so the worker doesn't require vars
// it never uses (this exact mistake crashed the worker during H2 testing —
// intentional, since silently ignoring unused-but-missing vars is worse).
function assertApiConfig() {
  config.JWT_SECRET = requireVar("JWT_SECRET", { minLength: 16 });
  config.JWT_REFRESH_SECRET = requireVar("JWT_REFRESH_SECRET", { minLength: 16 });
  config.CORS_ORIGIN = requireVar("CORS_ORIGIN");
  reportAndExitIfErrors();
  return config;
}

module.exports = config;
module.exports.assertApiConfig = assertApiConfig;
