import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import { clusterApiUrl } from "@solana/web3.js";

const PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID;

// ── EVM (Reown AppKit) ───────────────────────────────────────────────────────


let appKit = null;

// ── Solana wallets ───────────────────────────────────────────────────────────

const solanaWallets = [
  new PhantomWalletAdapter(),
  new WalletConnectWalletAdapter({
    network: "mainnet-beta",
    options: { projectId: PROJECT_ID },
  }),
];

// ── Context ──────────────────────────────────────────────────────────────────

const WalletCtx = createContext(null);

export function useWalletCtx() {
  return useContext(WalletCtx);
}

// ── Tron helpers ─────────────────────────────────────────────────────────────

function detectTron() {
  return typeof window !== "undefined" && typeof window.tronWeb !== "undefined" && window.tronWeb.ready;
}

async function getTronAddress() {
  if (!detectTron()) throw new Error("TronLink not detected");
  return window.tronWeb.defaultAddress.base58;
}

// ── Inner provider (has access to Solana wallet adapter) ─────────────────────

function InnerProvider({ children }) {
  const solana = useWallet();

  const [evm,  setEvm]  = useState({ address: null, connected: false });
  const [tron, setTron] = useState({ address: null, connected: false });

  // Listen for EVM connection events from AppKit (only after lazy init)
  useEffect(() => {
    if (!appKit) return;
    const unsub = appKit.subscribeAccount(account => {
      if (account?.address) {
        setEvm({ address: account.address, connected: true });
      } else {
        setEvm({ address: null, connected: false });
      }
    });
    return () => unsub?.();
  }, [evm.connected]);

  // Connect EVM via AppKit modal
  const connectEvm = useCallback(async () => {
    if (!appKit) {
      try {
        const { createAppKit } = await import("@reown/appkit");
        const { EthersAdapter } = await import("@reown/appkit-adapter-ethers");
        const { mainnet, sepolia } = await import("@reown/appkit/networks");
        const adapter = new EthersAdapter();
        appKit = createAppKit({
          adapters: [adapter],
          networks: [mainnet, sepolia],
          projectId: PROJECT_ID,
          metadata: { name: "QuantEdge", description: "Multi-chain algorithmic trading", url: window.location.origin, icons: [] },
          features: { analytics: false },
        });
      } catch(e) {
        throw new Error("Failed to initialize EVM wallet: " + e.message);
      }
    }
    await appKit.open();
  }, []);

  const disconnectEvm = useCallback(async () => {
    if (appKit) await appKit.disconnect();
    setEvm({ address: null, connected: false });
  }, []);

  // Connect Solana via Phantom or WalletConnect
  const connectSolana = useCallback(async () => {
    if (!solana.connected) await solana.connect();
  }, [solana]);

  const disconnectSolana = useCallback(async () => {
    await solana.disconnect();
  }, [solana]);

  // Connect Tron — desktop TronLink extension or mobile in-app browser
  const connectTron = useCallback(async () => {
    if (detectTron()) {
      const address = await getTronAddress();
      setTron({ address, connected: true });
      return address;
    }
    // Mobile fallback — TronLink deep link
    const deepLink = `tronlinkoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({
      url: window.location.href,
      action: "open",
      protocol: "tronlink",
      version: "1.0",
    }))}`;
    window.location.href = deepLink;
    // After return from TronLink app, retry detection
    setTimeout(() => {
      if (detectTron()) {
        getTronAddress().then(address => setTron({ address, connected: true })).catch(() => {});
      }
    }, 2000);
    throw new Error("Opening TronLink app… return here after connecting.");
  }, []);

  const disconnectTron = useCallback(() => {
    setTron({ address: null, connected: false });
  }, []);

  // Get signing functions for approval transactions
  const signEvm = useCallback(async (payload) => {
    const provider = appKit?.getProvider("eip155");
    if (!provider) throw new Error("EVM provider not connected");
    const { BrowserProvider } = await import("ethers");
    const ethProvider = new BrowserProvider(provider);
    const signer = await ethProvider.getSigner();
    return signer.sendTransaction({ to: payload.to, data: payload.data });
  }, []);

  const signSolana = useCallback(async (payload) => {
    if (!solana.signAndSendTransaction) throw new Error("Solana wallet not connected");
    const { Transaction, Connection } = await import("@solana/web3.js");
    // payload.transaction is base64 serialized tx from delegate server
    const txBuffer = Buffer.from(payload.transaction, "base64");
    const tx = Transaction.from(txBuffer);
    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
    const { signature } = await solana.sendTransaction(tx, connection);
    return signature;
  }, [solana]);

  const signTron = useCallback(async (payload) => {
    if (!detectTron()) throw new Error("TronLink not connected");
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
  }, []);

  const value = {
    evm:  { ...evm,  connect: connectEvm,  disconnect: disconnectEvm,  sign: signEvm  },
    sol:  { address: solana.publicKey?.toString(), connected: solana.connected, connect: connectSolana, disconnect: disconnectSolana, sign: signSolana },
    tron: { ...tron, connect: connectTron, disconnect: disconnectTron, sign: signTron },
    appKit,
  };

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

// ── Root provider ────────────────────────────────────────────────────────────

const SOLANA_RPC = clusterApiUrl("mainnet-beta");

export function WalletProvider({ children }) {
  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <SolanaWalletProvider wallets={solanaWallets} autoConnect={false}>
        <InnerProvider>{children}</InnerProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
