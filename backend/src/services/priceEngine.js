/**
 * priceEngine.js - Memecoin Price Engine v4 (Cycle-Based)
 *
 * Each coin runs through repeating 3-minute pump cycles:
 *   surge (60s) → chop (60s) → resolution (60s)
 *
 * Cycle outcome:
 *   40% continue: floor rises (staircase), new higher target
 *   60% retrace:  price falls back to floor
 *
 * Below floor ($2K MC) → fading (slow bleed to rug)
 * 3+ successful cycles at >$20K MC → 8% runner unlock → straight shot to $69K
 * $69K → migration event
 */

const prisma = require('../lib/prisma');

const MAX_CANDLES         = 500;
const TICK_MS             = 1_000;
const RUG_THRESHOLD       = 0.0000001;
const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 69_000;
const START_MC            = 2_000;
const FLOOR_MC_MIN        = 1_800; // below this → fading out

// ── In-memory state ────────────────────────────────────────────────────────────
const state = {};
let io          = null;
let interval    = null;
let initialized = false;
let tickCount   = 0;
const DB_WRITE_EVERY = 5;

function _rand(min, max) { return min + Math.random() * (max - min); }

// ── Holder-based modifiers ────────────────────────────────────────────────────
// Returns live risk/volatility factors derived from holder concentration.
function _holderMods(s) {
  const top     = s.topHolderPct ?? 50;
  const holders = s.holderCount  ?? 100;

  // Higher concentration = higher rug risk
  const rugMult =
    top >= 80 ? 2.8 :
    top >= 60 ? 1.7 :
    top >= 40 ? 1.2 :
               0.80; // distributed bags = safer

  // Fewer holders = thinner book = wilder swings
  const volScale =
    holders <  50  ? 1.40 :
    holders <  150 ? 1.15 :
    holders <  400 ? 1.00 :
    holders <  800 ? 0.88 :
                     0.75;

  // Bundled + concentrated = periodic dev dump candles during chop/retrace
  const devDumpChance = (s.isBundled && top > 55)
    ? Math.min(0.12, (top - 55) / 400)  // up to 12% per tick at max concentration
    : 0;

  // Dev distributing (topHolderPct falling fast) = bullish pressure
  const prevTop = s.topHolderPctPrev ?? top;
  const devDistributing = (prevTop - top) > 1.5; // dropped >1.5% = sending bags out

  return { rugMult, volScale, devDumpChance, devDistributing };
}

// ── Intrabar wicks ─────────────────────────────────────────────────────────────
// Extends candle high/low beyond close to create realistic wick structure.
function _addWicks(candle, phase) {
  const body = Math.abs(candle.close - candle.open);
  const ref  = Math.max(candle.open, candle.close, 1e-14);

  const priceWick = ref  * _rand(0.001, 0.006);   // was 0.003-0.018
  const bodyWick  = body * _rand(0.1,   0.5);     // was 0.2-2.0

  const factor =
    phase === 'chop'       ? _rand(0.6, 1.4) :    // was 1.5-3.5
    phase === 'retrace'    ? _rand(0.5, 1.1) :    // was 1.0-2.5
    phase === 'resolution' ? _rand(0.4, 1.0) :    // was 0.8-2.0
    phase === 'surge'      ? _rand(0.15, 0.55) :  // was 0.2-1.0
    phase === 'runner'     ? _rand(0.2,  0.65) :  // was 0.3-1.2
                             _rand(0.2,  0.70);   // was 0.3-1.5

  const totalWick = (priceWick + bodyWick) * factor;
  // Cap wicks at 5% of price to prevent absurd spikes
  const maxWick   = ref * 0.05;
  const wick      = Math.min(totalWick, maxWick);

  const upperRatio =
    (phase === 'surge' || phase === 'runner')            ? _rand(0.15, 0.40) :
    (phase === 'retrace' || phase === 'fading')          ? _rand(0.55, 0.85) :
                                                           _rand(0.30, 0.70);

  candle.high = Math.max(candle.high, candle.high + wick * upperRatio);
  candle.low  = Math.max(1e-14, Math.min(candle.low, candle.low - wick * (1 - upperRatio)));
}

// ── Volume ─────────────────────────────────────────────────────────────────────
function _candleVolume(prev, next, s) {
  const changePct = prev > 0 ? Math.abs((next - prev) / prev) : 0;
  const phaseBase =
    s.cyclePhase === 'surge'      ? Math.pow(Math.random(), 0.3) * 350 + Math.random() * 150 :
    s.cyclePhase === 'chop'       ? Math.pow(Math.random(), 0.4) * 300 + Math.random() * 120 :
    s.cyclePhase === 'resolution' ? Math.pow(Math.random(), 0.4) * 250 + Math.random() * 100 :
    s.cyclePhase === 'retrace'    ? Math.pow(Math.random(), 0.5) * 200 + Math.random() * 80  :
    s.cyclePhase === 'runner'     ? Math.pow(Math.random(), 0.3) * 400 + Math.random() * 200 :
    s.fadingOut                   ? Math.pow(Math.random(), 2.0) * 40  + Math.random() * 20  :
                                    Math.pow(Math.random(), 1.0) * 80  + Math.random() * 40;
  const moveAmp = changePct * 12_000 * (0.5 + Math.random() * 2.5);
  const spike   = Math.random() < 0.04 ? (5 + Math.random() * 15) : 1.0;
  return (phaseBase + moveAmp) * spike;
}

// ── Cycle sub-phases ───────────────────────────────────────────────────────────

// SURGE (0-59s): mostly green, working toward cycleTarget
function _surgeTick(s) {
  const p = s.price;
  const { rugMult, volScale, devDistributing } = _holderMods(s);
  if (Math.random() < 0.0008 * rugMult) return 1e-14;
  const r = Math.random();
  // Dev distributing = fewer pullbacks, stronger greens
  const pullbackThresh = devDistributing ? 0.07 : 0.12;
  const dojiThresh     = devDistributing ? 0.17 : 0.25;
  if (r < pullbackThresh) return Math.max(p * (1 - _rand(0.02, 0.09) * volScale), 1e-14);
  if (r < dojiThresh)     return p * (1 + _rand(-0.003, 0.006));
  const toTarget = Math.max(s.cycleTarget / p - 1, 0.01);
  const greenBase = _rand(0.005, Math.min(toTarget * 0.30, 0.10));
  const green     = greenBase * volScale * (devDistributing ? 1.20 : 1.0);
  return p * (1 + green);
}

// CHOP (60-119s): sideways fighting, big wicks both ways
function _chopTick(s) {
  const p = s.price;
  const { rugMult, volScale, devDumpChance, devDistributing } = _holderMods(s);
  if (Math.random() < 0.003 * rugMult) return 1e-14;
  // Bundled dev dump — sudden red candle from whale selling into chop
  if (devDumpChance > 0 && Math.random() < devDumpChance) {
    s.topHolderPct = Math.max(1, (s.topHolderPct ?? 50) - _rand(2, 6)); // dev sold some
    return Math.max(p * (1 - _rand(0.10, 0.25) * volScale), 1e-14);
  }
  const r = Math.random();
  // Dev distributing tilts chop slightly bullish
  const bigGreenThresh = devDistributing ? 0.18 : 0.13;
  if (r < bigGreenThresh) return p * (1 + _rand(0.04, 0.13) * volScale);
  if (r < 0.26) return Math.max(p * (1 - _rand(0.04, 0.11) * volScale), 1e-14);
  if (r < 0.42) return p * (1 + _rand(0.01, 0.04) * volScale);
  if (r < 0.58) return Math.max(p * (1 - _rand(0.01, 0.04) * volScale), 1e-14);
  return p * (1 + _rand(-0.006, 0.006));
}

// RESOLUTION (120-179s): final push or rollover
function _resolutionTick(s) {
  const p = s.price;
  const { rugMult } = _holderMods(s);
  if (Math.random() < 0.004 * rugMult) return 1e-14;
  const atTarget = p >= s.cycleTarget * 0.80;
  const r = Math.random();
  if (atTarget) {
    // Topping — choppy at the high
    if (r < 0.35) return p * (1 + _rand(0.003, 0.025));
    if (r < 0.70) return Math.max(p * (1 - _rand(0.01, 0.05)), 1e-14);
    return p * (1 + _rand(-0.004, 0.004));
  } else {
    // Still climbing
    if (r < 0.12) return Math.max(p * (1 - _rand(0.02, 0.07)), 1e-14);
    if (r < 0.22) return p * (1 + _rand(-0.003, 0.005));
    return p * (1 + _rand(0.008, 0.055));
  }
}

// RETRACE: falling back toward floor — rug risk is highest here
function _retraceTick(s) {
  const p = s.price;
  const { rugMult, volScale, devDumpChance } = _holderMods(s);
  s.retraceTick = (s.retraceTick ?? 0) + 1;

  // Rug: highest during retrace — concentration multiplies risk
  if (Math.random() < (0.007 + s.retraceTick * 0.00015) * rugMult) return 1e-14;

  // Bundled dev dump during retrace = accelerated fall
  if (devDumpChance > 0 && Math.random() < devDumpChance * 1.5) {
    s.topHolderPct = Math.max(1, (s.topHolderPct ?? 50) - _rand(3, 8));
    return Math.max(p * (1 - _rand(0.15, 0.30)), 1e-14);
  }

  const floor = s.cycleFloor;
  const mc    = p * TOTAL_SUPPLY;

  // Below floor → fading or new cycle from lower base
  if (p < floor * 0.92) {
    if (mc < FLOOR_MC_MIN) {
      s.fadingOut = true;
      s.fadeTick  = 0;
      return Math.max(p * (1 - _rand(0.01, 0.04)), 1e-14);
    }
    // Landed somewhere above dead zone — start new cycle from here
    s.cyclePhase  = 'surge';
    s.cycleTick   = 0;
    s.retraceTick = 0;
    s.cycleFloor  = p * 0.82;
    s.cycleTarget = p * (1 + _rand(0.20, 0.65));
    return p * (1 + _rand(-0.01, 0.02));
  }

  const distToFloor = (p - floor) / Math.max(p, 1e-14);

  // Near floor — bouncing/consolidating
  if (distToFloor < 0.05) {
    if (Math.random() < 0.35) {
      // Floor bounce → new surge
      s.cyclePhase  = 'surge';
      s.cycleTick   = 0;
      s.retraceTick = 0;
      s.cycleTarget = p * (1 + _rand(0.20, 0.70));
      return p * (1 + _rand(0.01, 0.04));
    }
    return Math.max(p * (1 - _rand(0.004, 0.018)), 1e-14);
  }

  // Still falling — high concentration makes it fall faster
  if (Math.random() < 0.11) return p * (1 + _rand(0.01, 0.05)); // dead cat bounce
  const fallSpeed = (0.012 + distToFloor * 0.09) * volScale;
  return Math.max(p * (1 - _rand(fallSpeed * 0.4, fallSpeed)), 1e-14);
}

// FADING: below floor, slow bleed to eventual rug
function _fadeTick(s) {
  const p = s.price;
  const { rugMult } = _holderMods(s);
  s.fadeTick = (s.fadeTick ?? 0) + 1;
  if (Math.random() < (0.005 + s.fadeTick * 0.0003) * rugMult) return 1e-14;
  if (Math.random() < 0.07) return p * (1 + _rand(0.01, 0.04)); // false hope
  return Math.max(p * (1 - _rand(0.005, 0.028)), 1e-14);
}

// RUNNER: continuous pump to $69K — rare, dramatic, unstoppable
function _runnerTick(s) {
  const p  = s.price;
  const mc = p * TOTAL_SUPPLY;
  if (Math.random() < 0.002) return 1e-14; // even runners can die

  // Near $69K — create drama (slowdown + big chop)
  if (mc > 45_000) {
    const progress = (mc - 45_000) / (MIGRATION_THRESHOLD - 45_000);
    const dampen   = 1 - progress * 0.75;
    const r = Math.random();
    if (r < 0.18) return Math.max(p * (1 - _rand(0.03, 0.12)), 1e-14);
    if (r < 0.35) return p * (1 + _rand(0.001, 0.012));
    return p * (1 + _rand(0.006, 0.035) * dampen);
  }

  // Normal runner — choppy uptrend
  const r = Math.random();
  if (r < 0.12) return Math.max(p * (1 - _rand(0.02, 0.08)), 1e-14);
  if (r < 0.22) return p * (1 + _rand(0.001, 0.008));
  return p * (1 + _rand(0.006, 0.038));
}

// End of 3-minute cycle — decide continue or retrace
function _endCycle(s) {
  const p        = s.price;
  const mc       = p * TOTAL_SUPPLY;
  const pumpedWell = p >= s.cycleTarget * 0.70;

  // Runner unlock: 3+ successful cycles, >$20K MC, 8% shot
  if (pumpedWell && s.successfulCycles >= 2 && mc > 20_000 && Math.random() < 0.08) {
    s.isRunner   = true;
    s.cyclePhase = 'runner';
    console.log(`🚀 RUNNER: ${s.ticker} at $${mc.toFixed(0)} MC after ${s.successfulCycles + 1} cycles`);
    return p * (1 + _rand(0.03, 0.10));
  }

  if (pumpedWell && Math.random() < 0.40) {
    // ── Continue: floor rises, new higher target ──
    s.successfulCycles++;
    s.cycleFloor  = p * _rand(0.38, 0.55);
    // Each successive pump is slightly smaller (early holders taking profit)
    const decay   = Math.max(0.15, 1 - (s.successfulCycles - 1) * 0.07);
    s.cycleTarget = p * (1 + _rand(0.20, 0.90) * decay);
    s.cycleTick   = 0;
    s.cyclePhase  = 'surge';
    return p * (1 + _rand(0.01, 0.04));
  } else {
    // ── Retrace: fall back to floor ──
    s.cyclePhase  = 'retrace';
    s.retraceTick = 0;
    s.cycleTick   = 0;
    return Math.max(p * (1 - _rand(0.02, 0.06)), 1e-14);
  }
}

// ── Main per-tick price function ───────────────────────────────────────────────
function _cycleTick(coinId, s) {
  if (s.fadingOut)                return _fadeTick(s);
  if (s.isRunner)                 return _runnerTick(s);
  if (s.cyclePhase === 'retrace') return _retraceTick(s);

  const ct = s.cycleTick;
  s.cycleTick++;

  if (ct < 60)  return _surgeTick(s);
  if (ct < 120) return _chopTick(s);
  if (ct < 180) return _resolutionTick(s);

  // Cycle complete
  s.cycleTick = 0;
  return _endCycle(s);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
function _bootstrap(coin) {
  const startPrice   = coin.currentPrice || (START_MC / TOTAL_SUPPLY);
  const firstPumpPct = _rand(0.25, 2.00); // 25-200% first cycle target
  const cycleTarget  = startPrice * (1 + firstPumpPct);

  const isBundled    = Math.random() < 0.20;
  const topHolderPct = isBundled
    ? 60 + Math.random() * 30
    : 5  + Math.random() * 25;

  state[coin.id] = {
    price:            startPrice,
    startPrice,
    ath:              startPrice,
    createdAt:        coin.createdAt ?? new Date(),
    migrated:         coin.migrated ?? false,
    history:          [],
    name:             coin.name,
    ticker:           coin.ticker,
    baseRugProb:      coin.rugProbability ?? 0.007,

    // Cycle state
    cycleTick:        0,
    cyclePhase:       'surge',
    cycleTarget,
    cycleFloor:       startPrice,       // floor = $2K MC start
    successfulCycles: 0,
    isRunner:         false,
    fadingOut:        false,
    fadeTick:         0,
    retraceTick:      0,

    // S/R for post-migration
    resistanceLevel:  null,
    supportLevel:     null,
    retestCount:      0,

    holderCount:      isBundled
      ? Math.floor(80 + Math.random() * 300)
      : Math.floor(1 + Math.random() * 2),
    isBundled,
    topHolderPct,
    topHolderPctPrev: topHolderPct,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────
async function init() {
  const coins = await prisma.coin.findMany({ where: { isActive: true } });
  for (const coin of coins) {
    _bootstrap(coin);
    state[coin.id].price      = coin.currentPrice;
    state[coin.id].startPrice = coin.currentPrice;
    state[coin.id].ath        = coin.currentPrice;
    state[coin.id].createdAt  = coin.createdAt ?? new Date();
    // Restore migration state
    if (coin.migrated) {
      state[coin.id].isRunner   = false;
      state[coin.id].cyclePhase = 'retrace'; // post-migration coins retrace on restart
    }
  }
  initialized = true;
  console.log(`💹 Price engine v4 initialized — ${coins.length} coins loaded`);
}

function registerCoin(coin) {
  if (state[coin.id]) return;
  _bootstrap(coin);
  state[coin.id].price      = coin.currentPrice;
  state[coin.id].startPrice = coin.currentPrice;
  state[coin.id].ath        = coin.currentPrice;
  state[coin.id].createdAt  = coin.createdAt ?? new Date();
  console.log(`🪙 New coin: ${coin.name} (${coin.ticker}) | target +${((state[coin.id].cycleTarget / coin.currentPrice - 1) * 100).toFixed(0)}%`);
}

function removeCoin(coinId)      { delete state[coinId]; }
function getCurrentPrice(coinId) { return state[coinId]?.price ?? null; }
function getHistory(coinId)      { return state[coinId]?.history ?? []; }
function getAllPrices()           { return Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.price])); }
function getHolderCount(coinId)  { return state[coinId]?.holderCount ?? 1; }
function getTopHolderPct(coinId) { return state[coinId]?.topHolderPct ?? 50; }
function getIsBundled(coinId)    { return state[coinId]?.isBundled ?? false; }
function getCreatedAt(coinId)    { return state[coinId]?.createdAt ?? null; }
function getIo()                 { return io; }

/**
 * Apply immediate price impact from a user trade.
 * Buying during a retrace can bounce a coin back to surge.
 */
function applyTradeImpact(coinId, impactSol, isBuy) {
  const s = state[coinId];
  if (!s) return;

  const marketCap = s.price * TOTAL_SUPPLY;
  const rawImpact = Math.abs(impactSol) / marketCap * 150;
  const impactPct = Math.min(rawImpact, 5.0);

  if (isBuy) {
    s.price = s.price * (1 + impactPct);
    if (s.price > s.ath) s.ath = s.price;
    s.lastUserBuyTick = tickCount;
    // Big buy during retrace/fading can reverse a coin's fate
    if (impactPct > 0.08 && (s.cyclePhase === 'retrace' || s.fadingOut)) {
      s.fadingOut   = false;
      s.fadeTick    = 0;
      s.cyclePhase  = 'surge';
      s.cycleTick   = 0;
      s.retraceTick = 0;
      s.cycleTarget = s.price * (1 + _rand(0.20, 0.60));
      s.cycleFloor  = s.price * 0.75;
    }
  } else {
    s.price = Math.max(s.price * (1 - impactPct), 1e-14);
    // Large sell into a surging coin drops it back to chop
    if (impactPct > 0.10 && s.cyclePhase === 'surge') {
      s.cyclePhase = 'chop';
    }
  }

  const history = s.history;
  if (history.length > 0) {
    const lc      = history[history.length - 1];
    lc.high       = Math.max(lc.high, s.price);
    lc.low        = Math.min(lc.low, s.price);
    lc.close      = s.price;
    lc.volume    += Math.abs(impactPct) * 800;
  }

  if (io) {
    const newMC    = s.price * TOTAL_SUPPLY;
    const lastCandle = s.history.length > 0 ? s.history[s.history.length - 1] : null;
    io.emit('price_update', {
      [coinId]: { id: coinId, price: s.price, marketCap: newMC, holderCount: s.holderCount, candle: lastCandle },
    });
  }
  prisma.coin.update({ where: { id: coinId }, data: { currentPrice: s.price } }).catch(() => {});
}

// ── Rug execution ──────────────────────────────────────────────────────────────
async function _rugCoin(coinId, finalPrice) {
  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) { removeCoin(coinId); return; }
    const s = state[coinId];
    console.log(`💀 RUG: ${coin.name} (${coin.ticker}) [${s?.cyclePhase ?? '?'}] $${finalPrice.toExponential(2)}`);

    const holdings = await prisma.holding.findMany({ where: { coinId, amount: { gt: 0 } } });

    await prisma.coin.update({ where: { id: coinId }, data: { isActive: false } });
    if (io) io.emit('coin_deleted', { coinId, name: coin.name, ticker: coin.ticker, finalPrice });
    removeCoin(coinId);

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

    await prisma.holding.deleteMany({ where: { coinId } });
  } catch (err) {
    console.error(`Error rugging coin ${coinId}:`, err.message);
    removeCoin(coinId);
  }
}

// ── Post-migration S/R retest (for migrated coins) ────────────────────────────
// Migrated coins enter a ranging market with support/resistance levels.
function _postMigrationTick(s) {
  const p = s.price;

  if (!s.resistanceLevel || !s.supportLevel) {
    // No levels set — default bleed
    if (Math.random() < 0.004) return 1e-14;
    const dir = Math.random() < 0.55 ? -1 : 1;
    return Math.max(p * (1 + dir * _rand(0.005, 0.030)), 1e-14);
  }

  const nearRes  = p >= s.resistanceLevel * 0.92;
  const nearSup  = p <= s.supportLevel   * 1.10;

  if (nearRes) {
    s.retestCount = (s.retestCount ?? 0) + 1;
    const rejectChance = Math.min(0.80, 0.50 + s.retestCount * 0.08);
    if (Math.random() < rejectChance) {
      return Math.max(p * (1 - _rand(0.04, 0.14)), 1e-14);
    }
    s.resistanceLevel = p * (1 + _rand(0.08, 0.20));
    return p * (1 + _rand(0.03, 0.10));
  }

  if (nearSup) {
    const bounceChance = Math.max(0.15, 0.65 - (s.retestCount ?? 0) * 0.10);
    if (Math.random() < bounceChance) {
      return p * (1 + _rand(0.06, 0.22));
    }
    s.resistanceLevel = s.supportLevel;
    s.supportLevel    = p * (1 - _rand(0.20, 0.35));
    s.retestCount     = 0;
    return Math.max(p * (1 - _rand(0.08, 0.20)), 1e-14);
  }

  if (Math.random() < 0.003) return 1e-14;
  const dir = Math.random() < 0.52 ? -1 : 1;
  return Math.max(p * (1 + dir * _rand(0.008, 0.038)), 1e-14);
}

// ── Tick ───────────────────────────────────────────────────────────────────────
async function tick() {
  if (!initialized) return;
  tickCount++;

  const updates = {};
  const rugged  = [];
  const nowSec  = Math.floor(Date.now() / 5000) * 5; // 5-second candles

  for (const [coinId, s] of Object.entries(state)) {
    const prev = s.price;

    // Route to correct price function
    let next;
    if (s.migrated) {
      next = _postMigrationTick(s);
    } else {
      next = _cycleTick(coinId, s);
    }

    s.price = Math.max(next, 1e-14);
    next    = s.price;
    if (next > s.ath) s.ath = next;

    // ── Candle ──
    const candles    = s.history;
    const lastCandle = candles[candles.length - 1];
    const phase      = s.fadingOut ? 'fading' : s.cyclePhase;

    if (lastCandle && lastCandle.time === nowSec) {
      lastCandle.close  = next;
      lastCandle.volume += _candleVolume(prev, next, s);
      const tmp = { open: lastCandle.open, close: next, high: Math.max(lastCandle.high, next), low: Math.min(lastCandle.low, next) };
      _addWicks(tmp, phase);
      lastCandle.high = Math.max(lastCandle.high, tmp.high);
      lastCandle.low  = Math.min(lastCandle.low,  tmp.low);
    } else {
      const nc = {
        time:   nowSec,
        open:   prev,
        high:   Math.max(prev, next),
        low:    Math.min(prev, next),
        close:  next,
        volume: _candleVolume(prev, next, s),
      };
      _addWicks(nc, phase);
      candles.push(nc);
      if (candles.length > MAX_CANDLES) candles.shift();
    }

    const marketCap = next * TOTAL_SUPPLY;

    // ── Holder count ──
    const mcInK         = marketCap / 1000;
    const targetHolders = Math.max(1, Math.floor(10 * Math.pow(mcInK, 0.75) * (0.85 + Math.random() * 0.30)));
    const pctChange     = prev > 0 ? (next - prev) / prev : 0;
    const convRate      = pctChange < -0.05 ? 0.25 : 0.12;
    s.holderCount = Math.max(1, Math.round(s.holderCount + (targetHolders - s.holderCount) * convRate));

    // ── Top holder % ──
    s.topHolderPctPrev = s.topHolderPct ?? (s.isBundled ? 75 : 25);
    if (s.topHolderPct == null) s.topHolderPct = s.isBundled ? 75 : 25;
    if (pctChange > 0.03 && s.topHolderPct > 1) {
      const dilution = s.isBundled ? 0.05 : 0.30;
      s.topHolderPct = Math.max(1, s.topHolderPct - pctChange * dilution * 100);
    }
    // Slow natural concentration decay even when flat (whales slowly sell)
    if (s.topHolderPct > 10 && Math.random() < 0.02) {
      s.topHolderPct = Math.max(1, s.topHolderPct - _rand(0.05, 0.20));
    }

    updates[coinId] = {
      id: coinId, price: next, marketCap,
      holderCount:  s.holderCount,
      topHolderPct: parseFloat((s.topHolderPct ?? 50).toFixed(1)),
      isBundled:    s.isBundled ?? false,
      candle:       candles[candles.length - 1],
    };

    // ── Migration check ──
    if (!s.migrated && marketCap >= MIGRATION_THRESHOLD) {
      s.migrated        = true;
      s.resistanceLevel = next;
      s.supportLevel    = next * 0.65;
      s.retestCount     = 0;
      prisma.coin.update({ where: { id: coinId }, data: { migrated: true, migratedAt: new Date() } }).catch(() => {});
      if (io) io.emit('coin_migrated', { coinId, name: s.name, ticker: s.ticker, marketCap });
    }

    if (next <= RUG_THRESHOLD) rugged.push({ coinId, finalPrice: next });
  }

  if (io && Object.keys(updates).length) io.emit('price_update', updates);

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
      console.log('💹 Price engine v4 started (cycle-based model)');
    })
    .catch((err) => console.error('Price engine init failed:', err));
}

function stop() {
  if (interval) clearInterval(interval);
  initialized = false;
  console.log('💹 Price engine stopped');
}

module.exports = {
  start, stop,
  registerCoin, removeCoin,
  getCurrentPrice, getHistory, getAllPrices, getCreatedAt, getHolderCount, getTopHolderPct, getIsBundled, applyTradeImpact,
  getIo,
};
