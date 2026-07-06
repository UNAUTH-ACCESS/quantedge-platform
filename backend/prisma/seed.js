// prisma/seed.js
// Bootstraps:
//   - Platform roles
//   - Chains + Venues + Assets
//   - Default workspace + owner user
//   - Subscription
//   - Portfolio + RiskConfig + Wallets
//   - Strategy + SignalConfig (frozen)
//   - Initial RegimeState

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding QuantEdge database...");

  // ── Roles ─────────────────────────────────────────────────────────────────
  let platformAdminRole = await prisma.role.findFirst({ where: { name: "PLATFORM_ADMIN", workspaceId: null } });
  if (!platformAdminRole) {
    platformAdminRole = await prisma.role.create({
      data: { workspaceId: null, name: "PLATFORM_ADMIN", permissions: ["manage_workspaces", "view_all", "suspend_workspace", "manage_platform"] },
    });
  }

  // ── Chains ────────────────────────────────────────────────────────────────
  const solanaChain = await prisma.chain.upsert({
    where: { name: "Solana" },
    update: {},
    create: {
      name: "Solana",
      type: "SOLANA",
      networkId: "mainnet-beta",
      explorerUrl: "https://solscan.io",
      nativeSymbol: "SOL",
    },
  });

  const evmChain = await prisma.chain.upsert({
    where: { name: "Arbitrum" },
    update: {},
    create: {
      name: "Arbitrum",
      type: "EVM",
      networkId: "42161",
      explorerUrl: "https://arbiscan.io",
      nativeSymbol: "ETH",
    },
  });

  // ── Venues ────────────────────────────────────────────────────────────────
  const drift = await prisma.venue.upsert({
    where: { name: "Drift" },
    update: {},
    create: { name: "Drift", chainId: solanaChain.id, type: "PERP", feeBps: 5, makerRebateBps: 2 },
  });

  const jupiter = await prisma.venue.upsert({
    where: { name: "Jupiter" },
    update: {},
    create: { name: "Jupiter", chainId: solanaChain.id, type: "AGGREGATOR", feeBps: 1, makerRebateBps: 0 },
  });

  const hyperliquid = await prisma.venue.upsert({
    where: { name: "Hyperliquid" },
    update: {},
    create: { name: "Hyperliquid", chainId: evmChain.id, type: "PERP", feeBps: 2.5, makerRebateBps: 1 },
  });

  const oneInch = await prisma.venue.upsert({
    where: { name: "1inch" },
    update: {},
    create: { name: "1inch", chainId: evmChain.id, type: "AGGREGATOR", feeBps: 1, makerRebateBps: 0 },
  });

  // ── Assets ────────────────────────────────────────────────────────────────
  const sol = await prisma.asset.upsert({
    where: { symbol: "SOL" },
    update: {},
    create: { symbol: "SOL", name: "Solana", coingeckoId: "solana", decimals: 9 },
  });

  const btc = await prisma.asset.upsert({
    where: { symbol: "BTC" },
    update: {},
    create: { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", decimals: 8 },
  });

  const eth = await prisma.asset.upsert({
    where: { symbol: "ETH" },
    update: {},
    create: { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", decimals: 18 },
  });

  // ── Platform Admin User ───────────────────────────────────────────────────
  const adminPasswordHash = await bcrypt.hash("Admin1234!", 12);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@quantedge.io" },
    update: {},
    create: {
      email: "admin@quantedge.io",
      passwordHash: adminPasswordHash,
      name: "Platform Admin",
      status: "ACTIVE",
    },
  });

  await prisma.platformAdmin.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
      permissions: ["manage_workspaces", "view_all", "suspend_workspace", "manage_platform"],
    },
  });

  // ── Default Workspace + Owner ─────────────────────────────────────────────
  const ownerPasswordHash = await bcrypt.hash("Trader1234!", 12);
  const ownerUser = await prisma.user.upsert({
    where: { email: "else@quantedge.io" },
    update: {},
    create: {
      email: "else@quantedge.io",
      passwordHash: ownerPasswordHash,
      name: "ELSE",
      status: "ACTIVE",
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "else-trading" },
    update: {},
    create: {
      name: "ELSE Trading",
      slug: "else-trading",
      status: "ACTIVE",
      ownerId: ownerUser.id,
      settings: { timezone: "UTC", notifications: true },
    },
  });

  // Workspace roles
  let accountAdminRole = await prisma.role.findFirst({ where: { name: "ACCOUNT_ADMIN", workspaceId: workspace.id } });
  if (!accountAdminRole) {
    accountAdminRole = await prisma.role.create({
      data: { workspaceId: workspace.id, name: "ACCOUNT_ADMIN", permissions: ["manage_members", "manage_portfolios", "manage_strategies", "view_all", "execute_trades"] },
    });
  }

  let traderRole = await prisma.role.findFirst({ where: { name: "TRADER", workspaceId: workspace.id } });
  if (!traderRole) {
    traderRole = await prisma.role.create({
      data: { workspaceId: workspace.id, name: "TRADER", permissions: ["view_signals", "execute_trades", "view_positions", "view_portfolio"] },
    });
  }

  const existingViewer = await prisma.role.findFirst({ where: { name: "VIEWER", workspaceId: workspace.id } });
  if (!existingViewer) {
    await prisma.role.create({
      data: { workspaceId: workspace.id, name: "VIEWER", permissions: ["view_signals", "view_positions", "view_portfolio"] },
    });
  }

  // Owner membership
  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: ownerUser.id } },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: ownerUser.id,
      roleId: accountAdminRole.id,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });

  // ── Subscription ──────────────────────────────────────────────────────────
  const now = new Date();
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      plan: "PRO",
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      limits: { max_portfolios: 5, max_wallets: 10, signal_delay_ms: 0 },
    },
  });

  // ── Wallets ───────────────────────────────────────────────────────────────
  const solWallet = await prisma.wallet.upsert({
    where: { workspaceId_address_chainId: { workspaceId: workspace.id, address: "8xKpQmN3qR7sT2vW5yZ1bC4dF6gH9jK", chainId: solanaChain.id } },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: ownerUser.id,
      label: "Solana Trading Wallet",
      address: "8xKpQmN3qR7sT2vW5yZ1bC4dF6gH9jK",
      chainId: solanaChain.id,
      provider: "PHANTOM",
      status: "CONNECTED",
      verifiedAt: now,
    },
  });

  const evmWallet = await prisma.wallet.upsert({
    where: { workspaceId_address_chainId: { workspaceId: workspace.id, address: "0x7f3a9b2c4d8e1f5a6b7c8d9e0f1a2b3c", chainId: evmChain.id } },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: ownerUser.id,
      label: "EVM Trading Wallet",
      address: "0x7f3a9b2c4d8e1f5a6b7c8d9e0f1a2b3c",
      chainId: evmChain.id,
      provider: "METAMASK",
      status: "CONNECTED",
      verifiedAt: now,
    },
  });

  // ── Portfolio ─────────────────────────────────────────────────────────────
  const portfolio = await prisma.portfolio.upsert({
    where: { id: "portfolio-main-else" },
    update: {},
    create: {
      id: "portfolio-main-else",
      workspaceId: workspace.id,
      name: "Main Portfolio",
      baseCurrency: "USDT",
      status: "ACTIVE",
      inceptionAt: new Date("2026-06-01"),
    },
  });

  // Link wallets to portfolio
  await prisma.portfolioWallet.upsert({
    where: { portfolioId_walletId: { portfolioId: portfolio.id, walletId: solWallet.id } },
    update: {},
    create: { portfolioId: portfolio.id, walletId: solWallet.id },
  });

  await prisma.portfolioWallet.upsert({
    where: { portfolioId_walletId: { portfolioId: portfolio.id, walletId: evmWallet.id } },
    update: {},
    create: { portfolioId: portfolio.id, walletId: evmWallet.id },
  });

  // RiskConfig
  await prisma.riskConfig.upsert({
    where: { portfolioId: portfolio.id },
    update: {},
    create: {
      portfolioId: portfolio.id,
      maxPositionPct: 15,
      stopLossPct: 5,
      kellyFraction: 0.25,
      maxDrawdownPct: 20,
      stressExposureCapPct: 50,
      signalStrengthThreshold: 0.5,
    },
  });

  // Initial snapshot
  await prisma.portfolioSnapshot.create({
    data: {
      portfolioId: portfolio.id,
      nav: 70500,
      cash: 70500,
      invested: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      snappedAt: new Date("2026-06-01"),
    },
  });

  // ── Strategy + SignalConfig ───────────────────────────────────────────────
  const strategy = await prisma.strategy.upsert({
    where: { id: "strategy-solrise-v2" },
    update: {},
    create: {
      id: "strategy-solrise-v2",
      workspaceId: workspace.id,
      name: "SOLrise v2 — Funding + Dispersion",
      description: "Multi-asset regime detection with funding rate dynamics and cross-asset dispersion signals. Validated on 5-year backfill.",
      status: "LIVE",
      createdById: ownerUser.id,
    },
  });

  const signalConfig = await prisma.signalConfig.upsert({
    where: { id: "sigconfig-v1-frozen" },
    update: {},
    create: {
      id: "sigconfig-v1-frozen",
      strategyId: strategy.id,
      version: 1,
      featureSet: [
        { name: "btc_change_30m", lag: 2, weight: 0.41 },
        { name: "bid_ask_imbalance", lag: 1, weight: 0.38 },
        { name: "price_change_5m", lag: 2, weight: 0.21 },
      ],
      thresholds: { strength_min: 0.5, kelly_max: 0.25 },
      kellyFraction: 0.25,
      barFrequency: "2-bar-30m",
      status: "FROZEN",
      frozenAt: new Date("2026-06-10"),
      frozenById: ownerUser.id,
    },
  });

  // Link portfolio to signalConfig
  await prisma.portfolioSignalConfig.upsert({
    where: { portfolioId_signalConfigId: { portfolioId: portfolio.id, signalConfigId: signalConfig.id } },
    update: {},
    create: {
      portfolioId: portfolio.id,
      signalConfigId: signalConfig.id,
      active: true,
      enabledAt: new Date("2026-06-10"),
    },
  });

  // ── Initial RegimeState ───────────────────────────────────────────────────
  await prisma.regimeState.upsert({
    where: { id: "regime-current" },
    update: {},
    create: {
      id: "regime-current",
      signalConfigId: signalConfig.id,
      state: "QUIET_BULLISH",
      confidence: 0.847,
      hmmState: 2,
      btcStressIndex: 0.12,
      transitionProb: 0.083,
      validFrom: new Date("2026-06-10T08:00:00Z"),
      validTo: null,
    },
  });

  console.log("✓ Roles seeded");
  console.log("✓ Chains seeded:", solanaChain.name, evmChain.name);
  console.log("✓ Venues seeded:", [drift, jupiter, hyperliquid, oneInch].map(v => v.name).join(", "));
  console.log("✓ Assets seeded:", [sol, btc, eth].map(a => a.symbol).join(", "));
  console.log("✓ Platform admin:", adminUser.email);
  console.log("✓ Workspace:", workspace.slug);
  console.log("✓ Owner:", ownerUser.email, "/ password: Trader1234!");
  console.log("✓ Portfolio:", portfolio.name);
  console.log("✓ Strategy:", strategy.name);
  console.log("✓ SignalConfig v1 frozen");
  console.log("✓ RegimeState: QUIET_BULLISH");
  console.log("\nSeed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
