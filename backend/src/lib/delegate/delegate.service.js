/**
 * delegate.service.js
 * QuantEdge-aware wrapper around the delegate HTTP server.
 * Calls http://172.19.0.1:3001 (host delegate server) from inside Docker.
 */

const prisma = require("../prisma");
const logger = require("../logger");
const config = require("../config");

// ── Chain mapping ─────────────────────────────────────────────────────────────
const PROVIDER_CHAIN_MAP = {
  "METAMASK":     "ERC20",
  "TRUST_WALLET": "ERC20",
  "TRONLINK":     "TRC20",
  "PHANTOM":      "SPL"
};

function resolveChainKey(wallet) {
  return PROVIDER_CHAIN_MAP[wallet.provider] || null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
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
  if (!data.success) throw new Error(data.error || `Delegate server error at ${endpoint}`);
  return data;
}

// ── Service ───────────────────────────────────────────────────────────────────
const DelegateService = {

  async buildLinkPayloads(walletIds, capUSDT = 10000) {
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: walletIds } },
      include: { chain: true }
    });
    const chains = [...new Set(wallets.map(resolveChainKey).filter(Boolean))];
    if (!chains.length) throw new Error("No supported chains found for provided wallets");
    const data = await delegatePost("/link-payload", { chains, capUSDT });
    return { chains, payloads: data.payloads };
  },

  async confirmLink(walletId, txHash, userId) {
    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
      include: { chain: true }
    });
    if (!wallet) throw new Error("Wallet not found");

    const chainKey = resolveChainKey(wallet);
    if (!chainKey) throw new Error(`Unsupported chain for wallet ${walletId}`);

    const data = await delegatePost("/status", {
      chains: [chainKey],
      addresses: { [chainKey]: wallet.address }
    });

    const status = data.statuses[0];
    if (status.error) throw new Error(`Chain check failed: ${status.error}`);

    const allowance = parseFloat(status.allowance);
    if (allowance === 0) throw new Error("Approval not yet detected on-chain. Retry in a few seconds.");

    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        delegateApproved:   true,
        approvedCap:        allowance,
        remainingAllowance: allowance,
        linkTxHash:         txHash,
        delegateChain:      chainKey,
        lastCheckedAt:      new Date(),
        status:             "CONNECTED"
      }
    });

    logger.info("Wallet linked", { walletId, userId, chainKey, allowance, txHash });
    return { walletId, chainKey, approvedCap: allowance, txHash };
  },

  async buildUnlinkPayload(walletId, userId) {
    const wallet = await prisma.wallet.findFirst({
      where: { id: walletId, userId },
      include: { chain: true }
    });
    if (!wallet) throw new Error("Wallet not found");
    const chainKey = resolveChainKey(wallet);
    const data = await delegatePost("/revoke-payload", { chains: [chainKey] });
    return { chainKey, payload: data.payloads[chainKey] };
  },

  async confirmUnlink(walletId, userId) {
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        delegateApproved:   false,
        approvedCap:        null,
        remainingAllowance: null,
        linkTxHash:         null,
        status:             "DISCONNECTED"
      }
    });
    logger.info("Wallet unlinked", { walletId, userId });
    return { walletId, unlinked: true };
  },

  async getWorkspaceWalletStatus(workspaceId) {
    const wallets = await prisma.wallet.findMany({
      where: { workspaceId, delegateApproved: true },
      include: { chain: true }
    });
    if (!wallets.length) return [];

    const results = [];
    for (const wallet of wallets) {
      const chainKey = wallet.delegateChain || resolveChainKey(wallet);
      if (!chainKey) continue;
      try {
        const data = await delegatePost("/status", {
          chains: [chainKey],
          addresses: { [chainKey]: wallet.address }
        });
        const s = data.statuses[0];
        if (!s.error) {
          await prisma.wallet.update({
            where: { id: wallet.id },
            data: { remainingAllowance: parseFloat(s.allowance), lastCheckedAt: new Date() }
          });
        }
        results.push({
          walletId:  wallet.id,
          label:     wallet.label,
          address:   wallet.address,
          chain:     chainKey,
          balance:   s.balance,
          allowance: s.allowance,
          error:     s.error || null
        });
      } catch (e) {
        results.push({ walletId: wallet.id, chain: chainKey, error: e.message });
      }
    }
    return results;
  },

  async executeTrade({ workspaceId, chains, toAddress, amountUSDT, amounts }) {
    const wallets = await prisma.wallet.findMany({
      where: { workspaceId, delegateApproved: true, delegateChain: { in: chains } },
      include: { chain: true }
    });
    if (!wallets.length) throw new Error("No approved delegate wallets found for requested chains");

    const fromAddress = {};
    wallets.forEach(w => { fromAddress[w.delegateChain] = w.address; });

    const missing = chains.filter(c => !fromAddress[c]);
    if (missing.length) throw new Error(`No linked wallet for chains: ${missing.join(", ")}`);

    const result = await delegatePost("/execute-trade", {
      chains, fromAddress, toAddress, amountUSDT, amounts
    });

    logger.info("Trade executed", { workspaceId, chains, amountUSDT, summary: result.summary });
    return result;
  }
};

module.exports = DelegateService;
