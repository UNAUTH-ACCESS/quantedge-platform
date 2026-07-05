const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate, requirePermission } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");
const executionService = require("../../../services/execution.service");
const { events, EVENTS } = require("../../../lib/events");

const router = express.Router();

// GET /proposals
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { status, portfolioId, limit = 50, offset = 0 } = req.query;
    const workspaceId = req.headers["x-workspace-id"];

    const portfolios = await prisma.portfolio.findMany({
      where: { workspaceId, ...(portfolioId ? { id: portfolioId } : {}) },
      select: { id: true },
    });
    const portfolioIds = portfolios.map(p => p.id);

    const where = {
      portfolioId: { in: portfolioIds },
      ...(status ? { status } : {}),
    };

    const [proposals, total] = await Promise.all([
      prisma.tradeProposal.findMany({
        where,
        include: {
          wallet: { include: { chain: true } },
          venue: true,
          evaluation: { include: { signal: { include: { asset: true } } } },
          transaction: true,
          fill: true,
        },
        orderBy: { proposedAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.tradeProposal.count({ where }),
    ]);

    res.json({ success: true, data: { proposals, total } });
  } catch (err) { next(err); }
});

// GET /proposals/:id
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const proposal = await prisma.tradeProposal.findUnique({
      where: { id: req.params.id },
      include: {
        wallet: { include: { chain: true } },
        venue: true,
        evaluation: { include: { signal: { include: { asset: true, signalConfig: true } } } },
        transaction: true,
        fill: true,
      },
    });
    if (!proposal) throw new AppError("Proposal not found", 404, "NOT_FOUND");
    res.json({ success: true, data: proposal });
  } catch (err) { next(err); }
});

// POST /proposals/:id/sign — user approves execution
router.post("/:id/sign", authenticate, requirePermission("execute_trades"), async (req, res, next) => {
  try {
    const proposal = await prisma.tradeProposal.findUnique({
      where: { id: req.params.id },
      include: { portfolio: true },
    });
    if (!proposal) throw new AppError("Proposal not found", 404, "NOT_FOUND");

    // Atomic status transition — prevents double-sign race condition
    const claimed = await prisma.tradeProposal.updateMany({
      where: { id: req.params.id, status: "PENDING" },
      data: { status: "SIGNED", signedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError("Proposal is not pending or already being processed", 409, "CONFLICT");
    }

    // Audit
    await prisma.auditEvent.create({
      data: {
        workspaceId: proposal.portfolio.workspaceId,
        actorId: req.user.id,
        entityType: "TradeProposal",
        entityId: proposal.id,
        action: "SIGN",
        beforeState: { status: "PENDING" },
        afterState: { status: "SIGNED" },
        ipAddress: req.ip,
      },
    });

    // Execute asynchronously — client gets updates via socket
    executionService.signAndExecute(proposal.id)
      .then((result) => {
        events.emit(EVENTS.PROPOSAL_STATUS, { proposalId: proposal.id, status: "CONFIRMED", portfolioId: proposal.portfolioId });
        events.emit(EVENTS.POSITION_UPDATED, { portfolioId: proposal.portfolioId, positionId: result.position.id });
      })
      .catch((err) => {
        events.emit(EVENTS.PROPOSAL_STATUS, { proposalId: proposal.id, status: "FAILED", portfolioId: proposal.portfolioId, error: err.message });
      });

    // Return immediately — client polls or listens via socket
    res.json({ success: true, data: { proposalId: proposal.id, status: "SIGNED", message: "Execution in progress" } });
  } catch (err) { next(err); }
});

// POST /proposals/:id/cancel
router.post("/:id/cancel", authenticate, requirePermission("execute_trades"), async (req, res, next) => {
  try {
    const updated = await executionService.cancelProposal(req.params.id, req.user.id);
    events.emit(EVENTS.PROPOSAL_STATUS, { proposalId: updated.id, status: "CANCELLED", portfolioId: updated.portfolioId });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

module.exports = router;

// POST /proposals/:id/close — manually close a position linked to a proposal
const { closePosition } = require("../../../services/exit.service");

router.post("/:id/close-position", authenticate, async (req, res, next) => {
  try {
    const proposal = await prisma.tradeProposal.findUnique({
      where: { id: req.params.id },
      include: { fill: { include: { position: true } } },
    });
    if (!proposal) throw new AppError("Proposal not found", 404, "NOT_FOUND");

    // Find linked open position
    const position = await prisma.position.findFirst({
      where: { fillId: proposal.fill?.id, status: "OPEN" },
    });
    if (!position) throw new AppError("No open position linked to this proposal", 404, "NOT_FOUND");

    const closed = await closePosition(position.id, "MANUAL");
    if (!closed) throw new AppError("Close execution failed", 500, "EXECUTION_FAILED");

    res.json({ success: true, data: closed });
  } catch (err) { next(err); }
});
