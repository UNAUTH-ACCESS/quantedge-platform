const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { body, validationResult } = require("express-validator");
const prisma = require("../../../lib/prisma");
const { AppError } = require("../../../middleware/error");
const { authenticate } = require("../../../middleware/auth");
const { sendWelcome, sendVerificationEmail } = require("../../../services/lifecycle.service");

const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

function generateVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
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
        user: { id: result.user.id, email, name, emailVerified: false },
        workspace: { id: result.workspace.id, slug },
      },
    });
  } catch (err) { next(err); }
});

// POST /auth/login
router.post("/login", [
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

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { workspace: true, role: true },
    });

    const { access, refresh } = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { userId: user.id, token: refresh, expiresAt } });

    res.json({
      success: true,
      data: { accessToken: access, refreshToken: refresh, user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified }, workspaces: memberships.map(m => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role.name, settings: m.workspace.settings })) },
    });
  } catch (err) { next(err); }
});

// POST /auth/refresh
router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError("Refresh token required", 400, "BAD_REQUEST");

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) throw new AppError("Refresh token expired", 401, "UNAUTHORIZED");

    await prisma.refreshToken.delete({ where: { token: refreshToken } });
    const { access, refresh } = generateTokens(payload.sub);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { userId: payload.sub, token: refresh, expiresAt } });

    res.json({ success: true, data: { accessToken: access, refreshToken: refresh } });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post("/logout", authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
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
