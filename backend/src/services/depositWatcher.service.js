/**
 * Deposit Watcher Service
 *
 * Detects SPL USDC deposits arriving in users' connected, delegate-approved
 * Solana wallets. USDC is the deposit asset only — it is swept to
 * SOLANA_DEPOSIT_VAULT, then converted 1:1 into USDT and allocated
 * proportionally across the user's delegated trading wallets (1, 2, or 3
 * chains depending on what they've connected). All trading continues
 * exclusively in USDT — USDC never touches the trading path.
 *
 * Flow per detected deposit:
 *   DETECTED → VAULTED → MINTED → ALLOCATED → COMPLETE
 *
 * Called by the worker on an interval (DEPOSIT_INTERVAL_MS).
 */

const { Client } = require("pg");
const prisma  = require("../lib/prisma");
const logger  = require("../lib/logger");
const config  = require("../lib/config");

const SOLANA_DEPOSIT_VAULT = process.env.SOLANA_DEPOSIT_VAULT;

// Minimum USDC balance worth acting on — avoids dust-triggered cycles
const MIN_DEPOSIT_USDC = parseFloat(process.env.MIN_DEPOSIT_USDC || "1");

async function pgNotify(channel, payload) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  } catch (err) {
    logger.warn("[depositWatcher] pg_notify failed", { channel, error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
}

async function delegatePost(endpoint, body) {
  const res = await fetch(`${config.DELEGATE_SERVER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-delegate-secret": config.DELEGATE_SHARED_SECRET,
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || `Delegate error at ${endpoint}`);
  return data;
}

/**
 * Find a user's active trading chains — distinct delegateChain values
 * across their delegate-approved wallets that are joined to at least one
 * portfolio. Returns 1, 2, or 3 chain keys.
 */
async function getActiveChainsForUser(userId, workspaceId) {
  const wallets = await prisma.wallet.findMany({
    where: {
      userId,
      workspaceId,
      delegateApproved: true,
      status: "CONNECTED",
      portfolioWallets: { some: {} }
    },
    select: { id: true, address: true, delegateChain: true }
  });

  const byChain = {};
  for (const w of wallets) {
    if (w.delegateChain && !byChain[w.delegateChain]) {
      byChain[w.delegateChain] = w.address;
    }
  }
  return byChain; // e.g. { ERC20: "0x...", TRC20: "T...", SPL: "..." }
}

/**
 * Process a single detected deposit through the full sweep + allocate flow.
 */
async function processDeposit(wallet) {
  const usdcBalanceStr = (await delegatePost("/usdc-balance", { address: wallet.address })).balance;
  const usdcBalance = parseFloat(usdcBalanceStr);

  if (!usdcBalance || usdcBalance < MIN_DEPOSIT_USDC) {
    return null; // nothing to do
  }

  logger.info("[depositWatcher] USDC deposit detected", {
    walletId: wallet.id, address: wallet.address, usdcBalance
  });

  // Create the deposit record up front (DETECTED)
  const deposit = await prisma.deposit.create({
    data: {
      workspaceId: wallet.workspaceId,
      userId: wallet.userId,
      walletId: wallet.id,
      chain: "SPL",
      depositAmount: usdcBalance,
      vaultAddress: SOLANA_DEPOSIT_VAULT,
      status: "DETECTED"
    }
  });

  try {
    // 1. Sweep USDC → vault
    const sweep = await delegatePost("/sweep-usdc-deposit", {
      fromAddress: wallet.address,
      amountUSDC: usdcBalance
    });

    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "VAULTED", sweepTxHash: sweep.txHash }
    });

    // 2. Determine the user's active trading chains and proportional split
    const activeChains = await getActiveChainsForUser(wallet.userId, wallet.workspaceId);
    const chainKeys = Object.keys(activeChains);

    if (chainKeys.length === 0) {
      throw new Error("No active delegate-approved trading wallets found for user — cannot allocate");
    }

    const perChainAmount = Math.floor((usdcBalance / chainKeys.length) * 1e6) / 1e6;
    const amounts = {};
    for (const chain of chainKeys) amounts[chain] = perChainAmount;

    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "MINTED" }
    });

    // 3. Mint USDT 1:1 and allocate proportionally across active chains
    const allocation = await delegatePost("/allocate-deposit", {
      chains: chainKeys,
      toAddress: activeChains,
      amounts
    });

    const allFailed = allocation.summary.succeeded === 0;
    const status = allFailed ? "FAILED" : "COMPLETE";

    await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        status,
        allocations: allocation.results,
        completedAt: status === "COMPLETE" ? new Date() : null,
        errorMessage: allFailed ? "All chain allocations failed" : null
      }
    });

    await pgNotify("deposit_completed", {
      depositId: deposit.id,
      userId: wallet.userId,
      walletId: wallet.id,
      usdcAmount: usdcBalance,
      status,
      allocations: allocation.results
    });

    logger.info("[depositWatcher] Deposit allocation finished", {
      depositId: deposit.id, status, succeeded: allocation.summary.succeeded, failed: allocation.summary.failed
    });

    return deposit;

  } catch (err) {
    logger.error("[depositWatcher] Deposit processing failed", {
      depositId: deposit.id, error: err.message
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "FAILED", errorMessage: err.message }
    });
    return deposit;
  }
}

/**
 * Main loop — checks all delegate-approved SPL wallets for USDC deposits.
 * Called on an interval by the worker.
 */
async function watchForDeposits() {
  if (!SOLANA_DEPOSIT_VAULT) {
    logger.warn("[depositWatcher] SOLANA_DEPOSIT_VAULT not configured — skipping cycle");
    return;
  }

  const splWallets = await prisma.wallet.findMany({
    where: {
      delegateChain: "SPL",
      delegateApproved: true,
      status: "CONNECTED"
    }
  });

  for (const wallet of splWallets) {
    try {
      await processDeposit(wallet);
    } catch (err) {
      logger.error("[depositWatcher] Unhandled error for wallet", {
        walletId: wallet.id, error: err.message
      });
    }
  }
}

module.exports = { watchForDeposits, getActiveChainsForUser };
