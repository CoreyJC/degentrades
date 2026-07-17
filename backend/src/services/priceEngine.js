/**
 * priceEngine.js — Realistic Memecoin Price Engine v3
 *
 * Each coin is assigned a FATE at birth and moves through PHASES:
 *
 *   early → pump → distribution → bleed → dying
 *
 * FATES:
 *   bleeder (60%) — pumps briefly then slowly dies
 *   pumper  (30%) — gets one good run then fades
 *   runner  (10%) — actually makes it, keeps climbing
 *
 * PHASES define probability tables — dying phase has NO pumps, only decay.
 * ATH is tracked so once a coin is 60%+ below its peak, it cannot recover.
 */

const prisma = require('../lib/prisma');

const MAX_CANDLES         = 500;
const TICK_MS             = 2000;
const RUG_THRESHOLD       = 0.0000001;
const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 69_000;

// ── In-memory state ────────────────────────────────────────────────────────────
const state = {};
let io          = null;
let interval    = null;
let initialized = false;

function _rand(min, max) { return min + Math.random() * (max - min); }

// ── Fate assignment ────────────────────────────────────────────────────────────

function _assignFate() {
  const r = Math.random();
  if (r < 0.60) return 'bleeder';
  if (r < 0.90) return 'pumper';
  return 'runner';
}

// ── Ceiling assignment (personal MC cap before distribution kicks in) ──────────
// Only runners can reach legendary ceilings — bleeders/pumpers stay near $69K.
// Targets: ~1/100 coins reach $10M, ~1/1000 reach $100M, ~1/10000 reach $1B
function _assignCeiling(fate) {
  if (fate === 'bleeder') return MIGRATION_THRESHOLD;         // always $69K
  if (fate === 'pumper') {
    const r = Math.random();
    if (r < 0.02) return 500_000;                            // 2% of pumpers → $500K
    return MIGRATION_THRESHOLD;                              // rest $69K
  }
  // runner — rare tiers
  const r = Math.random();
  if (r < 0.002) return 1_000_000_000;                      // 0.2% of runners → $1B   (~1 in 5000 coins)
  if (r < 0.020) return 100_000_000;                        // 1.8% of runners → $100M  (~1 in 555 coins)
  if (r < 0.150) return 10_000_000;                         // 13% of runners  → $10M   (~1 in 77 coins)
  if (r < 0.350) return 1_000_000;                          // 20% of runners  → $1M    (~1 in 28 coins)
  return MIGRATION_THRESHOLD;                               // rest $69K
}

// ── Phase transition ───────────────────────────────────────────────────────────

function _updatePhase(s) {
  // Track ATH every tick
  if (s.price > s.ath) s.ath = s.price;

  const phase         = s.phase;
  const athRatio      = s.ath > 0 ? s.price / s.ath : 1;
  const gainFromStart = s.startPrice > 0 ? s.price / s.startPrice : 1;
  const ageMin        = (Date.now() - new Date(s.createdAt).getTime()) / 60_000;
  const marketCap     = s.price * TOTAL_SUPPLY;

  // Force distribution when coin hits its personal ceiling
  if (marketCap >= s.ceiling && (phase === 'pump' || phase === 'early')) {
    s.phase = 'distribution';
    return;
  }

  if (phase === 'early') {
    // Transition to pump if 3x from start
    if (gainFromStart >= 3) { s.phase = 'pump'; return; }
    // Bleeders that haven't pumped after 20 min go straight to bleed
    if (ageMin > 20 && s.fate === 'bleeder' && gainFromStart < 1.5) {
      s.phase = 'bleed';
    }
  }

  if (phase === 'pump') {
    const isLegend = s.ceiling >= 10_000_000;
    if (s.fate === 'runner') {
      // Legends need much bigger gain + deeper dip before distribution
      const gainNeeded = isLegend ? (s.ceiling / (s.startPrice * TOTAL_SUPPLY)) * 0.8 : 10;
      const dipNeeded  = isLegend ? 0.55 : 0.70;
      if (gainFromStart >= gainNeeded && athRatio < dipNeeded) s.phase = 'distribution';
    } else if (s.fate === 'pumper') {
      if (gainFromStart >= 5 && athRatio < 0.75) s.phase = 'distribution';
      else if (athRatio < 0.72) s.phase = 'distribution';
    } else {
      if (gainFromStart >= 3 && athRatio < 0.82) s.phase = 'distribution';
    }
  }

  if (phase === 'distribution') {
    if (athRatio < 0.65) s.phase = 'bleed';
  }

  if (phase === 'bleed') {
    if (athRatio < 0.15) s.phase = 'dying'; // need 85% off ATH to enter death spiral
  }
  // dying is terminal — no transitions out
}

// ── Probability tables per phase ───────────────────────────────────────────────

function _nextPrice(coinId, s) {
  const { price: p, phase, fate, momentum } = s;
  const ageMin = (Date.now() - new Date(s.createdAt).getTime()) / 60_000;

  // ── EARLY — quiet accumulation, tiny moves, no rugs ──────────────────────
  if (phase === 'early') {
    // 5% chance of a surprise early pump to get momentum going
    if (Math.random() < 0.05) {
      const pump = _rand(0.08, 0.35);
      s.momentum = Math.min(s.momentum + 0.4, 1.0);
      s.volatility = Math.min(s.volatility * 1.5, 5.0);
      return p * (1 + pump);
    }
    // Otherwise tiny sideways movement
    const pct = _rand(0.002, 0.015);
    const upChance = 0.5 + momentum * 0.2;
    const dir = Math.random() < upChance ? 1 : -1;
    return Math.max(p * (1 + dir * pct), 1e-14);
  }

  const roll = Math.random();
  let t = 0;

  // ── PUMP phase ────────────────────────────────────────────────────────────
  if (phase === 'pump') {
    const rugBase = fate === 'runner' ? 0.002 : fate === 'pumper' ? 0.005 : 0.010;

    // Rug
    t += rugBase;
    if (roll < t) { s.momentum = -1.0; return Math.max(p * (1 - _rand(0.80, 0.99)), 1e-14); }

    // Mega pump — runners get big ones, scaled by ceiling
    if (fate === 'runner') {
      const isLegend = s.ceiling >= 10_000_000;
      t += isLegend ? 0.025 : 0.015;
      if (roll < t) {
        s.momentum = Math.min(s.momentum + 0.5, 1.0);
        s.volatility = Math.min(s.volatility * 2, 5.0);
        const pumpMult = isLegend ? _rand(2.0, 8.0) : _rand(1.0, 5.0);
        return p * (1 + pumpMult);
      }
    } else if (fate === 'pumper') {
      t += 0.008;
      if (roll < t) { s.momentum = Math.min(s.momentum + 0.4, 1.0); s.volatility = Math.min(s.volatility * 1.5, 5.0); return p * (1 + _rand(0.4, 1.5)); }
    }

    // Regular pump
    const pumpChance = fate === 'runner' ? 0.22 : fate === 'pumper' ? 0.16 : 0.07;
    t += pumpChance;
    if (roll < t) { s.momentum = Math.min(s.momentum + 0.3, 1.0); s.volatility = Math.min(s.volatility * 1.2, 5.0); return p * (1 + _rand(0.06, 0.30)); }

    // Minor pump
    const minorPumpChance = fate === 'runner' ? 0.22 : fate === 'pumper' ? 0.17 : 0.11;
    t += minorPumpChance;
    if (roll < t) { s.momentum = Math.min(s.momentum + 0.15, 1.0); return p * (1 + _rand(0.02, 0.08)); }

    // Normal (momentum-biased upward in pump phase)
    t += 0.42;
    if (roll < t) {
      const upBias = fate === 'runner' ? 0.70 : fate === 'pumper' ? 0.60 : 0.48;
      const dir = Math.random() < upBias + momentum * 0.15 ? 1 : -1;
      return Math.max(p * (1 + dir * _rand(0.003, 0.022) * s.volatility), 1e-14);
    }

    // Minor dump
    t += 0.08;
    if (roll < t) { s.momentum = Math.max(s.momentum - 0.15, -1.0); return Math.max(p * (1 - _rand(0.02, 0.08)), 1e-14); }

    // Dump (no big dump in pump phase — saves that for distribution/bleed)
    s.momentum = Math.max(s.momentum - 0.2, -1.0);
    return Math.max(p * (1 - _rand(0.08, 0.20)), 1e-14);
  }

  // ── DISTRIBUTION — topping out, selling pressure ──────────────────────────
  if (phase === 'distribution') {
    const rugBase = fate === 'runner' ? 0.008 : fate === 'pumper' ? 0.015 : 0.025;

    t += rugBase;
    if (roll < t) { s.momentum = -1.0; return Math.max(p * (1 - _rand(0.80, 0.99)), 1e-14); }

    // Runners can still mini-pump
    if (fate === 'runner') {
      t += 0.08;
      if (roll < t) { s.momentum = Math.min(s.momentum + 0.2, 1.0); return p * (1 + _rand(0.03, 0.12)); }
    }

    // Dead cat bounce (small, all fates)
    t += 0.05;
    if (roll < t) { return p * (1 + _rand(0.01, 0.04)); }

    // Normal (downward-biased)
    t += 0.35;
    if (roll < t) {
      const downBias = fate === 'runner' ? 0.45 : 0.60;
      const dir = Math.random() < downBias ? -1 : 1;
      return Math.max(p * (1 + dir * _rand(0.003, 0.018)), 1e-14);
    }

    // Minor dump
    t += 0.28;
    if (roll < t) { s.momentum = Math.max(s.momentum - 0.15, -1.0); return Math.max(p * (1 - _rand(0.02, 0.08)), 1e-14); }

    // Dump / big dump
    const dump = roll < t + 0.15 ? _rand(0.08, 0.20) : _rand(0.20, 0.45);
    s.momentum = Math.max(s.momentum - 0.25, -1.0);
    return Math.max(p * (1 - dump), 1e-14);
  }

  // ── BLEED — slow grind down, occasional dead cat bounce ──────────────────
  if (phase === 'bleed') {
    // Reduced rug rate — bleeders deserve a slow death, not instant annihilation
    const rugBase = 0.008 + (ageMin > 30 ? 0.006 : 0);

    t += rugBase;
    if (roll < t) { s.momentum = -1.0; return Math.max(p * (1 - _rand(0.80, 0.99)), 1e-14); }

    // Tiny dead cat bounce (rare)
    t += 0.04;
    if (roll < t) { return p * (1 + _rand(0.01, 0.03)); }

    // Sideways grind (slight down bias)
    t += 0.30;
    if (roll < t) {
      const dir = Math.random() < 0.65 ? -1 : 1;
      return Math.max(p * (1 + dir * _rand(0.002, 0.012)), 1e-14);
    }

    // Minor dump
    t += 0.35;
    if (roll < t) { s.momentum = Math.max(s.momentum - 0.2, -1.0); return Math.max(p * (1 - _rand(0.02, 0.08)), 1e-14); }

    // Dump
    t += 0.22;
    if (roll < t) { s.momentum = Math.max(s.momentum - 0.3, -1.0); return Math.max(p * (1 - _rand(0.06, 0.15)), 1e-14); }

    // Big dump — softened, no more 50% single-tick wipeouts in bleed
    s.momentum = -1.0;
    return Math.max(p * (1 - _rand(0.12, 0.28)), 1e-14);
  }

  // ── DYING — death spiral, NO pumps, only down ─────────────────────────────
  if (phase === 'dying') {
    const rugChance = Math.min(0.02 + ageMin * 0.0008, 0.12); // slow burn — coins can linger in dying for a while

    t += rugChance;
    if (roll < t) { s.momentum = -1.0; return Math.max(p * (1 - _rand(0.85, 0.99)), 1e-14); }

    // Small bounce (looks like hope, isn't)
    t += 0.03;
    if (roll < t) { return p * (1 + _rand(0.005, 0.015)); }

    // Slow bleed
    t += 0.35;
    if (roll < t) { return Math.max(p * (1 - _rand(0.005, 0.025)), 1e-14); }

    // Moderate dump
    t += 0.35;
    if (roll < t) { return Math.max(p * (1 - _rand(0.025, 0.10)), 1e-14); }

    // Heavy dump
    return Math.max(p * (1 - _rand(0.10, 0.40)), 1e-14);
  }

  return p;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

function _bootstrap(coin) {
  const startPrice = coin.currentPrice || 1e-7;
  const fate       = _assignFate();
  const ceiling    = _assignCeiling(fate);
  const history    = []; // start empty — chart builds in real time

  state[coin.id] = {
    price:      startPrice,
    startPrice,
    ath:        startPrice,
    fate,
    ceiling,
    phase:      'early',
    momentum:   0,
    volatility: 1.0,
    createdAt:  coin.createdAt ?? new Date(),
    migrated:   coin.migrated ?? false,
    history,
    name:       coin.name,
    ticker:     coin.ticker,
    baseRugProb: coin.rugProbability ?? 0.007,
  };
}

async function init() {
  const coins = await prisma.coin.findMany({ where: { isActive: true } });
  for (const coin of coins) {
    _bootstrap(coin);
    state[coin.id].price     = coin.currentPrice;
    state[coin.id].startPrice = coin.currentPrice;
    state[coin.id].ath       = coin.currentPrice;
    state[coin.id].createdAt = coin.createdAt ?? new Date();
  }
  initialized = true;
  console.log(`💹 Price engine initialized — ${coins.length} coins loaded`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

function registerCoin(coin) {
  if (state[coin.id]) return;
  _bootstrap(coin);
  state[coin.id].price      = coin.currentPrice;
  state[coin.id].startPrice = coin.currentPrice;
  state[coin.id].ath        = coin.currentPrice;
  state[coin.id].createdAt  = coin.createdAt ?? new Date();
  console.log(`🪙 New coin: ${coin.name} (${coin.ticker}) — fate: ${state[coin.id].fate}`);
}

function removeCoin(coinId) { delete state[coinId]; }
function getCurrentPrice(coinId) { return state[coinId]?.price ?? null; }
function getHistory(coinId) { return state[coinId]?.history ?? []; }
function getAllPrices() { return Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.price])); }
function getCreatedAt(coinId) { return state[coinId]?.createdAt ?? null; }
function getIo() { return io; }

// ── Rug execution ──────────────────────────────────────────────────────────────

async function _rugCoin(coinId, finalPrice) {
  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) { removeCoin(coinId); return; }
    const s = state[coinId];
    console.log(`💀 RUG: ${coin.name} (${coin.ticker}) [${s?.fate ?? '?'}/${s?.phase ?? '?'}] $${finalPrice.toExponential(2)}`);

    // Find all holders so we can log a RUG transaction for each
    const holdings = await prisma.holding.findMany({ where: { coinId } });

    await prisma.coin.update({ where: { id: coinId }, data: { isActive: false } });
    if (io) io.emit('coin_deleted', { coinId, name: coin.name, ticker: coin.ticker, finalPrice });
    removeCoin(coinId);

    // Create RUG close transactions FIRST (coin still exists at this point)
    for (const h of holdings) {
      const pnlPct = h.avgBuyPrice > 0
        ? ((finalPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100
        : -100;
      await prisma.transaction.create({
        data: {
          userId:      h.userId,
          coinId,
          type:        'RUG',
          amount:      h.amount,
          price:       finalPrice,
          solSpent:    0,
          avgBuyPrice: h.avgBuyPrice,
          pnlPct,
        },
      });
    }

    // Now clean up — leave coin record as isActive:false so RUG txn FK stays valid
    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { coinId, type: { in: ['BUY', 'SELL'] } } }),
      prisma.holding.deleteMany({ where: { coinId } }),
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
    // Decay momentum each tick
    s.momentum   *= 0.92;
    s.volatility  = Math.max(s.volatility * 0.985, 1.0);

    // Update phase before computing next price
    _updatePhase(s);

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
      lastCandle.volume += Math.abs((next - prev) / prev) * 4000 + Math.random() * 80;
    } else {
      candles.push({
        time:   nowSec,
        open:   prev,
        high:   Math.max(prev, next),
        low:    Math.min(prev, next),
        close:  next,
        volume: Math.abs((next - prev) / prev) * 4000 + Math.random() * 80,
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
    prisma.coin.update({ where: { id: coinId }, data: { currentPrice: updates[coinId].price } }).catch(() => {});
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
      console.log('💹 Price engine started (fate/phase model v3)');
    })
    .catch((err) => console.error('Price engine init failed:', err));
}

function stop() {
  if (interval) clearInterval(interval);
  initialized = false;
}

module.exports = {
  start, stop,
  registerCoin, removeCoin,
  getCurrentPrice, getHistory, getAllPrices, getCreatedAt,
  getIo,
};
