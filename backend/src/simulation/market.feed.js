// Simulated market price feed.
// Generates realistic price movement using geometric Brownian motion.
// In production: replaced by Pyth / Bybit WebSocket feed.

const INITIAL_PRICES = { SOL: 142.30, BTC: 67240.00, ETH: 3482.10 };
const VOLATILITY    = { SOL: 0.0025,  BTC: 0.0015,   ETH: 0.002  }; // per 30s step
const DRIFT         = { SOL: 0.00002, BTC: 0.00001,   ETH: 0.00001 };

let currentPrices = { ...INITIAL_PRICES };

function nextPrice(symbol) {
  const sigma = VOLATILITY[symbol] || 0.002;
  const mu    = DRIFT[symbol]    || 0;
  const z     = randn();
  currentPrices[symbol] = currentPrices[symbol] * Math.exp(mu + sigma * z);
  return currentPrices[symbol];
}

function getPrices() {
  return { ...currentPrices };
}

function tickAllPrices() {
  for (const sym of Object.keys(currentPrices)) nextPrice(sym);
  return getPrices();
}

// Box-Muller normal sample
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

module.exports = { tickAllPrices, getPrices, nextPrice };
