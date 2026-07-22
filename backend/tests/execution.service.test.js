// config.js and the VAULT mapping both read these env vars at MODULE LOAD
// TIME (top-level consts), not lazily - they must be set before requiring
// execution.service.js or the process exits immediately (config.js calls
// process.exit(1) on missing required vars).
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.DELEGATE_SERVER_URL = "http://localhost:9999";
process.env.DELEGATE_SHARED_SECRET = "test-shared-secret-at-least-32-characters-long";
process.env.DELEGATE_ADDRESS = "0xVAULTADDRESSERC20";
process.env.TRON_DELEGATE_ADDRESS = "TVAULTADDRESSTRC20PLACEHOLDERXXX";
process.env.SOLANA_DELEGATE_ADDRESS = "VAULTADDRESSSPLPLACEHOLDERXXXXXXXXXXXXXXXXXX";

jest.mock("../src/lib/prisma", () => ({
  tradeProposal: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  transaction: { create: jest.fn(), update: jest.fn() },
  fill: { create: jest.fn(), count: jest.fn() },
  position: { update: jest.fn() },
  portfolio: { findUnique: jest.fn() },
  workspace: { findUnique: jest.fn() },
  auditEvent: { create: jest.fn() },
}));

jest.mock("../src/lib/fillDerivation", () => ({
  deriveFillPrice: jest.fn(),
}));

jest.mock("../src/services/position.service", () => ({
  upsertPositionFromFill: jest.fn(),
  snapshotPortfolio: jest.fn(),
}));

jest.mock("../src/notifications/router", () => ({
  notify: jest.fn(),
}));

jest.mock("../src/services/lifecycle.service", () => ({
  sendFirstTrade: jest.fn(),
}));

const prisma = require("../src/lib/prisma");
const { deriveFillPrice } = require("../src/lib/fillDerivation");
const positionService = require("../src/services/position.service");
const { notify } = require("../src/notifications/router");
const { sendFirstTrade } = require("../src/services/lifecycle.service");
const { signAndExecute, settlePosition, retrySettlementOnce, cancelProposal } = require("../src/services/execution.service");

beforeEach(() => {
  global.fetch = jest.fn();
  // Sensible defaults so tests only need to override what they care about
  positionService.upsertPositionFromFill.mockResolvedValue({ id: "position-1" });
  positionService.snapshotPortfolio.mockResolvedValue({});
  notify.mockResolvedValue({});
  sendFirstTrade.mockResolvedValue({});
  prisma.portfolio.findUnique.mockResolvedValue({ workspaceId: "workspace-1" });
  prisma.workspace.findUnique.mockResolvedValue({ ownerId: "owner-1" });
  prisma.fill.count.mockResolvedValue(1);
  prisma.transaction.create.mockResolvedValue({ id: "transaction-1" });
  prisma.transaction.update.mockResolvedValue({});
  prisma.tradeProposal.update.mockResolvedValue({});
});

function baseProposal(overrides = {}) {
  return {
    id: "proposal-1",
    status: "PENDING",
    portfolioId: "portfolio-1",
    walletId: "wallet-1",
    assetId: "asset-1",
    venueId: "venue-1",
    direction: "LONG",
    notional: 1000,
    estEntry: 100,
    estFeeBps: 10,
    proposedAt: new Date("2026-01-01T00:00:00.000Z"),
    wallet: {
      id: "wallet-1",
      userId: "user-1",
      address: "0xabc",
      provider: "METAMASK",
      delegateChain: null,
      delegateApproved: false,
      chainId: "chain-1",
      chain: { type: "EVM" },
    },
    venue: { name: "Jupiter" },
    asset: { symbol: "BTC" },
    ...overrides,
  };
}

describe("signAndExecute — basic proposal validation", () => {
  test("throws if the proposal does not exist", async () => {
    prisma.tradeProposal.findUnique.mockResolvedValue(null);
    await expect(signAndExecute("missing-id")).rejects.toThrow(/not found/);
  });

  test("throws if the proposal is not PENDING", async () => {
    prisma.tradeProposal.findUnique.mockResolvedValue(baseProposal({ status: "SIGNED" }));
    await expect(signAndExecute("proposal-1")).rejects.toThrow(/is not pending/);
  });
});

describe("signAndExecute — PRODUCTION REQUIREMENT: no simulation fallback", () => {
  test("rejects (does not simulate) when the wallet is not delegate-approved", async () => {
    prisma.tradeProposal.findUnique.mockResolvedValue(
      baseProposal({ wallet: { ...baseProposal().wallet, delegateApproved: false } })
    );

    await expect(signAndExecute("proposal-1")).rejects.toThrow(/wallet is not delegate-approved/);

    expect(prisma.tradeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", failureReason: expect.stringContaining("not delegate-approved") }),
      })
    );
    // The critical invariant: no fill was ever created. A rejected proposal
    // must never produce a fill that could be mistaken for a real trade.
    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects (does not simulate) when the delegate server reports the trade failed", async () => {
    fetch.mockResolvedValue({
      json: async () => ({ success: true, results: [{ chain: "ERC20", status: "failed", error: "insufficient balance" }] }),
    });
    prisma.tradeProposal.findUnique.mockResolvedValue(
      baseProposal({ wallet: { ...baseProposal().wallet, delegateApproved: true, delegateChain: "ERC20" } })
    );

    await expect(signAndExecute("proposal-1")).rejects.toThrow(/Delegate execution failed/);

    expect(prisma.tradeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", failureReason: expect.stringContaining("Delegate execution failed") }),
      })
    );
    expect(prisma.fill.create).not.toHaveBeenCalled();
  });
});

describe("signAndExecute — happy path (delegate execution succeeds)", () => {
  test("records a fill with the derived price/provenance and wires up position + notifications", async () => {
    fetch.mockResolvedValue({
      json: async () => ({ success: true, results: [{ chain: "ERC20", status: "success", txHash: "0xdeadbeef" }] }),
    });
    deriveFillPrice.mockReturnValue({
      fillPrice: 105,
      sourceSnapshotTs: new Date("2026-01-01T00:00:05.000Z"),
      fillMethod: "next_after_signal",
      wasLive: true,
    });
    const proposal = baseProposal({ wallet: { ...baseProposal().wallet, delegateApproved: true, delegateChain: "ERC20" } });
    prisma.tradeProposal.findUnique.mockResolvedValue(proposal);
    prisma.fill.create.mockResolvedValue({ id: "fill-1", fillPrice: 105 });

    const result = await signAndExecute("proposal-1");

    expect(prisma.fill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fillPrice: 105,
          wasLive: true,
          fillMethod: "next_after_signal",
          sourceSnapshotTs: expect.any(Date),
        }),
      })
    );
    expect(positionService.upsertPositionFromFill).toHaveBeenCalled();
    expect(positionService.snapshotPortfolio).toHaveBeenCalledWith("portfolio-1");
    expect(notify).toHaveBeenCalledWith(
      "user-1", "workspace-1", "TRADE_EXECUTED",
      expect.objectContaining({ onChain: true, fillPrice: 105 })
    );
    expect(result.fill).toBeDefined();
    expect(result.position).toBeDefined();
  });
});

describe("settlePosition — the fast-path retry loop", () => {
  const position = { id: "position-1", portfolioId: "portfolio-1", fill: { tradeProposalId: "proposal-1" } };

  test("marks NOT_APPLICABLE and never calls the delegate when the wallet is not delegate-approved", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({ wallet: { delegateApproved: false } });

    await settlePosition(position, 50);

    expect(prisma.position.update).toHaveBeenCalledWith({
      where: { id: "position-1" },
      data: { settlementStatus: "NOT_APPLICABLE" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("marks SETTLED immediately with no on-chain call when the return amount is zero or negative", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({
      wallet: { delegateApproved: true, provider: "METAMASK", delegateChain: "ERC20", address: "0xabc" },
      notional: 100,
    });

    // notional 100 + realizedPnl -150 = -50 -> clamped to 0, nothing owed
    await settlePosition(position, -150);

    expect(prisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ settlementStatus: "SETTLED" }) })
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("settles successfully on the first attempt", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({
      wallet: { delegateApproved: true, provider: "METAMASK", delegateChain: "ERC20", address: "0xabc" },
      notional: 1000,
    });
    fetch.mockResolvedValue({
      json: async () => ({ success: true, results: [{ chain: "ERC20", status: "success", txHash: "0xfeed" }] }),
    });

    await settlePosition(position, 50);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(prisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settlementStatus: "SETTLED", settlementTxHash: "0xfeed", settlementAttempts: 1 }),
      })
    );
  });

  test("retries after a transient failure and succeeds on the second attempt", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({
      wallet: { delegateApproved: true, provider: "METAMASK", delegateChain: "ERC20", address: "0xabc" },
      notional: 1000,
    });
    fetch
      .mockResolvedValueOnce({ json: async () => ({ success: true, results: [{ chain: "ERC20", status: "failed", error: "rpc timeout" }] }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, results: [{ chain: "ERC20", status: "success", txHash: "0xfeed2" }] }) });

    await settlePosition(position, 50);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settlementStatus: "SETTLED", settlementTxHash: "0xfeed2", settlementAttempts: 2 }),
      })
    );
  }, 10000); // one real ~1s backoff delay - extend the default timeout for safety

  test("exhausts all 3 attempts, marks SETTLEMENT_FAILED, and dispatches an alert", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({
      wallet: { delegateApproved: true, provider: "METAMASK", delegateChain: "ERC20", address: "0xabc" },
      notional: 1000,
    });
    fetch.mockResolvedValue({
      json: async () => ({ success: true, results: [{ chain: "ERC20", status: "failed", error: "persistent failure" }] }),
    });
    prisma.portfolio.findUnique.mockResolvedValue({ workspaceId: "workspace-1", workspace: { ownerId: "owner-1" } });

    await settlePosition(position, 50);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(prisma.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settlementStatus: "SETTLEMENT_FAILED", settlementError: expect.stringContaining("persistent failure") }),
      })
    );
    expect(notify).toHaveBeenCalledWith("owner-1", "workspace-1", "SETTLEMENT_FAILED", expect.any(Object));
  }, 15000); // real backoff delays total ~4s (1s + 3s) - extend timeout for safety
});

describe("retrySettlementOnce — single-attempt retry used by the reconciliation job", () => {
  test("resolves SETTLED on success", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({
      wallet: { delegateApproved: true, provider: "METAMASK", delegateChain: "ERC20", address: "0xabc" },
      notional: 1000,
    });
    fetch.mockResolvedValue({
      json: async () => ({ success: true, results: [{ chain: "ERC20", status: "success", txHash: "0xretry" }] }),
    });

    const result = await retrySettlementOnce({ id: "position-1", fill: { tradeProposalId: "proposal-1" }, realizedPnl: 50 });

    expect(result).toEqual({ resolved: true, status: "SETTLED", txHash: "0xretry" });
  });

  test("resolves SETTLEMENT_FAILED (not thrown) on failure - reconciliation can keep going", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({
      wallet: { delegateApproved: true, provider: "METAMASK", delegateChain: "ERC20", address: "0xabc" },
      notional: 1000,
    });
    fetch.mockResolvedValue({
      json: async () => ({ success: true, results: [{ chain: "ERC20", status: "failed", error: "still down" }] }),
    });

    const result = await retrySettlementOnce({ id: "position-1", fill: { tradeProposalId: "proposal-1" }, realizedPnl: 50 });

    expect(result.resolved).toBe(false);
    expect(result.status).toBe("SETTLEMENT_FAILED");
  });

  test("resolves NOT_APPLICABLE when the wallet is not delegate-approved", async () => {
    prisma.tradeProposal.findFirst.mockResolvedValue({ wallet: { delegateApproved: false } });

    const result = await retrySettlementOnce({ id: "position-1", fill: { tradeProposalId: "proposal-1" } });

    expect(result).toEqual({ resolved: true, status: "NOT_APPLICABLE" });
  });
});

describe("cancelProposal", () => {
  test("cancels a PENDING proposal and writes an audit event", async () => {
    prisma.tradeProposal.findUnique.mockResolvedValue({ id: "proposal-1", status: "PENDING", portfolioId: "portfolio-1" });
    prisma.tradeProposal.update.mockResolvedValue({ id: "proposal-1", status: "CANCELLED" });
    prisma.portfolio.findUnique.mockResolvedValue({ workspaceId: "workspace-1" });
    prisma.auditEvent.create.mockResolvedValue({});

    const result = await cancelProposal("proposal-1", "user-1");

    expect(prisma.tradeProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) })
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CANCEL", actorId: "user-1" }) })
    );
    expect(result.status).toBe("CANCELLED");
  });

  test("refuses to cancel a non-PENDING proposal", async () => {
    prisma.tradeProposal.findUnique.mockResolvedValue({ id: "proposal-1", status: "CONFIRMED" });

    await expect(cancelProposal("proposal-1", "user-1")).rejects.toThrow(/cannot be cancelled/);
    expect(prisma.tradeProposal.update).not.toHaveBeenCalled();
  });
});
