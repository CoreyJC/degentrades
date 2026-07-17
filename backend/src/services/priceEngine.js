/**
 * priceEngine.js — Realistic Memecoin Price Engine
 *
 * Features:
 *  - Momentum system (range -1.0 to +1.0)
 *  - Volatility regime (range 1.0 to 5.0)
 *  - Age-based early accumulation phase (< 2 min protection)
 *  - Revised probability table with mega pumps, big dumps, rugs
 */

const prisma = require('../lib/prisma');

const MAX_CANDLES         = 500;
const TICK_MS             = 2000;
const RUG_THRESHOLD       = 0.0000001;
const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 30_000; // $30K market cap

// ── In-memory state ────────────────────────────────────────────────────────────
// coinId → { price, baseRugProb, createdAt, momentum, volatility, history[], name, ticker, migrated }
const state = {};

let io          = null;
let interval    = null;
let initialized = false;

// ── Helpers ────────────────────────────────────────────────────────────────────

function _rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Age-scaled rug multiplier.
 * < 2 min  → 0 (no rugs in early phase, handled separately)
 * 2-20 min → scales 0.2 → 1.0
 * > 20 min → ticking time bomb
 */
function _ageRugMultiplier(createdAt) {
  const ageMs  = Date.now() - new Date(createdAt).getTime();
  const ageMin = ageMs / 60_000;

  if (ageMin < 2)  return 0;                        // protected early phase
  if (ageMin <= 20) return 0.2 + (ageMin - 2) / 18 * 0.8; // ramp 0.2→1.0
  const extraMin = ageMin - 20;
  return 1.0 + 0.1 * extraMin;                      // ticking time bomb
}

function _nextPrice(coinId, s) {
  const { price: current, baseRugProb, createdAt, momentum, volatility } = s;
  const ageMs  = Date.now() - new Date(createdAt).getTime();
  const ageMin = ageMs / 60_000;

  // ── Early accumulation phase (< 2 min) ──────────────────────────────────────
  if (ageMin < 2) {
    if (Math.random() < 0.05) {
      // Surprise early pump
      const pump = _rand(0.10, 0.40);
      s.momentum  = Math.min(s.momentum + 0.3, 1.0);
      _hotVolatility(s, pump);
      return current * (1 + pump);
    }
    // Tiny move ±0.5–2%
    const pct = _rand(0.005, 0.02);
    const dir = Math.random() < 0.5 ? 1 : -1;
    return Math.max(current * (1 + dir * pct), 1e-14);
  }

  // ── Age-scaled rug probability ───────────────────────────────────────────────
  const rugMultiplier  = _ageRugMultiplier(createdAt);
  const effectiveRug   = Math.min(baseRugProb * rugMultiplier, 0.50);

  const roll = Math.random();
  let threshold = 0;

  // Rug pull
  threshold += effectiveRug;
  if (roll < threshold) {
    const drop = _rand(0.80, 0.99);
    s.momentum  = -1.0;
    return Math.max(current * (1 - drop), 1e-14);
  }

  // Mega pump: 0.5%
  threshold += 0.005;
  if (roll < threshold) {
    const pump = _rand(1.00, 5.00); // +100–500%
    s.momentum = Math.min(s.momentum + 0.3, 1.0);
    _hotVolatility(s, pump);
    return current * (1 + pump);
  }

  // Pump: 6%
  threshold += 0.06;
  if (roll < threshold) {
    const pump = _rand(0.08, 0.30); // +8–30%
    s.momentum = Math.min(s.momentum + 0.3, 1.0);
    _hotVolatility(s, pump);
    return current * (1 + pump);
  }

  // Minor pump: 12%
  threshold += 0.12;
  if (roll < threshold) {
    const pump = _rand(0.02, 0.08); // +2–8%
    s.momentum = Math.min(s.momentum + 0.3, 1.0);
    return current * (1 + pump);
  }

  // Normal move: 65% (with momentum bias)
  threshold += 0.65;
  if (roll < threshold) {
    const basePct = _rand(0.005, 0.03) * volatility; // scaled by volatility
    // Momentum bias: positive momentum → more likely to go up
    const upChance = 0.5 + momentum * 0.3; // 0.2 to 0.8 range
    const dir = Math.random() < upChance ? 1 : -1;
    const pct = Math.min(basePct, 0.15); // cap normal moves at 15%
    return Math.max(current * (1 + dir * pct), 1e-14);
  }

  // Minor dump: 10%
  threshold += 0.10;
  if (roll < threshold) {
    const dump = _rand(0.02, 0.08); // -2–8%
    s.momentum = Math.max(s.momentum - 0.2, -1.0);
    _hotVolatility(s, dump);
    return Math.max(current * (1 - dump), 1e-14);
  }

  // Dump: 5%
  threshold += 0.05;
  if (roll < threshold) {
    const dump = _rand(0.10, 0.25); // -10–25%
    s.momentum = Math.max(s.momentum - 0.2, -1.0);
    _hotVolatility(s, dump);
    return Math.max(current * (1 - dump), 1e-14);
  }

  // Big dump: 1.5%
  {
    const dump = _rand(0.30, 0.60); // -30–60%
    s.momentum = Math.max(s.momentum - 0.2, -1.0);
    _hotVolatility(s, dump);
    return Math.max(current * (1 - dump), 1e-14);
  }
}

/** Trigger hot volatility phase if move was large enough */
function _hotVolatility(s, moveFraction) {
  if (moveFraction > 0.15) {
    s.volatility = Math.min(s.volatility * 1.5, 5.0);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

function _bootstrap(coin) {
  let p         = coin.currentPrice;
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

  const RUG_PROB_MIN = 0.005;
  const RUG_PROB_MAX = 0.010;
  const baseRugProb  = coin.rugProbability ??
    (RUG_PROB_MIN + Math.random() * (RUG_PROB_MAX - RUG_PROB_MIN));

  state[coin.id] = {
    price:      p,
    baseRugProb,
    createdAt:  coin.createdAt ?? new Date(),
    momentum:   0,
    volatility: 1.0,
    migrated:   coin.migrated ?? false,
    history,
    name:       coin.name,
    ticker:     coin.ticker,
  };
}

async function init() {
  const coins = await prisma.coin.findMany({ where: { isActive: true } });
  for (const coin of coins) {
    _bootstrap(coin);
    state[coin.id].price     = coin.currentPrice;
    state[coin.id].createdAt = coin.createdAt ?? new Date();
  }
  initialized = true;
}

// ── Public API ─────────────────────────────────────────────────────────────────

function registerCoin(coin) {
  if (state[coin.id]) return;
  _bootstrap(coin);
  state[coin.id].price     = coin.currentPrice;
  state[coin.id].createdAt = coin.createdAt ?? new Date();
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

    await prisma.coin.update({ where: { id: coinId }, data: { isActive: false } });

    if (io) {
      io.emit('coin_deleted', { coinId, name: coin.name, ticker: coin.ticker, finalPrice });
    }

    removeCoin(coinId);

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

  const updates = {};
  const rugged  = [];
  const nowSec  = Math.floor(Date.now() / 1000);

  for (const [coinId, s] of Object.entries(state)) {
    // Decay momentum and volatility each tick
    s.momentum   *= 0.9;
    s.volatility *= 0.98;
    if (s.volatility < 1.0) s.volatility = 1.0;

    const prev = s.price;
    const next = _nextPrice(coinId, s);
    s.price    = next;

    // ── Candle ──
    const candles    = s.history;
    const lastCandle = candles[candles.length - 1];

    if (lastCandle && lastCandle.time === nowSec) {
      lastCandle.high   = Math.max(lastCandle.high, next);
      lastCandle.low    = Math.min(lastCandle.low, next);
      lastCandle.close  = next;
      lastCandle.volume += Math.abs((next - prev) / prev) * 5000 + Math.random() * 100;
    } else {
      candles.push({
        time:   nowSec,
        open:   prev,
        high:   Math.max(prev, next),
        low:    Math.min(prev, next),
        close:  next,
        volume: Math.abs((next - prev) / prev) * 5000 + Math.random() * 100,
      });
      if (candles.length > MAX_CANDLES) candles.shift();
    }

    const marketCap = next * TOTAL_SUPPLY;
    updates[coinId] = { id: coinId, price: next, marketCap, candle: candles[candles.length - 1] };

    // Migration check
    if (!s.migrated && marketCap >= MIGRATION_THRESHOLD) {
      s.migrated = true;
      prisma.coin.update({ where: { id: coinId }, data: { migrated: true, migratedAt: new Date() } }).catch(() => {});
      if (io) io.emit('coin_migrated', { coinId, name: s.name, ticker: s.ticker, marketCap });
    }

    if (next <= RUG_THRESHOLD) rugged.push({ coinId, finalPrice: next });
  }

  if (io && Object.keys(updates).length) io.emit('price_update', updates);

  for (const coinId of Object.keys(updates)) {
    prisma.coin
      .update({ where: { id: coinId }, data: { currentPrice: updates[coinId].price } })
      .catch(() => {});
  }

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
      console.log('💹 Price engine started (momentum/volatility model)');
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
