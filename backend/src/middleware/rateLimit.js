/**
 * rateLimit.js
 * express-rate-limit configurations for endpoints most exposed to brute-force
 * or abuse: login, 2FA verification, and KYC submission (large uploads).
 *
 * Requires: npm install express-rate-limit
 *
 * IP-based limiting only works correctly because app.set("trust proxy", 1)
 * is set in app.js — without it every request appears to come from nginx's
 * internal address and all users would share one bucket.
 */
const rateLimit = require("express-rate-limit");

// Login: 10 attempts per 15 min per IP. Generous enough for a real user who
// mistypes a password a few times, tight enough to make credential-stuffing
// impractical at this VPS's scale.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: "Too many login attempts. Try again later.", code: "RATE_LIMITED" } },
});

// 2FA verify: a 6-digit TOTP code has 1,000,000 possibilities; without a
// limit here that's brute-forceable well within a 30-second TOTP window
// across many parallel requests. 10 per 15 min makes that infeasible while
// still allowing a real user a few fat-fingered attempts.
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: "Too many verification attempts. Try again later.", code: "RATE_LIMITED" } },
});

// KYC submit: large multipart uploads (up to ~24MB across 3 files) plus
// synchronous scrypt encryption per field/file (see review H5) makes this
// route the cheapest one to use for a resource-exhaustion attempt. 5 per
// hour per IP is well above what any legitimate user needs (one submission,
// ever, per account) while blocking any kind of automated hammering.
const kycSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: "Too many submission attempts. Try again later.", code: "RATE_LIMITED" } },
});

module.exports = { loginLimiter, twoFactorLimiter, kycSubmitLimiter };
