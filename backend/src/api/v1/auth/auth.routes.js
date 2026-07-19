const express = require("express");
const bcrypt = require("bcryptjs");
const { loginLimiter, twoFactorLimiter } = require("../../../middleware/rateLimit");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { generateSecret, generate, verify, generateURI } = require("otplib");
const qrcode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const { body, validationResult } = require("express-validator");
const prisma = require("../../../lib/prisma");
const { AppError } = require("../../../middleware/error");
const { authenticate } = require("../../../middleware/auth");
const { sendWelcome, sendVerificationEmail, sendNewDeviceAlert } = require("../../../services/lifecycle.service");
const logger = require("../../../lib/logger");

const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

function generateVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

const TWO_FA_PENDING_EXPIRY = "5m";

function generateTwoFactorPendingToken(userId) {
  return jwt.sign({ sub: userId, purpose: "2fa_pending" }, process.env.JWT_SECRET, {
    expiresIn: TWO_FA_PENDING_EXPIRY,
  });
}

function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase()
  );
}

// Checks/records the device this login came from. Fires a "new sign-in"
// email the first time a given device is seen for this user; silent
// (just bumps lastSeenAt) on every subsequent login from the same device.
// deviceId is a UUID the client generates once and persists in
// localStorage — far more stable than User-Agent alone, which many users
// share and which doesn't survive incognito/reinstalls anyway.
async function recordDeviceAndAlertIfNew(userId, deviceId, userAgent) {
  if (!deviceId) return; // older clients pre-dating this feature won't send one
  try {
    const existing = await prisma.knownDevice.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });
    if (existing) {
      await prisma.knownDevice.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
      return;
    }
    await prisma.knownDevice.create({ data: { userId, deviceId, userAgent } });
    await sendNewDeviceAlert(userId, userAgent);
  } catch (err) {
    // Never let device tracking break a real login
    logger.warn("[auth] Device tracking failed", { userId, error: err.message });
  }
}

// Builds and sends the full authenticated login response — real access/
// refresh tokens + memberships. Shared by /login (when 2FA is off) and
// /2fa/verify-login (after a 2FA code is confirmed), so token issuance
// logic exists in exactly one place.
async function issueLoginResponse(res, user, deviceId, userAgent) {
  await recordDeviceAndAlertIfNew(user.id, deviceId, userAgent);

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { workspace: true, role: true },
  });

  const platformAdmin = await prisma.platformAdmin.findUnique({ where: { userId: user.id } });

  const { access, refresh } = generateTokens(user.id);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId: user.id, token: refresh, expiresAt } });

  setRefreshCookie(res, refresh);

  res.json({
    success: true,
    data: {
      accessToken: access,
      user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled, kycStatus: user.kycStatus, isPlatformAdmin: !!platformAdmin },
      workspaces: memberships.map(m => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role.name, settings: m.workspace.settings })),
    },
  });
}

const router = express.Router();

function generateTokens(userId) {
  const access = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });
  const refresh = jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });
  return { access, refresh };
}

// Refresh token now lives ONLY in an httpOnly cookie - never in a JSON body,
// never touchable by JS, so an XSS payload can no longer exfiltrate it.
// scoped to /api/v1/auth so it isn't sent on every single API request.
const REFRESH_COOKIE_NAME = "qe_refresh_token";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,      // requires HTTPS; correctly detected behind nginx because
                      // app.set("trust proxy", 1) + nginx's X-Forwarded-Proto
  sameSite: "strict", // frontend + API are same-origin through nginx
  path: "/api/v1/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}
function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
}

// POST /auth/register
router.post("/register", [
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 8 }),
  body("name").trim().isLength({ min: 1 }),
  body("workspaceName").trim().isLength({ min: 1 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError("Validation failed", 400, "VALIDATION_ERROR");

    const { email, password, name, workspaceName } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new AppError("Email already registered", 409, "CONFLICT");

    const passwordHash = await bcrypt.hash(password, 12);
    const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + uuidv4().slice(0, 6);
    const verificationToken = generateVerificationToken();
    const verificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email, passwordHash, name, status: "ACTIVE",
          emailVerified: false,
          emailVerificationToken: verificationToken,
          emailVerificationExpiresAt: verificationExpiresAt,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: workspaceName, slug, ownerId: user.id,
          // Explicitly seed onboarding state — without this, settings is {}
          // (no onboarding key at all), and RouteGuard's "!onboarding = already
          // complete" fallback incorrectly sends brand-new accounts straight
          // to a dashboard with nothing configured instead of onboarding.
          settings: { onboarding: { stage: 3, complete: false, data: {} } },
        },
      });

      // Create workspace roles
      const adminRole = await tx.role.create({
        data: { workspaceId: workspace.id, name: "ACCOUNT_ADMIN", permissions: ["manage_members", "manage_portfolios", "manage_strategies", "view_all", "execute_trades"] },
      });
      await tx.role.create({ data: { workspaceId: workspace.id, name: "TRADER", permissions: ["view_signals", "execute_trades", "view_positions", "view_portfolio"] } });
      await tx.role.create({ data: { workspaceId: workspace.id, name: "VIEWER", permissions: ["view_signals", "view_positions", "view_portfolio"] } });

      await tx.membership.create({
        data: { workspaceId: workspace.id, userId: user.id, roleId: adminRole.id, status: "ACTIVE", joinedAt: new Date() },
      });

      const now = new Date();
      const trialEnd = new Date(now); trialEnd.setDate(trialEnd.getDate() + 14);
      await tx.subscription.create({
        data: { workspaceId: workspace.id, plan: "FREE", status: "TRIALING", currentPeriodStart: now, currentPeriodEnd: trialEnd },
      });

      return { user, workspace };
    });

    const { access, refresh } = generateTokens(result.user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { userId: result.user.id, token: refresh, expiresAt } });

    // Send welcome + verification emails (non-blocking)
    sendWelcome(result.user.id, result.workspace.id).catch(() => {});
    sendVerificationEmail(result.user.id, verificationToken).catch(() => {});

    res.status(201).json({
      success: true,
      data: {
        accessToken: access, refreshToken: refresh,
        user: { id: result.user.id, email, name, emailVerified: false, twoFactorEnabled: false },
        workspace: { id: result.workspace.id, slug },
      },
    });
  } catch (err) { next(err); }
});

// POST /auth/login
router.post("/login", loginLimiter, [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError("Validation failed", 400, "VALIDATION_ERROR");

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError("Invalid credentials", 401, "UNAUTHORIZED");
    }
    if (user.status !== "ACTIVE") throw new AppError("Account suspended", 403, "FORBIDDEN");

    if (user.twoFactorEnabled) {
      const pendingToken = generateTwoFactorPendingToken(user.id);
      return res.json({ success: true, data: { requires2FA: true, pendingToken } });
    }

    await issueLoginResponse(res, user, req.body.deviceId, req.headers["user-agent"]);
  } catch (err) { next(err); }
});

// POST /auth/2fa/verify-login — second step of login when 2FA is enabled
router.post("/2fa/verify-login", twoFactorLimiter, [
  body("pendingToken").isString().isLength({ min: 1 }),
  body("code").isString().isLength({ min: 6, max: 10 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError("Validation failed", 400, "VALIDATION_ERROR");

    const { pendingToken, code } = req.body;

    let payload;
    try {
      payload = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch {
      throw new AppError("2FA session expired — please log in again", 401, "UNAUTHORIZED");
    }
    if (payload.purpose !== "2fa_pending") throw new AppError("Invalid session", 401, "UNAUTHORIZED");

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.twoFactorEnabled) throw new AppError("Invalid session", 401, "UNAUTHORIZED");

    // verify() throws (rather than returning invalid) when the token isn't
    // exactly 6 digits — true for backup codes, so only attempt TOTP
    // verification when the token actually looks like a TOTP code.
    let totpValid = false;
    if (/^\d{6}$/.test(code)) {
      const totpResult = await verify({ secret: user.twoFactorSecret, token: code });
      totpValid = totpResult.valid;
    }

    if (totpValid) {
      await issueLoginResponse(res, user, req.body.deviceId, req.headers["user-agent"]);
      return;
    }

    // Fall back to a single-use backup code
    const normalizedCode = code.trim().toUpperCase();
    const codeIndex = user.twoFactorBackupCodes.indexOf(normalizedCode);
    if (codeIndex === -1) throw new AppError("Invalid 2FA code", 401, "UNAUTHORIZED");

    const remainingCodes = [...user.twoFactorBackupCodes];
    remainingCodes.splice(codeIndex, 1);
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorBackupCodes: remainingCodes } });

    await issueLoginResponse(res, user, req.body.deviceId, req.headers["user-agent"]);
  } catch (err) { next(err); }
});

// POST /auth/2fa/setup — generates a new (not-yet-enabled) TOTP secret + QR code
router.post("/2fa/setup", authenticate, async (req, res, next) => {
  try {
    if (req.user.status !== "ACTIVE") throw new AppError("Account not active", 403, "FORBIDDEN");

    const secret = generateSecret();
    await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorSecret: secret } });

    const otpauthUrl = generateURI({ issuer: "QuantEdge", label: req.user.email, secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    res.json({ success: true, data: { secret, qrCodeDataUrl } });
  } catch (err) { next(err); }
});

// POST /auth/2fa/enable — confirms the code from setup, turns 2FA on, issues backup codes
router.post("/2fa/enable", authenticate, [
  body("code").isString().isLength({ min: 6, max: 10 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError("Validation failed", 400, "VALIDATION_ERROR");

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorSecret) throw new AppError("Call /2fa/setup first", 400, "BAD_REQUEST");

    if (!/^\d{6}$/.test(req.body.code)) {
      throw new AppError("Enter the 6-digit code from your authenticator app", 400, "INVALID_CODE");
    }
    const enableResult = await verify({ secret: user.twoFactorSecret, token: req.body.code });
    if (!enableResult.valid) throw new AppError("Invalid code — check your authenticator app and try again", 400, "INVALID_CODE");

    const backupCodes = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, twoFactorBackupCodes: backupCodes },
    });

    // Backup codes are shown ONCE, in plaintext, right now — never retrievable again.
    res.json({ success: true, data: { enabled: true, backupCodes } });
  } catch (err) { next(err); }
});

// POST /auth/2fa/disable — requires a valid current code (TOTP or backup),
// so a stolen session alone can't silently turn off 2FA.
router.post("/2fa/disable", authenticate, [
  body("code").isString().isLength({ min: 6, max: 10 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError("Validation failed", 400, "VALIDATION_ERROR");

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorEnabled) throw new AppError("2FA is not enabled", 400, "BAD_REQUEST");

    let disableTotpValid = false;
    if (/^\d{6}$/.test(req.body.code)) {
      const disableResult = await verify({ secret: user.twoFactorSecret, token: req.body.code });
      disableTotpValid = disableResult.valid;
    }
    const validBackup = user.twoFactorBackupCodes.includes(req.body.code.trim().toUpperCase());
    if (!disableTotpValid && !validBackup) throw new AppError("Invalid code", 401, "UNAUTHORIZED");

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    });

    res.json({ success: true, data: { enabled: false } });
  } catch (err) { next(err); }
});

// POST /auth/refresh
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) throw new AppError("Refresh token required", 400, "BAD_REQUEST");

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      clearRefreshCookie(res);
      throw new AppError("Refresh token invalid or expired", 401, "UNAUTHORIZED");
    }
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      clearRefreshCookie(res);
      throw new AppError("Refresh token expired", 401, "UNAUTHORIZED");
    }

    await prisma.refreshToken.delete({ where: { token: refreshToken } });
    const { access, refresh } = generateTokens(payload.sub);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { userId: payload.sub, token: refresh, expiresAt } });

    setRefreshCookie(res, refresh);
    res.json({ success: true, data: { accessToken: access } });
  } catch (err) { next(err); }
});

// GET /auth/me — refetch fresh current-user data. Used to rehydrate the
// frontend's user/workspaces state after a page reload, since that state
// only ever lived in memory otherwise (a reload kept the auth token but
// silently reset user to null, making every user.* field stale/wrong
// until a fresh login).
router.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new AppError("User not found", 404, "NOT_FOUND");

    const platformAdmin = await prisma.platformAdmin.findUnique({ where: { userId: user.id } });

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { workspace: true, role: true },
    });

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled, kycStatus: user.kycStatus, isPlatformAdmin: !!platformAdmin },
        workspaces: memberships.map(m => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role.name, settings: m.workspace.settings })),
      },
    });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post("/logout", authenticate, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    clearRefreshCookie(res);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /auth/verify-email — confirms the token from the emailed link
router.post("/verify-email", [
  body("token").isString().isLength({ min: 1 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError("Validation failed", 400, "VALIDATION_ERROR");

    const { token } = req.body;
    const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });

    if (!user) throw new AppError("Invalid or expired verification link", 400, "INVALID_TOKEN");
    if (user.emailVerified) {
      return res.json({ success: true, data: { alreadyVerified: true } });
    }
    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      throw new AppError("Verification link has expired — request a new one", 400, "TOKEN_EXPIRED");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpiresAt: null },
    });

    res.json({ success: true, data: { alreadyVerified: false } });
  } catch (err) { next(err); }
});

// POST /auth/resend-verification — requires being logged in (even though
// unverified), so we know exactly which account to resend for.
router.post("/resend-verification", authenticate, async (req, res, next) => {
  try {
    if (req.user.status !== "ACTIVE") throw new AppError("Account not active", 403, "FORBIDDEN");

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.emailVerified) {
      return res.json({ success: true, data: { alreadyVerified: true } });
    }

    const verificationToken = generateVerificationToken();
    const verificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: verificationToken, emailVerificationExpiresAt: verificationExpiresAt },
    });

    await sendVerificationEmail(user.id, verificationToken);

    res.json({ success: true, data: { sent: true } });
  } catch (err) { next(err); }
});

module.exports = router;
