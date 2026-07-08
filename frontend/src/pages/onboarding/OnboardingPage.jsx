import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onboarding as onboardingApi } from "../../api/endpoints";
import useAuthStore from "../../store/auth.store";
import { colors } from "../../lib/tokens";
import { wallets as walletsApi } from "../../api/endpoints";
import { Transaction } from "@solana/web3.js";

// ── Design primitives ────────────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: colors.surface2, border: `1px solid ${colors.border2}`,
      borderRadius: 4, padding: "8px 10px", color: colors.text,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, width: "100%",
    }}>
      <option value="">Select…</option>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  );
}

function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{
      background: colors.surface2, border: `1px solid ${colors.border2}`,
      borderRadius: 4, padding: "8px 10px", color: colors.text,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, width: "100%",
      boxSizing: "border-box",
    }}/>
  );
}

function Checkbox({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: colors.green, width: 14, height: 14, flexShrink: 0 }}/>
      <span style={{ fontSize: 11, color: colors.text, lineHeight: 1.5 }}>{label}</span>
    </label>
  );
}

function PrimaryBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? colors.surface2 : colors.green,
      color: disabled ? colors.muted : colors.bg,
      border: "none", borderRadius: 4, padding: "10px 20px",
      fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
      fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
      letterSpacing: "0.04em",
    }}>
      {children}
    </button>
  );
}

function StageHeader({ stage, title, sub }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 9, color: colors.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
        Stage {stage} of 9
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: colors.text, margin: 0, marginBottom: 6 }}>{title}</h2>
      {sub && <p style={{ fontSize: 11, color: colors.muted, margin: 0, lineHeight: 1.6 }}>{sub}</p>}
    </div>
  );
}

function ProgressBar({ stage }) {
  const pct = ((stage - 3) / 6) * 100;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ background: colors.surface2, borderRadius: 2, height: 3 }}>
        <div style={{ background: colors.green, height: 3, borderRadius: 2, width: `${pct}%`, transition: "width 0.4s" }}/>
      </div>
    </div>
  );
}

// ── Stage 3 — Financial Suitability ─────────────────────────────────────────

function Stage3({ onNext }) {
  const [form, setForm] = useState({
    employmentStatus: "", incomeRange: "", netWorthRange: "",
    sourceOfFunds: "", yearsExperience: "", priorTrading: "",
    derivativesKnowledge: "", investmentObjectives: "",
  });
  const set = k => v => setForm(f => ({ ...f, [k]: v }));
  const valid = Object.values(form).every(v => v !== "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={3} title="Financial Suitability" sub="This information helps us ensure the platform is appropriate for your financial situation."/>
      <Field label="Employment Status">
        <Select value={form.employmentStatus} onChange={set("employmentStatus")} options={["Employed","Self-employed","Business owner","Retired","Student","Unemployed"]}/>
      </Field>
      <Field label="Annual Income Range">
        <Select value={form.incomeRange} onChange={set("incomeRange")} options={["Under $25,000","$25,000–$50,000","$50,000–$100,000","$100,000–$250,000","Over $250,000"]}/>
      </Field>
      <Field label="Net Worth Range">
        <Select value={form.netWorthRange} onChange={set("netWorthRange")} options={["Under $50,000","$50,000–$250,000","$250,000–$1,000,000","Over $1,000,000"]}/>
      </Field>
      <Field label="Source of Funds">
        <Select value={form.sourceOfFunds} onChange={set("sourceOfFunds")} options={["Employment income","Business income","Investments","Inheritance","Savings","Other"]}/>
      </Field>
      <Field label="Years of Investment Experience">
        <Select value={form.yearsExperience} onChange={set("yearsExperience")} options={["None","Less than 1 year","1–3 years","3–5 years","Over 5 years"]}/>
      </Field>
      <Field label="Prior Trading Experience">
        <Select value={form.priorTrading} onChange={set("priorTrading")} options={["None","Stocks only","Forex","Crypto spot","Crypto derivatives","Multiple asset classes"]}/>
      </Field>
      <Field label="Knowledge of Derivatives and Leverage">
        <Select value={form.derivativesKnowledge} onChange={set("derivativesKnowledge")} options={["None","Basic","Intermediate","Advanced"]}/>
      </Field>
      <Field label="Investment Objectives">
        <Select value={form.investmentObjectives} onChange={set("investmentObjectives")} options={["Capital preservation","Income generation","Balanced growth","Aggressive growth","Speculation"]}/>
      </Field>
      <PrimaryBtn onClick={() => onNext(form)} disabled={!valid}>Continue</PrimaryBtn>
    </div>
  );
}

// ── Stage 4 — IPS ────────────────────────────────────────────────────────────

function Stage4({ onNext }) {
  const [form, setForm] = useState({
    riskTolerance: "", maxDrawdown: "", timeHorizon: "",
    liquidityNeeds: "", preference: "",
  });
  const set = k => v => setForm(f => ({ ...f, [k]: v }));
  const valid = Object.values(form).every(v => v !== "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={4} title="Investment Policy Statement" sub="Your preferences configure how QuantEdge manages your capital."/>
      <Field label="Risk Tolerance">
        <Select value={form.riskTolerance} onChange={set("riskTolerance")} options={["Low","Medium","High"]}/>
      </Field>
      <Field label="Maximum Acceptable Drawdown">
        <Select value={form.maxDrawdown} onChange={set("maxDrawdown")} options={["5%","10%","15%","20%","25%","30%+"]}/>
      </Field>
      <Field label="Investment Time Horizon">
        <Select value={form.timeHorizon} onChange={set("timeHorizon")} options={["Under 6 months","6–12 months","1–3 years","3–5 years","Over 5 years"]}/>
      </Field>
      <Field label="Liquidity Needs">
        <Select value={form.liquidityNeeds} onChange={set("liquidityNeeds")} options={["May need funds within 30 days","Within 6 months","Within 1 year","No near-term liquidity needs"]}/>
      </Field>
      <Field label="Capital Preference">
        <Select value={form.preference} onChange={set("preference")} options={["Strongly preserve capital","Balanced","Prioritise growth","Aggressive growth"]}/>
      </Field>
      <PrimaryBtn onClick={() => onNext(form)} disabled={!valid}>Continue</PrimaryBtn>
    </div>
  );
}

// ── Stage 5 — Suitability Assessment ────────────────────────────────────────

function Stage5({ stageData, onNext }) {
  const ips  = stageData?.stage4 || {};
  const suit = stageData?.stage3 || {};

  // Simple scoring
  const score = (() => {
    let s = 0;
    if (ips.riskTolerance === "High") s += 3;
    else if (ips.riskTolerance === "Medium") s += 2;
    else s += 1;
    if (["3–5 years","Over 5 years"].includes(ips.timeHorizon)) s += 2;
    else if (ips.timeHorizon === "1–3 years") s += 1;
    if (["Advanced","Intermediate"].includes(suit.derivativesKnowledge)) s += 2;
    else if (suit.derivativesKnowledge === "Basic") s += 1;
    if (["Over 5 years","3–5 years"].includes(suit.yearsExperience)) s += 2;
    else if (suit.yearsExperience === "1–3 years") s += 1;
    return s;
  })();

  const profile = score >= 7 ? "Aggressive" : score >= 4 ? "Moderate" : "Conservative";

  const profiles = {
    Conservative: { color: colors.green,  desc: "Lower leverage, tighter drawdown limits, restricted strategy set. Optimised for capital preservation." },
    Moderate:     { color: colors.violet, desc: "Standard platform defaults with full strategy access. Balanced risk-reward profile." },
    Aggressive:   { color: colors.orange, desc: "Full platform access with wider risk parameter range. Suitable for experienced traders." },
  };

  const p = profiles[profile];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={5} title="Suitability Assessment" sub="Based on your responses, we have assigned you a risk profile."/>
      <div style={{ background: colors.surface2, border: `1px solid ${p.color}44`, borderRadius: 8, padding: 20 }}>
        <div style={{ fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Assigned Profile</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: p.color, marginBottom: 10 }}>{profile}</div>
        <p style={{ fontSize: 11, color: colors.muted, margin: 0, lineHeight: 1.6 }}>{p.desc}</p>
      </div>
      <p style={{ fontSize: 10, color: colors.muted, margin: 0 }}>
        If you believe this profile does not reflect your situation, contact support to request a manual review.
      </p>
      <PrimaryBtn onClick={() => onNext({ profile, score })}>Accept Profile</PrimaryBtn>
    </div>
  );
}

// ── Stage 6 — Risk Disclosures ───────────────────────────────────────────────

const DISCLOSURES = [
  { key: "market",    label: "Market Risk",           desc: "The value of assets can decrease due to market conditions beyond the platform's control." },
  { key: "volatility",label: "Volatility Risk",       desc: "Cryptocurrency markets can experience rapid and significant price movements." },
  { key: "liquidity", label: "Liquidity Risk",        desc: "There may be periods where positions cannot be exited at expected prices." },
  { key: "technology",label: "Technology Risk",       desc: "System outages, network failures, or smart contract vulnerabilities may affect trading." },
  { key: "delegated", label: "Delegated Trading Risk",desc: "You are authorising QuantEdge to execute trades on your behalf within defined limits." },
];

function Stage6({ onNext }) {
  const [checked, setChecked] = useState({});
  const allChecked = DISCLOSURES.every(d => checked[d.key]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={6} title="Risk Disclosures" sub="You must individually acknowledge each risk before proceeding."/>
      {DISCLOSURES.map(d => (
        <div key={d.key} style={{ background: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, marginBottom: 6 }}>{d.label}</div>
          <div style={{ fontSize: 10, color: colors.muted, marginBottom: 10, lineHeight: 1.5 }}>{d.desc}</div>
          <Checkbox
            checked={!!checked[d.key]}
            onChange={v => setChecked(c => ({ ...c, [d.key]: v }))}
            label={`I acknowledge and understand ${d.label}`}
          />
        </div>
      ))}
      <PrimaryBtn onClick={() => onNext({ disclosures: checked, signedAt: new Date().toISOString() })} disabled={!allChecked}>
        Acknowledge All & Continue
      </PrimaryBtn>
    </div>
  );
}

// ── Stage 7 — Knowledge Check ────────────────────────────────────────────────

const QUESTIONS = [
  {
    q: "What does a stop loss order do?",
    options: ["Increases leverage automatically","Closes a position when it reaches a specified loss level","Adds more capital to a losing trade","Pauses trading during volatility"],
    correct: 1,
  },
  {
    q: "If you use 10x leverage and the asset drops 10%, what happens to your position?",
    options: ["You lose 10% of your capital","You lose 100% of your position","You gain 10%","Nothing — leverage only applies to profits"],
    correct: 1,
  },
  {
    q: "What is a drawdown?",
    options: ["A withdrawal of funds","The peak-to-trough decline in portfolio value","A type of trading order","The spread between bid and ask"],
    correct: 1,
  },
  {
    q: "What does delegated trading mean on this platform?",
    options: ["You must manually approve every trade","QuantEdge can execute trades on your behalf within your approved limits","Your funds are transferred to QuantEdge","You share your private key"],
    correct: 1,
  },
  {
    q: "What happens when your portfolio breaches a risk limit?",
    options: ["Trading continues unchanged","You are charged a penalty fee","Open positions are closed and trading is paused","Your account is deleted"],
    correct: 2,
  },
];

function Stage7({ onNext }) {
  const [answers, setAnswers]     = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [cooldown, setCooldown]   = useState(false);
  const [retried, setRetried]     = useState(false);

  const allAnswered = QUESTIONS.every((_, i) => answers[i] != null);
  const score = QUESTIONS.filter((q, i) => answers[i] === q.correct).length;
  const passed = score >= 4;

  function handleSubmit() {
    setSubmitted(true);
    if (!passed && !retried) {
      setCooldown(true);
      setTimeout(() => setCooldown(false), 10 * 60 * 1000); // 10 min
    }
  }

  function handleRetry() {
    setAnswers({});
    setSubmitted(false);
    setRetried(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={7} title="Trading Knowledge Check" sub="Answer 4 of 5 questions correctly to proceed. One retry permitted."/>
      {QUESTIONS.map((q, i) => (
        <div key={i} style={{ background: colors.surface2, border: `1px solid ${submitted ? (answers[i] === q.correct ? colors.green + "44" : colors.red + "44") : colors.border}`, borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.text, marginBottom: 10 }}>{i + 1}. {q.q}</div>
          {q.options.map((opt, j) => (
            <label key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: submitted ? "default" : "pointer" }}>
              <input type="radio" name={`q${i}`} disabled={submitted}
                checked={answers[i] === j}
                onChange={() => setAnswers(a => ({ ...a, [i]: j }))}
                style={{ accentColor: colors.green }}
              />
              <span style={{
                fontSize: 11, color: submitted && j === q.correct ? colors.green : submitted && answers[i] === j ? colors.red : colors.muted,
              }}>{opt}</span>
            </label>
          ))}
        </div>
      ))}

      {!submitted && (
        <PrimaryBtn onClick={handleSubmit} disabled={!allAnswered}>Submit Answers</PrimaryBtn>
      )}

      {submitted && (
        <div style={{ background: passed ? colors.green + "11" : colors.red + "11", border: `1px solid ${passed ? colors.green : colors.red}33`, borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: passed ? colors.green : colors.red, marginBottom: 6 }}>
            {passed ? `Passed — ${score}/5 correct` : `Failed — ${score}/5 correct (need 4)`}
          </div>
          {passed && <PrimaryBtn onClick={() => onNext({ score, passed: true, answeredAt: new Date().toISOString() })}>Continue</PrimaryBtn>}
          {!passed && !retried && !cooldown && <PrimaryBtn onClick={handleRetry}>Retry</PrimaryBtn>}
          {!passed && cooldown && <div style={{ fontSize: 10, color: colors.muted }}>Retry available after 10-minute cooldown.</div>}
          {!passed && retried && <div style={{ fontSize: 10, color: colors.red }}>Maximum retries reached. Contact support.</div>}
        </div>
      )}
    </div>
  );
}

// ── Stage 8 — Capital Allocation ─────────────────────────────────────────────

function Stage8({ stageData, onNext }) {
  const profile = stageData?.stage5?.profile || "Moderate";
  const maxDrawdownStr = stageData?.stage4?.maxDrawdown || "10%";
  const maxDrawdown = parseFloat(maxDrawdownStr) || 10;

  const defaults = {
    Conservative: { amount: 1000, maxPositionPct: 10, stopLossPct: 5,  maxDrawdownPct: 10, signalStrengthThreshold: 0.7 },
    Moderate:     { amount: 5000, maxPositionPct: 20, stopLossPct: 10, maxDrawdownPct: maxDrawdown, signalStrengthThreshold: 0.5 },
    Aggressive:   { amount: 10000,maxPositionPct: 30, stopLossPct: 15, maxDrawdownPct: maxDrawdown, signalStrengthThreshold: 0.3 },
  };

  const [form, setForm] = useState(defaults[profile] || defaults.Moderate);
  const set = k => v => setForm(f => ({ ...f, [k]: parseFloat(v) || 0 }));
  const valid = form.amount > 0 && form.maxPositionPct > 0 && form.stopLossPct > 0;

  const fields = [
    { key: "amount",                   label: "Investment Amount (USDT)",     suffix: "USDT", min: 100,  max: 100000, step: 100  },
    { key: "maxPositionPct",           label: "Max Position Size",            suffix: "%",    min: 1,    max: 50,     step: 1    },
    { key: "stopLossPct",             label: "Stop Loss",                    suffix: "%",    min: 1,    max: 30,     step: 0.5  },
    { key: "maxDrawdownPct",          label: "Max Drawdown Halt",            suffix: "%",    min: 1,    max: 50,     step: 1    },
    { key: "signalStrengthThreshold", label: "Signal Strength Floor",        suffix: "",     min: 0.1,  max: 1,      step: 0.05 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={8} title="Capital Allocation" sub={`Pre-populated from your ${profile} risk profile. Adjust within permitted bounds.`}/>
      {fields.map(({ key, label, suffix, min, max, step }) => (
        <Field key={key} label={`${label}${suffix ? ` (${suffix})` : ""}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="range" min={min} max={max} step={step} value={form[key]}
              onChange={e => set(key)(e.target.value)}
              style={{ flex: 1, accentColor: colors.green }}
            />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: colors.text, minWidth: 60, textAlign: "right" }}>
              {form[key]}{suffix}
            </span>
          </div>
        </Field>
      ))}
      <PrimaryBtn onClick={() => onNext(form)} disabled={!valid}>Confirm Allocation</PrimaryBtn>
    </div>
  );
}

// Stage 9 - Wallet


const CHAIN_DEFS = [
  // PAUSED: Ethereum disabled pending wallet network-switch UX decision (Sepolia testnet warning shown by Phantom).
  // Re-enable by uncommenting once resolved. See Session handover notes.
  // { key: "ERC20", label: "Ethereum", sub: "Phantom Wallet", color: "#627EEA", icon: "⬡" },
  { key: "SPL",   label: "Solana",   sub: "Phantom / WalletConnect",  color: "#9945FF", icon: "◎" },
  { key: "TRC20", label: "Tron",     sub: "TronLink",                 color: "#FF060A", icon: "◈" },
];

function Stage9({ onNext }) {
  const [linked,  setLinked]  = useState({});
  const [errors,  setErrors]  = useState({});
  const [loading, setLoading] = useState({});
  const [providerTick, setProviderTick] = useState(0); // forces re-render as wallet providers inject
  const hasLinked = Object.keys(linked).length > 0;

  // On mount — check DB for already-linked wallets and pre-populate
  useEffect(() => {
    walletsApi.list().then(res => {
      const wallets = res.data.data || [];
      const alreadyLinked = {};
      for (const w of wallets) {
        if (!w.delegateApproved) continue;
        const key = w.delegateChain;
        if (key) alreadyLinked[key] = { address: w.address, txHash: w.linkTxHash };
      }
      if (Object.keys(alreadyLinked).length > 0) setLinked(alreadyLinked);
    }).catch(() => {});
  }, []);

  // Wallet providers (window.phantom, window.solana, window.tronWeb) can
  // inject moments AFTER this component's first render, especially inside
  // in-app browsers. Without this, the Connect/Open button label can show
  // a stale "Open in X" (deep-link) even though the provider becomes
  // available a moment later, before the user actually clicks. Poll briefly
  // on mount and force a re-render as soon as any provider shows up.
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 15; // ~3s at 200ms intervals
    const interval = setInterval(() => {
      attempts++;
      const anyProvider = !!(window.phantom?.ethereum || window.solana?.isPhantom || window.tronWeb);
      if (anyProvider || attempts >= maxAttempts) {
        setProviderTick(t => t + 1);
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const QUANTEDGE_NETWORK_PARAMS = {
    chainId: "0xaa36a7",
    chainName: "QuantEdge Network",
    nativeCurrency: { name: "QuantEdge ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://eth-sepolia.g.alchemy.com/v2/XT1Ck3M2LrfZQ0LUtKGm3"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  };

  async function ensureCorrectEvmChain(provider) {
    const currentChainId = await provider.request({ method: "eth_chainId" });
    if (currentChainId === QUANTEDGE_NETWORK_PARAMS.chainId) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: QUANTEDGE_NETWORK_PARAMS.chainId }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [QUANTEDGE_NETWORK_PARAMS],
        });
      } else {
        throw switchError;
      }
    }
  }

  async function connectEVM() {
    if (window.phantom?.ethereum) {
      const accounts = await window.phantom.ethereum.request({ method: "eth_requestAccounts" });
      await ensureCorrectEvmChain(window.phantom.ethereum);
      return accounts[0];
    }
    window.location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href) + "?ref=" + encodeURIComponent(window.location.href);
    return "__DEEPLINK__";
  }

  async function connectSolana() {
    if (window.solana?.isPhantom) {
      const resp = await window.solana.connect();
      return resp.publicKey.toString();
    }
    const url = encodeURIComponent(window.location.href);
    window.location.href = "https://phantom.app/ul/browse/" + url + "?ref=" + url;
    return "__DEEPLINK__";
  }

  async function connectTron() {
    // Wait up to 4s for tronWeb to be injected and ready
    for (let i = 0; i < 20; i++) {
      if (window.tronWeb?.ready && window.tronWeb?.defaultAddress?.base58) {
        return window.tronWeb.defaultAddress.base58;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    if (window.tronWeb) {
      // tronWeb exists but not ready - show state
      throw new Error("TronLink not ready. Please ensure you are logged in to TronLink. State: ready=" + window.tronWeb.ready + " address=" + (window.tronWeb.defaultAddress?.base58 || "none"));
    }
    // No tronWeb - deep link to TronLink app
    window.location.href = "tronlinkoutside://pull.activity?param=" + encodeURIComponent(JSON.stringify({ url: window.location.href, action: "open", protocol: "tronlink", version: "1.0" }));
    throw new Error("Opening TronLink app... please return to this page after connecting.");
  }

  async function signEVM(address, payload) {
    await ensureCorrectEvmChain(window.phantom.ethereum);
    return window.phantom.ethereum.request({ method: "eth_sendTransaction", params: [{ from: address, to: payload.to, data: payload.data }] });
  }

  async function signSolana(payload) {
    if (!payload.transaction) return "verified";
    const txBytes = Uint8Array.from(atob(payload.transaction), c => c.charCodeAt(0));
    const tx = Transaction.from(txBytes);
    const result = await window.solana.signAndSendTransaction(tx);
    return result.signature;
  }

  async function signTron(payload) {
    if (!payload.contractAddress) return "verified";
    const tx = await window.tronWeb.transactionBuilder.triggerSmartContract(payload.contractAddress, payload.functionSelector, { feeLimit: 100_000_000 }, payload.parameters, window.tronWeb.defaultAddress.hex);
    const signed = await window.tronWeb.trx.sign(tx.transaction);
    const result = await window.tronWeb.trx.sendRawTransaction(signed);
    return result.txid;
  }

  // Retries linkConfirm with backoff — real-chain confirmation times vary
  // (Sepolia routinely takes >2s), and the backend independently verifies
  // real on-chain allowance before approving (see C4), so retrying here is
  // safe: each attempt either succeeds once the tx is truly confirmed, or
  // fails cleanly and we try again, never trusting an unconfirmed tx.
  async function linkConfirmWithRetry(walletId, txHash, maxAttempts = 9) {
    const delays = [2000, 3000, 5000, 8000, 8000, 10000, 10000, 10000, 10000]; // ~66s total
    // Extended window: public devnet/testnet RPCs are load-balanced across
    // nodes with eventual consistency — a node can briefly report stale
    // (zero) state right after a real, confirmed approval. Observed directly
    // in testing: allowance read 0 immediately post-confirm, then correctly
    // read 10000 on a later query with no code change in between.
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, delays[attempt] || 8000));
      try {
        return await walletsApi.linkConfirm(walletId, txHash);
      } catch (e) {
        lastError = e;
        const code = e.response?.data?.error?.code;
        // Only retry the specific "not confirmed yet" case — any other
        // error (network down, wallet not found, etc.) should surface
        // immediately rather than retrying blindly.
        if (code !== "DELEGATE_NOT_APPROVED" && code !== "DELEGATE_STATUS_UNAVAILABLE") {
          throw e;
        }
      }
    }
    throw lastError;
  }

  async function handleConnect(chain) {
    setErrors(e  => ({ ...e, [chain.key]: null }));
    setLoading(l => ({ ...l, [chain.key]: true }));
    try {
      let address;
      if (chain.key === "ERC20") address = await connectEVM();
      else if (chain.key === "SPL") address = await connectSolana();
      else address = await connectTron();

      if (address === "__DEEPLINK__") {
        setErrors(er => ({ ...er, [chain.key]: "Opening wallet app... Return here after connecting and tap Connect again." }));
        return;
      }

      const walletsRes = await walletsApi.list();
      const existing = walletsRes.data.data?.find(w => w.address?.toLowerCase() === address?.toLowerCase());
      let walletId;
      if (existing) {
        walletId = existing.id;
      } else {
        // Look up chain UUID from backend
        const chainType = chain.key === "SPL" ? "SOLANA" : chain.key === "ERC20" ? "EVM" : "TRON";
        const chainsRes = await fetch("/api/v1/chains", { headers: { "x-workspace-id": localStorage.getItem("qe_workspace_id"), "Authorization": "Bearer " + localStorage.getItem("qe_access_token") } });
        const chainsData = await chainsRes.json();
        const dbChain = chainsData.data?.find(c => c.type === chainType);
        if (!dbChain) throw new Error("Chain not configured: " + chainType);
        const walletRes = await walletsApi.create({ label: chain.label + " Wallet", address, chainId: dbChain.id, provider: chain.key === "SPL" ? "PHANTOM" : chain.key === "ERC20" ? "METAMASK" : "TRONLINK" });
        walletId = walletRes.data.data.id;
      }

      const payloadRes = await walletsApi.linkPayload([walletId], 10000);
      const payload = payloadRes.data.data?.payloads?.[chain.key];
      let txHash = "verified";
      if (payload) {
        if (chain.key === "ERC20") txHash = await signEVM(address, payload);
        else if (chain.key === "SPL") txHash = await signSolana(payload);
        else txHash = await signTron(payload);
        const confirmTxHash = typeof txHash === "object" ? txHash.hash || "confirmed" : txHash;
        await linkConfirmWithRetry(walletId, confirmTxHash);
      }
      setLinked(l => ({ ...l, [chain.key]: { address, txHash } }));
    } catch (e) {
      if (e.message === "DEEPLINK_TRIGGERED") {
        // User was redirected to wallet app - clear loading, show retry message
        setErrors(er => ({ ...er, [chain.key]: "Opening wallet app... Return here after connecting and tap Connect again." }));
      } else if (e.code === 4001 || e.message?.includes("reject") || e.message?.includes("cancel") || e.message?.includes("denied")) {
        // User rejected in wallet
        setErrors(er => ({ ...er, [chain.key]: "Connection rejected. Tap Connect to try again." }));
      } else {
        // Backend error shape is {success:false, error:{code, message}} —
        // read the nested message, not the error object itself.
        const msg = e.response?.data?.error?.message || e.message || "Connection failed";
        setErrors(er => ({ ...er, [chain.key]: msg }));
      }
    } finally {
      setLoading(l => ({ ...l, [chain.key]: false }));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StageHeader stage={9} title="Wallet Connection" sub="Connect the wallets you want to trade with. QuantEdge will receive a spending approval up to your capital allocation amount."/>
      {CHAIN_DEFS.map(chain => {
        const isLinked  = !!linked[chain.key];
        const isLoading = !!loading[chain.key];
        return (
          <div key={chain.key} style={{ background: colors.surface2, border: `1px solid ${isLinked ? chain.color + "55" : colors.border}`, borderRadius: 8, padding: 16, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: isLinked ? chain.color : "transparent" }}/>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20, color: chain.color }}>{chain.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{chain.label}</div>
                  <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{chain.sub}</div>
                </div>
              </div>
              {isLinked
                ? <span style={{ fontSize: 10, color: colors.green, fontFamily: "'JetBrains Mono', monospace" }}>Connected</span>
                : <button onClick={() => handleConnect(chain)} disabled={isLoading} style={{ background: chain.color + "22", border: `1px solid ${chain.color}55`, borderRadius: 4, padding: "6px 12px", color: chain.color, fontSize: 10, fontWeight: 600, cursor: isLoading ? "not-allowed" : "pointer", fontFamily: "'JetBrains Mono', monospace" }}>
                    {isLoading ? "Connecting..." :
                      chain.key === "ERC20" ? (window.phantom?.ethereum ? "Connect Phantom" : "Open in Phantom") :
                      chain.key === "SPL"   ? (window.solana?.isPhantom ? "Connect Phantom" : "Open in Phantom") :
                      "Connect TronLink"}
                  </button>
              }
            </div>
            {linked[chain.key]?.address && <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: colors.muted }}>{linked[chain.key].address}</div>}
            {errors[chain.key] && <div style={{ marginTop: 8, fontSize: 10, color: colors.red }}>{errors[chain.key]}</div>}
          </div>
        );
      })}
      <PrimaryBtn onClick={() => onNext({ wallets: linked })} disabled={!hasLinked}>Complete Setup</PrimaryBtn>
      <button onClick={() => onNext({ wallets: {}, skipped: true })} style={{ background: "transparent", border: "none", color: colors.muted, fontSize: 10, cursor: "pointer", marginTop: 4, textDecoration: "underline" }}>Skip - connect wallet later</button>
    </div>
  );
}

// ── Main orchestrator ────────────────────────────────────────────────────────

const STAGES = [3, 4, 5, 6, 7, 8, 9];

export default function OnboardingPage() {
  const [stage, setStage]       = useState(3);
  const [stageData, setStageData] = useState({});
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const { activeWorkspace, setWorkspace } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    onboardingApi.get().then(res => {
      const state = res.data.data;
      if (state.complete) { navigate("/dashboard", { replace: true }); return; }
      setStage(state.stage || 3);
      setStageData(state.data || {});
    }).catch(() => {});
  }, []);

  async function handleNext(n, data) {
    setSaving(true);
    setError(null);
    try {
      await onboardingApi.saveStage(n, data);
      setStageData(prev => ({ ...prev, [`stage${n}`]: data }));
      if (n === 9) {
        // Update local workspace settings so RouteGuard unblocks
        if (activeWorkspace) {
          setWorkspace({
            ...activeWorkspace,
            settings: { ...(activeWorkspace.settings || {}), onboarding: { complete: true, stage: 9, data: {} } },
          });
        }
        navigate("/dashboard", { replace: true });
      } else {
        setStage(n + 1);
      }
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const stageProps = { onNext: (data) => handleNext(stage, data), stageData };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, padding: "40px 24px", maxWidth: 620, margin: "0 auto" }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
        <div style={{ width: 20, height: 20, background: colors.green, clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)" }}/>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, letterSpacing: "0.08em" }}>QuantEdge</span>
      </div>

      <ProgressBar stage={stage}/>

      {error && (
        <div style={{ background: colors.red + "11", border: `1px solid ${colors.red}33`, borderRadius: 4, padding: "8px 12px", fontSize: 10, color: colors.red, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {saving && (
        <div style={{ fontSize: 10, color: colors.muted, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>Saving…</div>
      )}

      {stage === 3 && <Stage3 {...stageProps}/>}
      {stage === 4 && <Stage4 {...stageProps}/>}
      {stage === 5 && <Stage5 {...stageProps}/>}
      {stage === 6 && <Stage6 {...stageProps}/>}
      {stage === 7 && <Stage7 {...stageProps}/>}
      {stage === 8 && <Stage8 {...stageProps}/>}
      {stage === 9 && <Stage9 {...stageProps}/>}
    </div>
  );
}
