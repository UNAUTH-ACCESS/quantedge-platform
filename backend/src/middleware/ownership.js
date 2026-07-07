/**
 * ownership.js
 * Resource-level authorization helpers (H6 fix).
 *
 * Problem this solves: authenticate() only confirms a valid logged-in user.
 * requireWorkspace()/requirePermission() verify membership against a
 * workspaceId taken from a header/param — but many :id routes fetch a
 * resource (Portfolio, Position, etc.) and never check that the resource's
 * OWN workspaceId matches a workspace the requesting user actually belongs
 * to. That gap allows any authenticated user to read or, worse, write another
 * workspace's data just by knowing/guessing a resource UUID.
 *
 * Every helper here: fetches the resource, verifies ACTIVE membership in the
 * resource's real workspaceId (not a client-supplied one), and returns the
 * resource. Returns 404 (not 403) on a failed check, so we don't confirm to
 * a non-member that the resource exists at all.
 */

const prisma = require("../lib/prisma");
const { AppError } = require("./error");

async function assertWorkspaceMembership(workspaceId, userId, { permission } = {}) {
  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { role: true },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw new AppError("Not found", 404, "NOT_FOUND");
  }
  // Permission is checked against the RESOURCE's real workspace membership,
  // never against a client-supplied x-workspace-id header — that was the
  // write-capable IDOR: a user could hold "manage_portfolios" in their own
  // workspace and still pass another workspace's resource ID in the URL.
  if (permission && !membership.role?.permissions?.includes(permission)) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }
  return membership;
}

async function assertPortfolioAccess(portfolioId, userId, opts = {}) {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new AppError("Not found", 404, "NOT_FOUND");
  await assertWorkspaceMembership(portfolio.workspaceId, userId, opts);
  return portfolio;
}

async function assertPositionAccess(positionId, userId, opts = {}) {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { portfolio: true },
  });
  if (!position) throw new AppError("Not found", 404, "NOT_FOUND");
  await assertWorkspaceMembership(position.portfolio.workspaceId, userId, opts);
  return position;
}

async function assertProposalAccess(proposalId, userId, opts = {}) {
  const proposal = await prisma.tradeProposal.findUnique({
    where: { id: proposalId },
    include: { portfolio: true },
  });
  if (!proposal) throw new AppError("Not found", 404, "NOT_FOUND");
  await assertWorkspaceMembership(proposal.portfolio.workspaceId, userId, opts);
  return proposal;
}

async function assertWalletAccess(walletId, userId, opts = {}) {
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new AppError("Not found", 404, "NOT_FOUND");
  await assertWorkspaceMembership(wallet.workspaceId, userId, opts);
  return wallet;
}

module.exports = {
  assertWorkspaceMembership,
  assertPortfolioAccess,
  assertPositionAccess,
  assertProposalAccess,
  assertWalletAccess,
};
