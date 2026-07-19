import { useState, useEffect } from "react";
import { colors } from "../../lib/tokens";
import client from "../../api/client";
import useAuthStore from "../../store/auth.store";

// ── Chain config ──────────────────────────────────────────────────────────────

const CHAINS = [
  {
    key:      "ERC20",
    label:    "Ethereum",
    sub:      "ETH trades · ERC-20 USDT",
    provider: "METAMASK",
    icon:     "⬡",
    color:    "#627EEA",
    detect:   () => typeof window.ethereum !== "undefined" && window.ethereum.isMetaMask,
    getAddress: async () => {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      return accounts[0];
    },
    switchChain: async () => {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7a69" }] // Hardhat local chainId 31337
      });
    },
    sendApproval: async (payload) => {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      return window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: accounts[0], to: payload.to, data: payload.data }]
      });
    }
  },
  {
    key:      "TRC20",
    label:    "Tron",
    sub:      "TRX trades · TRC-20 USDT",
    provider: "TRONLINK",
    icon:     "◈",
    color:    "#FF060A",
    detect:   () => typeof window.tronWeb !== "undefined" && window.tronWeb.ready,
    getAddress: async () => {
      return window.tronWeb.defaultAddress.base58;
    },
    switchChain: async () => {}, // TronLink handles network internally
    sendApproval: async (payload) => {
      const tx = await window.tronWeb.transactionBuilder.triggerSmartContract(
        payload.contractAddress,
        payload.functionSelector,
        { feeLimit: 100_000_000 },
        payload.parameters,
        window.tronWeb.defaultAddress.hex
      );
      const signed = await window.tronWeb.trx.sign(tx.transaction);
      const result = await window.tronWeb.trx.sendRawTransaction(signed);
      return result.txid;
    }
  },
  {
    key:      "SPL",
    label:    "Solana",
    sub:      "SOL trades · SPL USDT",
    provider: "PHANTOM",
    icon:     "◎",
    color:    "#9945FF",
    detect:   () => typeof window.solana !== "undefined" && window.solana.isPhantom,
    getAddress: async () => {
      const resp = await window.solana.connect();
      return resp.publicKey.toString();
    },
    switchChain: async () => {}, // Phantom handles network internally
    sendApproval: async (payload) => {
      // SPL approve via Phantom signAndSendTransaction
      // The transaction is built server-side and returned as a base64 serialized tx
      // Payload includes: { transaction: base64string } built by delegate-server
      if (payload.transaction) {
        const txBuffer = Uint8Array.from(atob(payload.transaction), c => c.charCodeAt(0));
        const result = await window.solana.signAndSendTransaction({
          message: txBuffer
        });
        return result.signature;
      }
      // Fallback: return payload note if no tx built yet
      throw new Error("SPL transaction payload missing — ensure delegate server is running");
    }
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUSES = {
  idle:        { label: "Not connected",   color: colors.muted  },
  detecting:   { label: "Detecting…",      color: colors.muted  },
  connecting:  { label: "Connecting…",     color: colors.violet },
  approving:   { label: "Awaiting approval…", color: colors.violet },
  confirming:  { label: "Confirming…",     color: colors.orange },
  linked:      { label: "Linked",          color: colors.green  },
  error:       { label: "Error",           color: colors.red    },
};

// ── WalletCard ────────────────────────────────────────────────────────────────

function WalletCard({ chain, workspaceId, onLinked, approvedWallet }) {
  const [status,  setStatus]  = useState("idle");
  const [error,   setError]   = useState(null);
  const [address, setAddress] = useState(null);
  const [txHash,  setTxHash]  = useState(null);

  // Hydrate from server truth. Without this, the card starts at "idle" on
  // every mount regardless of what's actually delegate-approved on-chain -
  // which is exactly the desync where already-linked wallets showed as
  // "Not connected". Only overrides idle/error states, never an in-flight
  // connect attempt.
  useEffect(() => {
    if (approvedWallet && (status === "idle" || status === "error")) {
      setStatus("linked");
      setAddress(approvedWallet.address);
      if (approvedWallet.linkTxHash) setTxHash(approvedWallet.linkTxHash);
    }
  }, [approvedWallet]);

  const s = STATUSES[status];
  const isLinked = status === "linked";

  async function handleConnect() {
    setError(null);
    try {
      // 1. Detect wallet
      setStatus("detecting");
      if (!chain.detect()) {
        throw new Error(`${chain.label} wallet not detected. Install ${chain.provider === "METAMASK" ? "MetaMask" : chain.provider === "TRONLINK" ? "TronLink" : "Phantom"}.`);
      }

      // 2. Get address
      setStatus("connecting");
      const addr = await chain.getAddress();
      setAddress(addr);
      await chain.switchChain();

      // 3. Create wallet record in DB
      const chainsRes = await client.get("/wallets");
      // Check if wallet already exists
      const existing = chainsRes.data.data?.find(
        w => w.address.toLowerCase() === addr.toLowerCase()
      );

      let walletId;
      if (existing) {
        walletId = existing.id;
      } else {
        // Get chain ID from DB
        const chainRes = await client.get("/chains").catch(() => null);
        const dbChain = chainRes?.data?.data?.find(c =>
          chain.key === "ERC20" ? c.type === "EVM" :
          chain.key === "TRC20" ? c.type === "TRON" :
          c.type === "SOLANA"
        );

        const walletRes = await client.post("/wallets", {
          label:    `${chain.label} Wallet`,
          address:  addr,
          chainId:  dbChain?.id || chain.key,
          provider: chain.provider
        });
        walletId = walletRes.data.data.id;
      }

      // 4. Get approval payload from delegate server
      setStatus("approving");
      const payloadRes = await client.post("/wallets/link-payload", {
        walletIds: [walletId],
        capUSDT:   10000
      });
      const payload = payloadRes.data.data.payloads[chain.key];
      if (!payload) throw new Error(`No payload returned for ${chain.key}`);

      // 5. Present approve tx to wallet
      const hash = await chain.sendApproval(payload);
      setTxHash(hash);

      // 6. Confirm with backend
      setStatus("confirming");
      await new Promise(r => setTimeout(r, 3000)); // wait for on-chain confirmation
      await client.post(`/wallets/${walletId}/link-confirm`, { txHash: hash });

      setStatus("linked");
      onLinked?.({ chain: chain.key, address: addr, txHash: hash });

    } catch (e) {
      setError(e.message || "Connection failed");
      setStatus("error");
    }
  }

  async function handleUnlink() {
    setStatus("connecting");
    setError(null);
    try {
      const walletsRes = await client.get("/wallets");
      const wallet = walletsRes.data.data?.find(
        w => w.address.toLowerCase() === address?.toLowerCase()
      );
      if (!wallet) throw new Error("Wallet not found");

      const payloadRes = await client.post(`/wallets/${wallet.id}/unlink-payload`);
      const payload = payloadRes.data.data.payload;
      await chain.sendApproval(payload);
      await client.post(`/wallets/${wallet.id}/unlink-confirm`);

      setStatus("idle");
      setAddress(null);
      setTxHash(null);
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }

  return (
    <div style={{
      background:   colors.surface,
      border:       `1px solid ${isLinked ? chain.color + "44" : colors.border}`,
      borderRadius: 8,
      padding:      20,
      display:      "flex",
      flexDirection: "column",
      gap:          14,
      transition:   "border-color 0.2s",
      position:     "relative",
      overflow:     "hidden"
    }}>
      {/* Accent bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: 2,
        background: isLinked ? chain.color : "transparent",
        transition: "background 0.3s"
      }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 22, color: chain.color,
            fontFamily: "monospace", lineHeight: 1
          }}>{chain.icon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
              {chain.label}
            </div>
            <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
              {chain.sub}
            </div>
          </div>
        </div>

        {/* Status pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: colors.surface2,
          border: `1px solid ${colors.border}`,
          borderRadius: 20, padding: "3px 8px"
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: s.color,
            boxShadow: isLinked ? `0 0 6px ${chain.color}` : "none"
          }} />
          <span style={{ fontSize: 10, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>
            {s.label}
          </span>
        </div>
      </div>

      {/* Address */}
      {address && (
        <div style={{
          background: colors.surface2,
          border: `1px solid ${colors.border}`,
          borderRadius: 4, padding: "6px 10px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, color: colors.muted,
          wordBreak: "break-all"
        }}>
          {address}
        </div>
      )}

      {/* Tx hash */}
      {txHash && isLinked && (
        <div style={{ fontSize: 10, color: colors.muted }}>
          Approval tx: <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: colors.green
          }}>{String(txHash).slice(0, 20)}…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 10, color: colors.red,
          background: "#FF4D6D11",
          border: `1px solid #FF4D6D33`,
          borderRadius: 4, padding: "6px 10px"
        }}>
          {error}
        </div>
      )}

      {/* Action button */}
      {!isLinked ? (
        <button
          onClick={handleConnect}
          disabled={["detecting","connecting","approving","confirming"].includes(status)}
          style={{
            background:    chain.color + "22",
            border:        `1px solid ${chain.color}55`,
            borderRadius:  4,
            padding:       "8px 14px",
            color:         chain.color,
            fontSize:      11,
            fontWeight:    600,
            cursor:        status === "idle" || status === "error" ? "pointer" : "not-allowed",
            opacity:       ["detecting","connecting","approving","confirming"].includes(status) ? 0.6 : 1,
            transition:    "opacity 0.2s",
            fontFamily:    "'JetBrains Mono', monospace",
            letterSpacing: "0.04em"
          }}
        >
          {status === "idle" || status === "error"
            ? `Connect ${chain.label}`
            : s.label}
        </button>
      ) : (
        <button
          onClick={handleUnlink}
          style={{
            background:  "transparent",
            border:      `1px solid ${colors.border}`,
            borderRadius: 4,
            padding:     "8px 14px",
            color:       colors.muted,
            fontSize:    11,
            cursor:      "pointer",
            fontFamily:  "'JetBrains Mono', monospace"
          }}
        >
          Unlink wallet
        </button>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WalletConnect() {
  const workspaceId = useAuthStore(s => s.activeWorkspace?.id);
  const [linked, setLinked] = useState({});
  const [approvedByChain, setApprovedByChain] = useState({});

  // Fetch what's ACTUALLY delegate-approved server-side, once per mount.
  // delegate-status returns only wallets with delegateApproved=true, each
  // carrying its delegateChain (SPL/TRC20/ERC20) - exactly the key the
  // CHAINS config uses.
  useEffect(() => {
    if (!workspaceId) return;
    client.get("/wallets/delegate-status")
      .then(res => {
        const byChain = {};
        for (const w of res.data.data || []) {
          if (w.delegateChain) byChain[w.delegateChain] = w;
        }
        setApprovedByChain(byChain);
        // Seed the summary count from server truth too
        setLinked(prev => {
          const next = { ...prev };
          for (const [chainKey, w] of Object.entries(byChain)) {
            if (!next[chainKey]) next[chainKey] = { address: w.address, txHash: w.linkTxHash };
          }
          return next;
        });
      })
      .catch(() => {}); // non-fatal: cards just start at idle as before
  }, [workspaceId]);

  function handleLinked({ chain, address, txHash }) {
    setLinked(prev => ({ ...prev, [chain]: { address, txHash } }));
  }

  const linkedCount = Object.keys(linked).length;

  return (
    <div style={{
      minHeight:  "100vh",
      background: colors.bg,
      padding:    "40px 24px",
      maxWidth:   680,
      margin:     "0 auto"
    }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{
          fontSize: 10, color: colors.muted,
          textTransform: "uppercase", letterSpacing: "0.1em",
          marginBottom: 8
        }}>
          Wallet Setup
        </div>
        <h1 style={{
          fontSize: 22, fontWeight: 700,
          color: colors.text, margin: 0, marginBottom: 8
        }}>
          Connect Trading Wallets
        </h1>
        <p style={{ fontSize: 12, color: colors.muted, margin: 0, lineHeight: 1.6 }}>
          Each chain requires its own wallet. Connect the chains you want to trade.
          One approval grants QuantEdge permission to execute trades automatically.
        </p>
      </div>

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {CHAINS.map(chain => (
          <WalletCard
            key={chain.key}
            chain={chain}
            workspaceId={workspaceId}
            onLinked={handleLinked}
            approvedWallet={approvedByChain[chain.key] || null}
          />
        ))}
      </div>

      {/* Summary */}
      {linkedCount > 0 && (
        <div style={{
          marginTop: 24,
          background: colors.surface,
          border: `1px solid ${colors.green}33`,
          borderRadius: 8, padding: 16,
          display: "flex", alignItems: "center", gap: 10
        }}>
          <span style={{ color: colors.green, fontSize: 16 }}>✓</span>
          <div>
            <div style={{ fontSize: 12, color: colors.text, fontWeight: 600 }}>
              {linkedCount} wallet{linkedCount > 1 ? "s" : ""} linked
            </div>
            <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
              QuantEdge will trade automatically when signals fire.
            </div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div style={{
        marginTop: 24,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8, padding: 16
      }}>
        <div style={{
          fontSize: 10, color: colors.muted,
          textTransform: "uppercase", letterSpacing: "0.06em",
          marginBottom: 12
        }}>
          How it works
        </div>
        {[
          ["Connect",  "Your wallet signs a one-time approval transaction."],
          ["Delegate", "QuantEdge receives permission to move up to 10,000 USDT on your behalf."],
          ["Trade",    "When a signal fires, trades execute automatically — no manual action needed."],
          ["Revoke",   "Unlink at any time to cancel all permissions instantly."],
        ].map(([title, desc]) => (
          <div key={title} style={{
            display: "flex", gap: 12, alignItems: "flex-start",
            padding: "6px 0",
            borderBottom: `1px solid ${colors.border}`
          }}>
            <span style={{
              fontSize: 10, color: colors.violet,
              fontFamily: "'JetBrains Mono', monospace",
              minWidth: 52, paddingTop: 1
            }}>
              {title}
            </span>
            <span style={{ fontSize: 11, color: colors.muted, lineHeight: 1.5 }}>
              {desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
