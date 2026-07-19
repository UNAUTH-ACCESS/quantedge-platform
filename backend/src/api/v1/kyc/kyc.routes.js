/**
 * kyc.routes.js
 *
 * Mount: app.use('/api/kyc', require('./kyc.routes'));
 *
 * Requires (add to schema.prisma, see kyc_schema_addition.prisma):
 *   User.kycStatus  KycStatus @default(NOT_SUBMITTED)
 *
 * Onboarding-completion gate reads req.workspace.settings.onboarding.complete
 * (set via requireWorkspace), matching onboarding.routes.js exactly — this is
 * a workspace-scoped flag in your system, not a User field. No separate
 * "onboardingCompleted" column needed or used.
 *
 * npm install multer
 */
const express = require("express");
const multer = require("multer");
const router = express.Router();

const prisma = require("../../../lib/prisma");
const { authenticate, requireWorkspace, requirePlatformAdmin } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");
const { encryptField, decryptField, encryptFileToDisk, decryptFileFromDisk } = require("../../../lib/kycCrypto");
const { kycSubmitLimiter } = require("../../../middleware/rateLimit");

// In-memory upload, 8MB cap per file, images/pdf only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype);
    cb(ok ? null : new Error("Unsupported file type"), ok);
  },
});

// ---------- USER ROUTES ----------

// POST /api/kyc/submit
// Requires x-workspace-id header (or :workspaceId param, per requireWorkspace) so we can
// check the real onboarding-completion flag, which lives on workspace.settings.onboarding,
// not on User — mirrors onboarding.routes.js exactly.
router.post(
  "/submit",
  authenticate,
  requireWorkspace,
  kycSubmitLimiter,
  upload.fields([
    { name: "idDocFront", maxCount: 1 },
    { name: "idDocBack", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const onboarding = req.workspace.settings?.onboarding || { stage: 3, complete: false, data: {} };
      if (!onboarding.complete) {
        throw new AppError("Complete onboarding before submitting KYC", 403, "ONBOARDING_INCOMPLETE");
      }

      const existing = await prisma.kycSubmission.findUnique({ where: { userId: req.user.id } });
      if (existing) {
        throw new AppError(`KYC already submitted (status: ${existing.status})`, 409, "KYC_ALREADY_SUBMITTED");
      }
      // Note: findUnique-then-create still has a race window between two
      // concurrent submits; the catch block below handles the resulting
      // P2002 from @unique(userId) as a clean 409 rather than a raw 500.

      const {
        legalName, dateOfBirth, countryResidence, countryCitizenship, address,
        idType, idNumber, attestNotPep, attestNoSanctions, attestAccurate,
      } = req.body;

      if (!legalName || !dateOfBirth || !countryResidence || !countryCitizenship ||
          !address || !idType || !idNumber) {
        throw new AppError("Missing required fields", 400, "VALIDATION_ERROR");
      }
      if (![attestNotPep, attestNoSanctions, attestAccurate].every((v) => v === "true" || v === true)) {
        throw new AppError("All attestations must be confirmed", 400, "VALIDATION_ERROR");
      }
      if (!req.files?.idDocFront?.[0] || !req.files?.selfie?.[0]) {
        throw new AppError("ID document front and selfie are required", 400, "VALIDATION_ERROR");
      }

      const idDocFrontPath = encryptFileToDisk(req.files.idDocFront[0].buffer, req.user.id, "id-front");
      const idDocBackPath = req.files.idDocBack?.[0]
        ? encryptFileToDisk(req.files.idDocBack[0].buffer, req.user.id, "id-back")
        : null;
      const selfiePath = encryptFileToDisk(req.files.selfie[0].buffer, req.user.id, "selfie");

      const submission = await prisma.$transaction(async (tx) => {
        const created = await tx.kycSubmission.create({
          data: {
            userId: req.user.id,
            legalName,
            dateOfBirth: new Date(dateOfBirth),
            countryResidence,
            countryCitizenship,
            address,
            idType,
            idNumberEncrypted: encryptField(idNumber),
            idDocFrontPath,
            idDocBackPath,
            selfiePath,
            attestNotPep: true,
            attestNoSanctions: true,
            attestAccurate: true,
            status: "PENDING_REVIEW",
          },
        });
        await tx.user.update({ where: { id: req.user.id }, data: { kycStatus: "PENDING_REVIEW" } });
        return created;
      });

      return res.json({ success: true, status: submission.status, submittedAt: submission.submittedAt });
    } catch (err) {
      if (err.code === "P2002") {
        return next(new AppError("KYC already submitted", 409, "KYC_ALREADY_SUBMITTED"));
      }
      next(err);
    }
  }
);

// GET /api/kyc/status — own status only (ownership check, not just auth)
router.get("/status", authenticate, async (req, res, next) => {
  try {
    const submission = await prisma.kycSubmission.findUnique({
      where: { userId: req.user.id },
      select: { status: true, submittedAt: true, reviewedAt: true, reviewNotes: true },
    });
    if (!submission) return res.json({ success: true, status: "NOT_SUBMITTED" });
    return res.json({ success: true, ...submission });
  } catch (err) {
    next(err);
  }
});

// ---------- ADMIN ROUTES ----------
// requirePlatformAdmin assumes `authenticate` already ran and set req.user —
// mounted as two middlewares in sequence, same pattern as elsewhere in the app.

// GET /api/admin/kyc/pending
router.get("/admin/pending", authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const pending = await prisma.kycSubmission.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true, userId: true, legalName: true, countryResidence: true,
        idType: true, submittedAt: true,
      },
    });
    return res.json({ success: true, pending });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/kyc/:id — full detail including decrypted doc data (base64) for review
router.get("/admin/:id", authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) throw new AppError("Submission not found", 404, "NOT_FOUND");

    const idNumber = decryptField(submission.idNumberEncrypted);
    const idDocFront = decryptFileFromDisk(submission.idDocFrontPath).toString("base64");
    const idDocBack = submission.idDocBackPath
      ? decryptFileFromDisk(submission.idDocBackPath).toString("base64")
      : null;
    const selfie = decryptFileFromDisk(submission.selfiePath).toString("base64");

    const ownerMembership = await prisma.membership.findFirst({
      where: { userId: submission.userId, status: "ACTIVE" },
    });
    if (ownerMembership) {
      await prisma.auditEvent.create({
        data: {
          workspaceId: ownerMembership.workspaceId,
          actorId: req.user.id,
          entityType: "KycSubmission",
          entityId: submission.id,
          action: "VIEW",
          afterState: { viewedBy: req.user.id },
          ipAddress: req.ip,
        },
      }).catch((err) => {
        console.error("KYC audit log (VIEW) failed:", err);
      });
    }

    return res.json({
      success: true,
      submission: { ...submission, idNumberEncrypted: undefined, idNumber },
      documents: { idDocFront, idDocBack, selfie },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/kyc/:id/review — { decision: "APPROVED" | "REJECTED", notes }
router.post("/admin/:id/review", authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const { decision, notes } = req.body;
    if (!["APPROVED", "REJECTED"].includes(decision)) {
      throw new AppError("decision must be APPROVED or REJECTED", 400, "VALIDATION_ERROR");
    }

    const existing = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError("Submission not found", 404, "NOT_FOUND");
    if (existing.status !== "PENDING_REVIEW") {
      throw new AppError(
        `Submission already decided (status: ${existing.status}) - not re-reviewable`,
        409,
        "ALREADY_REVIEWED"
      );
    }

    const submission = await prisma.$transaction(async (tx) => {
      const updated = await tx.kycSubmission.update({
        where: { id: req.params.id },
        data: {
          status: decision,
          reviewedAt: new Date(),
          reviewedBy: req.user.id, // admin performing the review
          reviewNotes: notes || null,
        },
      });
      await tx.user.update({ where: { id: updated.userId }, data: { kycStatus: decision } });
      return updated;
    });

    const ownerMembership = await prisma.membership.findFirst({
      where: { userId: submission.userId, status: "ACTIVE" },
    });
    if (ownerMembership) {
      await prisma.auditEvent.create({
        data: {
          workspaceId: ownerMembership.workspaceId,
          actorId: req.user.id,
          entityType: "KycSubmission",
          entityId: submission.id,
          action: decision === "APPROVED" ? "APPROVE" : "REJECT",
          beforeState: { status: "PENDING_REVIEW" },
          afterState: { status: decision, notes: notes || null },
          ipAddress: req.ip,
        },
      }).catch((err) => {
        console.error("KYC audit log (review) failed:", err);
      });
    }

    // TODO: trigger notification email to user on decision (reuse existing Resend setup)

    return res.json({ success: true, status: submission.status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
