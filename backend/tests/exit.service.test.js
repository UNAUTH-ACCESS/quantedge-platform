process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

jest.mock("pg", () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(),
    query: jest.fn().mockResolvedValue(),
    end: jest.fn().mockResolvedValue(),
  })),
}));

jest.mock("../src/lib/prisma", () => ({
  position: { findUnique: jest.fn(), update: jest.fn() },
  portfolioSignalConfig: { findFirst: jest.fn() },
  regimeState: { findFirst: jest.fn() },
  workspace: { findUnique: jest.fn() },
  tradeProposal: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  transaction: { create: jest.fn() },
  fill: { create: jest.fn(), findUnique: jest.fn() },
  portfolioSignalEvaluation: { findFirst: jest.fn() },
  signal: { findFirst: jest.fn() },
}));

jest.mock("../src/lib/fillDerivation", () => ({
  deriveFillPrice: jest.fn(),
}));

jest.mock("../src/lib/syntheticOutcome", () => ({
  isSyntheticOutcomeEnabled: jest.fn(),
  generateSyntheticExit: jest.fn(),
}));

jest.mock("../src/services/position.service", () => ({
  snapshotPortfolio: jest.fn(),
}));

jest.mock("../src/notifications/router", () => ({
  notify: jest.fn(),
}));

jest.mock("../src/services/execution.service", () => ({
  settlePosition: jest.fn(),
}));

const prisma = require("../src/lib/prisma");
const { deriveFillPrice } = require("../src/lib/fillDerivation");
const { isSyntheticOutcomeEnabled, generateSyntheticExit } = require("../src/lib/syntheticOutcome");
const { snapshotPortfolio } = require("../src/services/position.service");
const { notify } = require("../src/notifications/router");
const { settlePosition } = require("../src/services/execution.service");
const { closePosition } = require("../src/services/exit.service");

function basePosition(overrides = {}) {
  return {
    id: "position-1",
    status: "OPEN",
    side: "LONG",
    size: 10,
    entryPrice: 100,
    currentPrice: 105,
    chainId: "chain-1",
    assetId: "asset-1",
    venueId: "venue-1",
    portfolioId: "portfolio-1",
    fill: null,
    asset: { symbol: "BTC" },
    venue: { name: "Jupiter", feeBps: 2.5 },
    chain: { type: "SOLANA" },
    portfolio: {
      id: "portfolio-1",
      workspaceId: "workspace-1",
      wallets: [
        { wallet: { id: "wallet-1", chainId: "chain-1", status: "CONNECTED", address: "0xabc" } },
      ],
      riskConfig: {},
    },
    ...overrides,
  };
}

// closePosition's internal randomDelay() has a hard 2000-8000ms floor with
// no way to reach 0 - fake timers let us skip past it instantly instead of
// every test paying a real multi-second wait.
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(global.Math, "random").mockReturnValue(0.5); // safe default: never triggers the 5% rejection
  prisma.tradeProposal.create.mockResolvedValue({ id: "proposal-1", proposedAt: new Date("2026-01-01T00:00:00.000Z"), notional: 1050, estFeeBps: 2.5 });
  prisma.tradeProposal.update.mockResolvedValue({});
  prisma.transaction.create.mockResolvedValue({ id: "transaction-1" });
  prisma.fill.create.mockResolvedValue({ id: "fill-1" });
  prisma.fill.findUnique.mockResolvedValue(null);
  prisma.signal.findFirst.mockResolvedValue({ id: "signal-1" });
  prisma.workspace.findUnique.mockResolvedValue({ ownerId: "owner-1" });
  prisma.portfolioSignalConfig.findFirst.mockResolvedValue(null);
  snapshotPortfolio.mockResolvedValue({});
  notify.mockResolvedValue({});
  settlePosition.mockResolvedValue({});
  isSyntheticOutcomeEnabled.mockReturnValue(false);
  deriveFillPrice.mockReturnValue({
    fillPrice: 110,
    sourceSnapshotTs: new Date("2026-01-01T00:00:05.000Z"),
    fillMethod: "next_after_signal",
    wasLive: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Runs closePosition and advances fake timers past its internal delay so
// the promise can actually resolve/reject.
async function runClose(positionId, reason) {
  const promise = closePosition(positionId, reason);
  await jest.advanceTimersByTimeAsync(10000);
  return promise;
}

describe("closePosition — basic validation (never throws)", () => {
  test("returns null if the position does not exist", async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    const result = await runClose("missing-id", "MANUAL");
    expect(result).toBeNull();
  });

  test("returns null (skips) if the position is not OPEN", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition({ status: "CLOSED" }));
    const result = await runClose("position-1", "MANUAL");
    expect(result).toBeNull();
    expect(prisma.tradeProposal.create).not.toHaveBeenCalled();
  });

  test("catches an unexpected error anywhere in the flow and returns null rather than throwing", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition());
    prisma.transaction.create.mockRejectedValue(new Error("db exploded"));
    await expect(runClose("position-1", "MANUAL")).resolves.toBeNull();
  });
});

describe("closePosition — simulated rejection (5% rate)", () => {
  test("when rejection triggers: returns null, notifies RISK_EVENT, and creates no proposal", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition());
    Math.random.mockReturnValueOnce(0.01); // forces < REJECTION_RATE (0.05) on the very first call

    const result = await runClose("position-1", "STOP_LOSS");

    expect(result).toBeNull();
    expect(notify).toHaveBeenCalledWith(
      "owner-1", "workspace-1", "RISK_EVENT",
      expect.objectContaining({ type: "REJECTION", actionTaken: expect.stringContaining("STOP_LOSS") })
    );
    expect(prisma.tradeProposal.create).not.toHaveBeenCalled();
  });
});

describe("closePosition — wallet availability", () => {
  test("returns null if no wallet is available for the position's chain", async () => {
    prisma.position.findUnique.mockResolvedValue(
      basePosition({ portfolio: { ...basePosition().portfolio, wallets: [] } })
    );
    const result = await runClose("position-1", "MANUAL");
    expect(result).toBeNull();
    expect(prisma.tradeProposal.create).not.toHaveBeenCalled();
  });
});

describe("closePosition — realized PnL math", () => {
  test("LONG position: realizedPnl = (exitPrice - entryPrice) * size - fee", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition({ side: "LONG", entryPrice: 100, size: 10 }));
    deriveFillPrice.mockReturnValue({ fillPrice: 110, sourceSnapshotTs: new Date(), fillMethod: "next_after_signal", wasLive: true });
    prisma.position.update.mockResolvedValue({ id: "position-1", realizedPnl: 0 });

    await runClose("position-1", "MANUAL");

    // notional = size(10) * currentPrice(105) = 1050; feeBps 2.5 -> fee = 1050*0.00025 = 0.2625
    // expected PnL = (110-100)*10 - 0.2625 = 99.7375
    const callArg = prisma.position.update.mock.calls[0][0];
    expect(callArg.data.status).toBe("CLOSED");
    expect(callArg.data.realizedPnl).toBeCloseTo(99.7375, 4);
  });

  test("SHORT position: realizedPnl = (entryPrice - exitPrice) * size - fee", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition({ side: "SHORT", entryPrice: 100, size: 10 }));
    deriveFillPrice.mockReturnValue({ fillPrice: 90, sourceSnapshotTs: new Date(), fillMethod: "next_after_signal", wasLive: true });
    prisma.position.update.mockResolvedValue({ id: "position-1", realizedPnl: 0 });

    await runClose("position-1", "MANUAL");

    // expected PnL = (100-90)*10 - 0.2625 = 99.7375 (same magnitude, price moved favorably for a short)
    const callArg = prisma.position.update.mock.calls[0][0];
    expect(callArg.data.realizedPnl).toBeCloseTo(99.7375, 4);
  });

  test("SHORT position that moved against it produces a negative realizedPnl", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition({ side: "SHORT", entryPrice: 100, size: 10 }));
    deriveFillPrice.mockReturnValue({ fillPrice: 110, sourceSnapshotTs: new Date(), fillMethod: "next_after_signal", wasLive: true });
    prisma.position.update.mockResolvedValue({ id: "position-1", realizedPnl: 0 });

    await runClose("position-1", "MANUAL");

    // (100-110)*10 - fee = -100 - 0.2625 = -100.2625
    const callArg = prisma.position.update.mock.calls[0][0];
    expect(callArg.data.realizedPnl).toBeCloseTo(-100.2625, 4);
  });
});

describe("closePosition — synthetic vs. real exit price branch", () => {
  test("uses generateSyntheticExit (not deriveFillPrice) when SIM_SYNTHETIC_OUTCOME is enabled", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition());
    isSyntheticOutcomeEnabled.mockReturnValue(true);
    generateSyntheticExit.mockReturnValue({ exitPrice: 103, isWin: true, movePct: 0.03 });

    await runClose("position-1", "MANUAL");

    expect(generateSyntheticExit).toHaveBeenCalledWith(100, "LONG"); // position.entryPrice, position.side
    expect(deriveFillPrice).not.toHaveBeenCalled();
    expect(prisma.fill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fillPrice: 103, fillMethod: "synthetic", wasLive: false, sourceSnapshotTs: null,
        }),
      })
    );
  });

  test("uses deriveFillPrice (not synthetic) by default, passing through its real provenance", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition());
    isSyntheticOutcomeEnabled.mockReturnValue(false);
    const snapshotTs = new Date("2026-01-01T00:00:07.000Z");
    deriveFillPrice.mockReturnValue({ fillPrice: 107, sourceSnapshotTs: snapshotTs, fillMethod: "next_after_signal", wasLive: true });

    await runClose("position-1", "MANUAL");

    expect(generateSyntheticExit).not.toHaveBeenCalled();
    expect(prisma.fill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fillPrice: 107, fillMethod: "next_after_signal", wasLive: true, sourceSnapshotTs: snapshotTs,
        }),
      })
    );
  });
});

describe("closePosition — settlement wiring", () => {
  test("calls settlePosition with the closed position and the computed realizedPnl", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition());
    prisma.position.update.mockResolvedValue({ id: "position-1", realizedPnl: 99.7375 });

    await runClose("position-1", "MANUAL");

    expect(settlePosition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "position-1" }),
      expect.any(Number)
    );
  });

  test("still returns the closed position even if settlePosition throws unexpectedly", async () => {
    prisma.position.findUnique.mockResolvedValue(basePosition());
    const closed = { id: "position-1", realizedPnl: 99.7375, status: "CLOSED" };
    prisma.position.update.mockResolvedValue(closed);
    settlePosition.mockRejectedValue(new Error("delegate server unreachable"));

    const result = await runClose("position-1", "MANUAL");

    expect(result).toEqual(closed);
  });
});
