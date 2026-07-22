jest.mock("../src/lib/prisma", () => ({
  position: { findMany: jest.fn() },
}));

jest.mock("../src/services/execution.service", () => ({
  retrySettlementOnce: jest.fn(),
  dispatchSettlementFailedAlert: jest.fn(),
}));

const prisma = require("../src/lib/prisma");
const { retrySettlementOnce, dispatchSettlementFailedAlert } = require("../src/services/execution.service");
const { reconcileStuckSettlements } = require("../src/workers/settlementReconciliation.job");

function stuckPosition(overrides = {}) {
  return {
    id: "position-1",
    settlementStatus: "SETTLEMENT_FAILED",
    lastSettlementAt: new Date(),
    realizedPnl: 50,
    fill: { tradeProposal: { wallet: { delegateChain: "ERC20" } } },
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  dispatchSettlementFailedAlert.mockResolvedValue({});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// The job processes stuck positions one at a time with a 3s delay between
// each - advance generously past however many are in a given test.
async function runReconcile() {
  const promise = reconcileStuckSettlements();
  await jest.advanceTimersByTimeAsync(30000);
  return promise;
}

describe("reconcileStuckSettlements — query correctness", () => {
  test("queries for SETTLEMENT_FAILED OR orphaned SETTLEMENT_PENDING (past the 2-minute threshold)", async () => {
    prisma.position.findMany.mockResolvedValue([]);

    await runReconcile();

    const queryArg = prisma.position.findMany.mock.calls[0][0];
    expect(queryArg.where.OR).toEqual([
      { settlementStatus: "SETTLEMENT_FAILED" },
      { settlementStatus: "SETTLEMENT_PENDING", lastSettlementAt: { lt: expect.any(Date) } },
    ]);
  });

  test("does nothing when no stuck settlements are found", async () => {
    prisma.position.findMany.mockResolvedValue([]);
    await runReconcile();
    expect(retrySettlementOnce).not.toHaveBeenCalled();
  });
});

describe("reconcileStuckSettlements — duplicate-alert avoidance", () => {
  test("a SETTLEMENT_FAILED position that resolves does NOT trigger any alert", async () => {
    prisma.position.findMany.mockResolvedValue([stuckPosition({ settlementStatus: "SETTLEMENT_FAILED" })]);
    retrySettlementOnce.mockResolvedValue({ resolved: true, status: "SETTLED", txHash: "0xabc" });

    await runReconcile();

    expect(dispatchSettlementFailedAlert).not.toHaveBeenCalled();
  });

  test("an already-SETTLEMENT_FAILED position that fails again does NOT re-alert (already alerted initially by execution.service.js)", async () => {
    prisma.position.findMany.mockResolvedValue([stuckPosition({ settlementStatus: "SETTLEMENT_FAILED" })]);
    retrySettlementOnce.mockResolvedValue({ resolved: false, status: "SETTLEMENT_FAILED", error: "still down" });

    await runReconcile();

    expect(dispatchSettlementFailedAlert).not.toHaveBeenCalled();
  });

  test("an orphaned SETTLEMENT_PENDING position that fails DOES alert - this is the first discovery it's a real failure", async () => {
    prisma.position.findMany.mockResolvedValue([
      stuckPosition({ id: "position-2", settlementStatus: "SETTLEMENT_PENDING", realizedPnl: 75 }),
    ]);
    retrySettlementOnce.mockResolvedValue({ resolved: false, status: "SETTLEMENT_FAILED", error: "orphaned and still failing" });

    await runReconcile();

    expect(dispatchSettlementFailedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "position-2" }),
      "ERC20", 75, "orphaned and still failing"
    );
  });
});

describe("reconcileStuckSettlements — one-at-a-time processing, resilient to individual failures", () => {
  test("processes every stuck position even if retrySettlementOnce throws unexpectedly for one of them", async () => {
    prisma.position.findMany.mockResolvedValue([
      stuckPosition({ id: "position-1" }),
      stuckPosition({ id: "position-2" }),
    ]);
    retrySettlementOnce
      .mockRejectedValueOnce(new Error("unexpected crash mid-retry"))
      .mockResolvedValueOnce({ resolved: true, status: "SETTLED", txHash: "0xok" });

    await runReconcile();

    // Both positions were attempted - the first throwing didn't abort the loop
    expect(retrySettlementOnce).toHaveBeenCalledTimes(2);
  });
});

describe("reconcileStuckSettlements — never throws at the cycle level", () => {
  test("swallows an error from the initial query itself rather than propagating", async () => {
    prisma.position.findMany.mockRejectedValue(new Error("db connection lost"));
    await expect(runReconcile()).resolves.toBeUndefined();
  });
});
