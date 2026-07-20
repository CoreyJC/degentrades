/**
 * priceEngine.js - Realistic Memecoin Price Engine v3
 *
 * Each coin is assigned a FATE at birth and moves through PHASES:
 *
 *   early → pump → distribution → bleed → dying
 *
 * FATES:
 *   bleeder (60%) - pumps briefly then slowly dies
 *   pumper  (30%) - gets one good run then fades
 *   runner  (10%) - actually makes it, keeps climbing
 *
 * PHASES define probability tables - dying phase has NO pumps, only decay.
 * ATH is tracked so once a coin is 60%+ below its peak, it cannot recover.
 */

const prisma = require('../lib/prisma');

const MAX_CANDLES         = 500;
const TICK_MS             = 1000;
const RUG_THRESHOLD       = 0.0000001;
const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 69_000;
const MIN_RUG_AGE_MIN     = 15; // keep coins alive long enough for a fuller market

// ── In-memory state ────────────────────────────────────────────────────────────
const state = {};
let io          = null;
let interval    = null;
let initialized = false;

function _rand(min, max) { return min + Math.random() * (max - min); }

// Cap upside velocity so legendary runs take time instead of one lucky minute.
// 0.6%/sec means a $2K → $200M run needs ~32 minutes of nonstop green ticks.
function _capUpsideVelocity(s, nextPrice) {
  if (nextPrice <= s.price) return nextPrice;
  const ageMin = (Date.now() - new Date(s.createdAt).getTime()) / 60_000;
  if (ageMin >= 30) return nextPrice;
  const maxUpPct = 0.006;
  return Math.min(nextPrice, s.price * (1 + maxUpPct));
}

// ── Fate assignment ────────────────────────────────────────────────────────────

function _assignFate() {
  const r = Math.random();
  if (r < 0.60) return 'bleeder';
  if (r < 0.90) return 'pumper';
  return 'runner';
}

// ── Ceiling assignment (personal MC cap before distribution kicks in) ──────────
// Only runners can reach legendary ceilings - bleeders/pumpers stay near $69K.
// Targets: ~1/100 coins reach $10M, ~1/1000 reach $100M, ~1/10000 reach $1B
function _assignCeiling(fate) {
  if (fate === 'bleeder') return MIGRATION_THRESHOLD;         // always $69K
  if (fate === 'pumper') {
    const r = Math.random();
    if (r < 0.02) return 500_000;                            // 2% of pumpers → $500K
    return MIGRATION_THRESHOLD;                              // rest $69K
  }
  // runner - rare tiers
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
    // Protect from instant distribution for 10 ticks after a user buy
    // (large buy spikes price -> instant new ATH -> 1-tick natural correction -> athRatio < threshold -> distribution)
    if (s.lastUserBuyTick != null && tickCount - s.lastUserBuyTick < 10) return;
    // Any pumping coin can enter consolidation - back-and-forth fighting
    // Runners: frequent + starts low MC | Pumpers: moderate | Bleeders: rare + only mid-range
    const consolidationChance =
      s.fate === 'runner'  ? (marketCap > 5_000   ? 0.0018 : 0) :
      s.fate === 'pumper'  ? (marketCap > 10_000  ? 0.0012 : 0) :
      /* bleeder */          (marketCap > 20_000  ? 0.0006 : 0);
    if (consolidationChance > 0 && Math.random() < consolidationChance) {
      s.phase = 'consolidation';
      s.consolidationStart = Date.now();
      return;
    }
    if (s.fate === 'runner') {
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

  // Consolidation: violent sideways chop - either resumes pump or rolls over
  if (phase === 'consolidation') {
    const elapsed = s.consolidationStart ? (Date.now() - s.consolidationStart) / 1000 : 999;
    const duration = 45 + Math.random() * 90; // 45-135 seconds of fighting
    if (elapsed > duration) {
      // Continuation chance by fate: runners mostly continue, bleeders mostly top out
      const continuationChance =
        s.fate === 'runner'  ? 0.60 :
        s.fate === 'pumper'  ? 0.40 :
        /* bleeder */          0.20;
      if (Math.random() < continuationChance) {
        s.phase = 'pump'; // bulls win - continuation
      } else {
        s.phase = 'distribution'; // bears win - roll over
      }
      s.consolidationStart = null;
    }
    return; // skip other transitions while consolidating
  }

  if (phase === 'distribution') {
    if (athRatio < 0.65) s.phase = 'bleed';
  }

  if (phase === 'bleed') {
    if (athRatio < 0.15) s.phase = 'dying'; // need 85% off ATH to enter death spiral
  }
  // dying is terminal - no transitions out

  // ── Stall wakeup - random chance a stalled coin gets noticed ─────────────
  if (s.stalled) {
    const wakeupChance = s.fate === 'runner'  ? 0.030
                       : s.fate === 'pumper' ? 0.018
                       :                       0.007; // bleeders rarely wake
    if (Math.random() < wakeupChance) {
      s.stalled  = false;
      if (s.fate !== 'bleeder') s.phase = 'pump'; // jumps straight to pump
    }
  }
}

// ── Probability tables per phase ───────────────────────────────────────────────

function _nextPrice(coinId, s) {
  const { price: p, phase, fate, momentum } = s;
  const ageMin = (Date.now() - new Date(s.createdAt).getTime()) / 60_000;

  // ── NEWBORN - sniper/bot front-run on launch (first 6 ticks ≈ 12 seconds) ─
  if (s.newbornTicks > 0) {
    const tick = s.newbornTicks; // 6 down to 1
    s.newbornTicks--;
    if (tick >= 5) {
      // Ticks 6+5: initial sniper spike - scaled by fate
      const base = fate === 'runner' ? _rand(0.40, 0.90)
                 : fate === 'pumper' ? _rand(0.20, 0.55)
                 :                     _rand(0.08, 0.28); // bleeder gets smaller spike
      s.momentum = Math.min(s.momentum + 0.5, 1.0);
      s.holderCount = Math.min(s.holderCount + Math.floor(1 + Math.random() * 4), 9999);
      return p * (1 + base);
    } else if (tick >= 3) {
      // Ticks 4+3: follow-through or first cracks
      if (fate !== 'bleeder' && Math.random() < 0.65) {
        const pump = _rand(0.04, 0.18);
        s.momentum = Math.min(s.momentum + 0.15, 1.0);
        s.holderCount = Math.min(s.holderCount + Math.floor(Math.random() * 3), 9999);
        return p * (1 + pump);
      }
      // First profit-taking
      const dump = _rand(0.05, 0.18);
      s.momentum = Math.max(s.momentum - 0.2, -1.0);
      return Math.max(p * (1 - dump), 1e-14);
    } else {
      // Ticks 2+1: correction / consolidation after spike
      const dump = fate === 'bleeder' ? _rand(0.08, 0.25) : _rand(0.03, 0.12);
      s.momentum = Math.max(s.momentum - 0.15, -1.0);
      return Math.max(p * (1 - dump), 1e-14);
    }
  }

  // ── CONSOLIDATION - high-MC fighter, big candles both ways ───────────────
  if (phase === 'consolidation') {
    const roll = Math.random();
    let t = 0;

    // Very rare rug (coin is established, whales protecting)
    t += 0.002;
    if (roll < t) { s.momentum = -1.0; return Math.max(p * (1 - _rand(0.60, 0.90)), 1e-14); }

    // Big bull candle - attempt to break out
    t += 0.11;
    if (roll < t) { s.momentum = Math.min(s.momentum + 0.4, 1.0); return p * (1 + _rand(0.12, 0.45)); }

    // Big bear candle - rejection / shakeout
    t += 0.11;
    if (roll < t) { s.momentum = Math.max(s.momentum - 0.4, -1.0); return Math.max(p * (1 - _rand(0.12, 0.38)), 1e-14); }

    // Medium up
    t += 0.18;
    if (roll < t) { s.momentum = Math.min(s.momentum + 0.2, 1.0); return p * (1 + _rand(0.04, 0.12)); }

    // Medium down
    t += 0.18;
    if (roll < t) { s.momentum = Math.max(s.momentum - 0.2, -1.0); return Math.max(p * (1 - _rand(0.04, 0.12)), 1e-14); }

    // Small choppy noise - slightly momentum-biased
    const bias = s.momentum * 0.08;
    const dir  = Math.random() < 0.5 + bias ? 1 : -1;
    return Math.max(p * (1 + dir * _rand(0.008, 0.035)), 1e-14);
  }

  // ── STALLED - coin is flat and looks dead; rare chance to wake up ─────────
  if (s.stalled) {
    const pct = _rand(0.001, 0.004);
    const dir = Math.random() < 0.48 ? -1 : 1; // very slight downward drift
    return Math.max(p * (1 + dir * pct), 1e-14);
  }

  // ── EARLY - quiet accumulation, tiny moves, no rugs ──────────────────────
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
    // Bundled coins rug 3-4x more often in pump phase - dev is waiting to dump
    const bundledMult = s.isBundled ? 3.5 : 1.0;
    const rugBase = (fate === 'runner' ? 0.001 : fate === 'pumper' ? 0.0025 : 0.005) * bundledMult;

    // Rug
    t += rugBase;
    if (roll < t) { s.momentum = -1.0; return Math.max(p * (1 - _rand(0.80, 0.99)), 1e-14); }

    // Mega pump - runners get big ones, scaled by ceiling
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

    // Dump (no big dump in pump phase - saves that for distribution/bleed)
    s.momentum = Math.max(s.momentum - 0.2, -1.0);
    return Math.max(p * (1 - _rand(0.08, 0.20)), 1e-14);
  }

  // ── DISTRIBUTION - topping out, selling pressure ──────────────────────────
  if (phase === 'distribution') {
    const rugBase = fate === 'runner' ? 0.004 : fate === 'pumper' ? 0.0075 : 0.0125;

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

  // ── BLEED - slow grind down, occasional dead cat bounce ──────────────────
  if (phase === 'bleed') {
    // Reduced rug rate - bleeders deserve a slow death, not instant annihilation
    const rugBase = 0.004 + (ageMin > 60 ? 0.003 : 0);

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

    // Big dump - softened, no more 50% single-tick wipeouts in bleed
    s.momentum = -1.0;
    return Math.max(p * (1 - _rand(0.12, 0.28)), 1e-14);
  }

  // ── DYING - death spiral, NO pumps, only down ─────────────────────────────
  if (phase === 'dying') {
    const rugChance = Math.min(0.01 + ageMin * 0.0004, 0.06); // slow burn - coins can linger in dying for a while

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
  const history    = []; // start empty - chart builds in real time

  // Stall probability by fate - bleeders go flat most of the time
  const stallProb = fate === 'bleeder' ? 0.62 : fate === 'pumper' ? 0.28 : 0.10;

  // ~20% of coins are bundled - dev bought with many wallets, high concentration
  const isBundled = Math.random() < 0.20;
  // Top holder % - starts high for bundled, organic for others
  const topHolderPct = isBundled
    ? 60 + Math.random() * 30        // 60-90% dev-controlled
    : 5  + Math.random() * 25;       // 5-30% organic

  state[coin.id] = {
    price:       startPrice,
    startPrice,
    ath:         startPrice,
    fate,
    ceiling,
    phase:       'early',
    momentum:    0,
    volatility:  1.0,
    createdAt:   coin.createdAt ?? new Date(),
    migrated:    coin.migrated ?? false,
    history,
    name:        coin.name,
    ticker:      coin.ticker,
    baseRugProb: coin.rugProbability ?? 0.007,
    // Sniper spike: first N ticks are forced launch candles
    newbornTicks: 6,
    // Stall: coin goes sideways and looks dead until it wakes up or dies
    stalled:     Math.random() < stallProb,
    // Simulated holder count - bundled coins start with fake inflated numbers
    holderCount:        isBundled
      ? Math.floor(80 + Math.random() * 400)   // 80-480 fake wallets
      : Math.floor(1  + Math.random() * 2),    // 1-3 organic
    isBundled,
    topHolderPct,
    consolidationStart: null,
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
  console.log(`💹 Price engine initialized - ${coins.length} coins loaded`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

function registerCoin(coin) {
  if (state[coin.id]) return;
  _bootstrap(coin);
  state[coin.id].price      = coin.currentPrice;
  state[coin.id].startPrice = coin.currentPrice;
  state[coin.id].ath        = coin.currentPrice;
  state[coin.id].createdAt  = coin.createdAt ?? new Date();
  console.log(`🪙 New coin: ${coin.name} (${coin.ticker}) - fate: ${state[coin.id].fate}`);
}

function removeCoin(coinId) { delete state[coinId]; }
function getCurrentPrice(coinId) { return state[coinId]?.price ?? null; }
function getHistory(coinId) { return state[coinId]?.history ?? []; }
function getAllPrices() { return Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.price])); }
function getHolderCount(coinId)   { return state[coinId]?.holderCount ?? 1; }
function getTopHolderPct(coinId)  { return state[coinId]?.topHolderPct ?? 50; }
function getIsBundled(coinId)     { return state[coinId]?.isBundled ?? false; }

/**
 * Apply immediate price impact from a user trade.
 * impactSol = SOL equivalent of the trade (positive = buy, negative = sell)
 * Impact scales with trade size vs current market cap - small caps feel it hard.
 */
function applyTradeImpact(coinId, impactSol, isBuy) {
  const s = state[coinId];
  if (!s) return;

  const marketCap = s.price * TOTAL_SUPPLY;
  // Impact scales with trade size vs market cap - thin liquidity = big moves
  // 1 SOL into $1K MC = 15% bump | 5 SOL = 75% | 10 SOL = 150% (capped at 5x)
  const rawImpact = Math.abs(impactSol) / marketCap * 150;
  // Buys can send tiny caps hard, but sells should not instantly force a rug.
  // Cap sell impact at -85% so the sell records cleanly and the coin can die naturally on later ticks.
  const impactPct = isBuy ? Math.min(rawImpact, 5.0) : Math.min(rawImpact, 0.85);

  if (isBuy) {
    s.price     = _capUpsideVelocity(s, s.price * (1 + impactPct));
    s.momentum  = Math.min(s.momentum + impactPct * 1.5, 1.0);
    s.volatility = Math.min(s.volatility * (1 + impactPct * 0.5), 5.0);
    // Buying a stalled coin wakes it up - you're the catalyst
    if (s.stalled && impactPct > 0.03) {
      s.stalled = false;
      if (s.fate !== 'bleeder') s.phase = 'pump';
    }
    if (s.price > s.ath) s.ath = s.price;
    s.lastUserBuyTick = tickCount; // track for distribution protection window
  } else {
    s.price     = Math.max(s.price * (1 - impactPct), 1e-14);
    s.momentum  = Math.max(s.momentum - impactPct * 1.5, -1.0);
    s.volatility = Math.min(s.volatility * (1 + impactPct * 0.3), 5.0);
  }

  // Update the last candle in place - extend its wick and move the close
  // Never create a new candle from a trade; let tick() own candle creation
  const history = s.history;
  if (history.length > 0) {
    const lastCandle = history[history.length - 1];
    lastCandle.high   = Math.max(lastCandle.high, s.price);
    lastCandle.low    = Math.min(lastCandle.low,  s.price);
    lastCandle.close  = s.price;
    lastCandle.volume += Math.abs(impactPct) * 800; // visible volume spike
  }

  // Broadcast the impact immediately so the chart updates in real-time
  if (io) {
    const newMC = s.price * TOTAL_SUPPLY;
    const lastCandle = s.history.length > 0 ? s.history[s.history.length - 1] : null;
    io.emit('price_update', {
      [coinId]: { id: coinId, price: s.price, marketCap: newMC, holderCount: s.holderCount, candle: lastCandle },
    });
  }
  prisma.coin.update({ where: { id: coinId }, data: { currentPrice: s.price } }).catch(() => {});
}
function getCreatedAt(coinId) { return state[coinId]?.createdAt ?? null; }
function getIo() { return io; }

// ── Rug execution ──────────────────────────────────────────────────────────────

async function _rugCoin(coinId, finalPrice) {
  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) { removeCoin(coinId); return; }
    const s = state[coinId];
    console.log(`💀 RUG: ${coin.name} (${coin.ticker}) [${s?.fate ?? '?'}/${s?.phase ?? '?'}] $${finalPrice.toExponential(2)}`);

    // Find all holders so we can log a RUG transaction for each (only real holders with amount > 0)
    const holdings = await prisma.holding.findMany({ where: { coinId, amount: { gt: 0 } } });

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

    // Clean up holdings only — preserve all user transactions (BUY/SELL/RUG) for closed positions history
    await prisma.holding.deleteMany({ where: { coinId } });
  } catch (err) {
    console.error(`Error rugging coin ${coinId}:`, err.message);
    removeCoin(coinId);
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────────

let tickCount = 0;
const DB_WRITE_EVERY = 5; // write prices to DB every 5 ticks (5s) — reduces DB pressure

async function tick() {
  if (!initialized) return;
  tickCount++;

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
    const coinAgeMin = (Date.now() - new Date(s.createdAt).getTime()) / 60_000;
    let next = _capUpsideVelocity(s, _nextPrice(coinId, s));

    // Early protection: don't let newborn coins disappear instantly.
    // If a rug branch fires before 15m, convert it into a hard dump instead of removal.
    if (coinAgeMin < MIN_RUG_AGE_MIN && next <= RUG_THRESHOLD) {
      next = Math.max(prev * _rand(0.35, 0.65), RUG_THRESHOLD * 10);
      s.momentum = Math.max(s.momentum, -0.6);
    }

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

    // ── Holder count — MC-driven target with smooth convergence ────────────
    const mcInK = marketCap / 1000;
    const targetHolders = Math.max(1, Math.floor(
      10 * Math.pow(mcInK, 0.75) * (0.85 + Math.random() * 0.30)
    ));
    const pctChange = prev > 0 ? (next - prev) / prev : 0;
    const convergenceRate = pctChange < -0.05 ? 0.25 : 0.12;
    s.holderCount = Math.max(1, Math.round(
      s.holderCount + (targetHolders - s.holderCount) * convergenceRate
    ));

    // ── Top holder % — dilutes as coin pumps; bundled barely moves (dev holds)
    if (s.topHolderPct == null) s.topHolderPct = s.isBundled ? 75 : 25;
    if (pctChange > 0.03 && s.topHolderPct > 1) {
      const dilution = s.isBundled ? 0.05 : 0.30;
      s.topHolderPct = Math.max(1, s.topHolderPct - pctChange * dilution * 100);
    }

    updates[coinId] = { id: coinId, price: next, marketCap, holderCount: s.holderCount, topHolderPct: parseFloat((s.topHolderPct ?? 50).toFixed(1)), isBundled: s.isBundled ?? false, candle: candles[candles.length - 1] };

    // Migration check
    if (!s.migrated && marketCap >= MIGRATION_THRESHOLD) {
      s.migrated = true;
      prisma.coin.update({ where: { id: coinId }, data: { migrated: true, migratedAt: new Date() } }).catch(() => {});
      if (io) io.emit('coin_migrated', { coinId, name: s.name, ticker: s.ticker, marketCap });
    }

    if (next <= RUG_THRESHOLD) rugged.push({ coinId, finalPrice: next });
  }

  if (io && Object.keys(updates).length) io.emit('price_update', updates);

  // Write prices to DB periodically (not every tick) to reduce connection pool pressure
  if (tickCount % DB_WRITE_EVERY === 0) {
    for (const coinId of Object.keys(updates)) {
      prisma.coin.update({ where: { id: coinId }, data: { currentPrice: updates[coinId].price } }).catch(() => {});
    }
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
  getCurrentPrice, getHistory, getAllPrices, getCreatedAt, getHolderCount, getTopHolderPct, getIsBundled, applyTradeImpact,
  getIo,
};
