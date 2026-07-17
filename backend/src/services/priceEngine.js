/**
 * priceEngine.js
 *
 * Tick probabilities (per 2s tick):
 *   85% — normal move ±1-5%
 *    8% — mini pump +10-25%
 *    5% — mini dump -10-20%
 *    1% — mega pump +50-200%
 *  0.5-1% — rug pull -80-99% → delete
 *
 * Age-based rug multiplier:
 *   < 5 min  → × 0.2  (honeymoon protection)
 *   5-20 min → × 1.0  (normal)
 *   > 20 min → × (1.0 + 0.1 × extra_minutes)  (ticking time bomb)
 */

const prisma = require('../lib/prisma');

const MAX_CANDLES          = 500;
const TICK_MS              = 2000;
const RUG_THRESHOLD        = 0.0000001;
const TOTAL_SUPPLY         = 1_000_000_000;
const MIGRATION_THRESHOLD  = 30_000; // $30K market cap

// Base rug probability range per tick (0.5%–1%)
const RUG_PROB_MIN = 0.005;
const RUG_PROB_MAX = 0.010;

// ── In-memory state ────────────────────────────────────────────────────────────
// coinId → { price, rugProbability, createdAt, history[] }
const state = {};

let io        = null;
let interval  = null;
let initialized = false;

// ── Helpers ────────────────────────────────────────────────────────────────────

function _ageRugMultiplier(createdAt) {
  const ageMs  = Date.now() - new Date(createdAt).getTime();
  const ageMin = ageMs / 60_000;

  if (ageMin < 5)  return 0.2;               // honeymoon — very unlikely
  if (ageMin <= 20) return 1.0;              // normal window
  const extraMin = ageMin - 20;
  return 1.0 + 0.1 * extraMin;              // ticking time bomb
}

function _nextPrice(current, baseRugProb, createdAt) {
  const multiplier   = _ageRugMultiplier(createdAt);
  const effectiveRug = Math.min(baseRugProb * multiplier, 0.50); // cap at 50%

  const roll = Math.random();

  // ── Rug pull: 0.5-1% base, scaled by age ─────────────────────────────────
  if (roll < effectiveRug) {
    const drop = 0.80 + Math.random() * 0.19; // -80% to -99%
    return Math.max(current * (1 - drop), 1e-14);
  }

  // ── Mega pump: 1% ─────────────────────────────────────────────────────────
  if (roll < effectiveRug + 0.01) {
    const pump = 0.50 + Math.random() * 1.50; // +50% to +200%
    return current * (1 + pump);
  }

  // ── Mini pump: 8% ─────────────────────────────────────────────────────────
  if (roll < effectiveRug + 0.01 + 0.08) {
    const pump = 0.10 + Math.random() * 0.15; // +10% to +25%
    return current * (1 + pump);
  }

  // ── Mini dump: 5% ─────────────────────────────────────────────────────────
  if (roll < effectiveRug + 0.01 + 0.08 + 0.05) {
    const dump = 0.10 + Math.random() * 0.10; // -10% to -20%
    return Math.max(current * (1 - dump), 1e-14);
  }

  // ── Normal move: ~85% ─────────────────────────────────────────────────────
  const pct    = 0.01 + Math.random() * 0.04; // 1-5%
  const dir    = Math.random() < 0.5 ? 1 : -1;
  return Math.max(current * (1 + dir * pct), 1e-14);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

function _bootstrap(coin) {
  let p       = coin.currentPrice;
  const history = [];
  const now     = Date.now();

  for (let i = 100; i >= 1; i--) {
    const open   = p;
    const change = (Math.random() - 0.48) * 0.04;
    p            = Math.max(p * (1 + change), 1e-14);
    history.push({
      time:   Math.floor((now - i * TICK_MS) / 1000),
      open,
      high:   Math.max(open, p) * (1 + Math.random() * 0.01),
      low:    Math.min(open, p) * (1 - Math.random() * 0.01),
      close:  p,
      volume: Math.random() * 1000,
    });
  }

  // Each coin gets its own base rug probability in [RUG_PROB_MIN, RUG_PROB_MAX]
  const baseRugProb = coin.rugProbability ??
    (RUG_PROB_MIN + Math.random() * (RUG_PROB_MAX - RUG_PROB_MIN));

  state[coin.id] = {
    price:         p,
    baseRugProb,
    createdAt:     coin.createdAt ?? new Date(),
    history,
    migrated:      coin.migrated ?? false,
    name:          coin.name,
    ticker:        coin.ticker,
  };
}

async function init() {
  const coins = await prisma.coin.findMany({ where: { isActive: true } });
  for (const coin of coins) {
    _bootstrap(coin);
    // Override the randomly-walked price back to actual DB price (same as registerCoin does)
    state[coin.id].price     = coin.currentPrice;
    state[coin.id].createdAt = coin.createdAt ?? new Date();
    state[coin.id].migrated  = coin.migrated ?? false;
  }
  initialized = true;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Called by tokenGenerator immediately after DB insert. */
function registerCoin(coin) {
  if (state[coin.id]) return;
  _bootstrap(coin);
  // Override with the exact starting price from DB
  state[coin.id].price     = coin.currentPrice;
  state[coin.id].createdAt = coin.createdAt ?? new Date();
  state[coin.id].migrated  = coin.migrated ?? false;
  state[coin.id].name      = coin.name;
  state[coin.id].ticker    = coin.ticker;
}

function removeCoin(coinId) {
  delete state[coinId];
}

function getCurrentPrice(coinId) {
  return state[coinId]?.price ?? null;
}

function getHistory(coinId) {
  return state[coinId]?.history ?? [];
}

function getAllPrices() {
  return Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.price]));
}

function getIo() { return io; }

// ── Rug execution ──────────────────────────────────────────────────────────────

async function _rugCoin(coinId, finalPrice) {
  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) { removeCoin(coinId); return; }

    console.log(`💀 RUG PULL: ${coin.name} (${coin.ticker}) — final price $${finalPrice.toExponential(3)}`);

    // Soft-mark first so HTTP routes stop serving it
    await prisma.coin.update({ where: { id: coinId }, data: { isActive: false } });

    // Emit before deleting so clients can react
    if (io) {
      io.emit('coin_deleted', {
        coinId,
        name:       coin.name,
        ticker:     coin.ticker,
        finalPrice,
      });
    }

    // Remove from engine state immediately
    removeCoin(coinId);

    // Hard delete — cascade order matters (FK constraints)
    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { coinId } }),
      prisma.holding.deleteMany({ where: { coinId } }),
      prisma.coin.delete({ where: { id: coinId } }),
    ]);

  } catch (err) {
    console.error(`Error rugging coin ${coinId}:`, err.message);
    removeCoin(coinId);
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────────

async function tick() {
  if (!initialized) return;

  const updates  = {};
  const rugged   = [];
  const nowSec   = Math.floor(Date.now() / 1000);

  for (const [coinId, s] of Object.entries(state)) {
    const prev = s.price;
    const next = _nextPrice(prev, s.baseRugProb, s.createdAt);
    s.price    = next;

    // ── Candle ──
    const candles    = s.history;
    const lastCandle = candles[candles.length - 1];

    if (lastCandle && lastCandle.time === nowSec) {
      lastCandle.high   = Math.max(lastCandle.high, next);
      lastCandle.low    = Math.min(lastCandle.low, next);
      lastCandle.close  = next;
      lastCandle.volume += Math.random() * 100;
    } else {
      candles.push({
        time:   nowSec,
        open:   prev,
        high:   Math.max(prev, next),
        low:    Math.min(prev, next),
        close:  next,
        volume: Math.random() * 100,
      });
      if (candles.length > MAX_CANDLES) candles.shift();
    }

    const marketCap = next * TOTAL_SUPPLY;
    updates[coinId] = { id: coinId, price: next, marketCap, candle: candles[candles.length - 1] };

    // Check migration threshold
    if (!s.migrated && marketCap >= MIGRATION_THRESHOLD) {
      s.migrated = true;
      const migratedAt = new Date();
      const { name, ticker } = s;
      // Persist to DB (fire-and-forget)
      prisma.coin
        .update({ where: { id: coinId }, data: { migrated: true, migratedAt } })
        .catch((err) => console.error(`Migration DB update failed for ${coinId}:`, err.message));
      // Emit migration event
      if (io) {
        io.emit('coin_migrated', { coinId, name, ticker, marketCap });
      }
      console.log(`🚀 MIGRATED: ${name} (${ticker}) @ MC $${(marketCap / 1000).toFixed(1)}K`);
    }

    if (next <= RUG_THRESHOLD) rugged.push({ coinId, finalPrice: next });
  }

  if (io && Object.keys(updates).length) io.emit('price_update', updates);

  // Persist live prices (fire-and-forget)
  for (const coinId of Object.keys(updates)) {
    prisma.coin
      .update({ where: { id: coinId }, data: { currentPrice: updates[coinId].price } })
      .catch(() => {});
  }

  // Rug the fallen
  for (const { coinId, finalPrice } of rugged) {
    await _rugCoin(coinId, finalPrice);
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

function start(socketIo) {
  io = socketIo;
  init()
    .then(() => {
      interval = setInterval(tick, TICK_MS);
      console.log('💹 Price engine started');
    })
    .catch((err) => console.error('Price engine init failed:', err));
}

function stop() {
  if (interval) clearInterval(interval);
}

module.exports = {
  start, stop,
  registerCoin, removeCoin,
  getCurrentPrice, getHistory, getAllPrices,
  getIo,
};
