/**
 * tokenGenerator.js
 *
 * Spawns 1 new random memecoin into the DB every 30 seconds.
 * Notifies clients via Socket.io `coin_added` and registers the coin
 * with the price engine so ticks start immediately.
 */

const prisma      = require('../lib/prisma');
const priceEngine = require('./priceEngine');

const SPAWN_INTERVAL_MS = 10_000; // every 10 seconds

// ── Word banks ─────────────────────────────────────────────────────────────────
const ADJECTIVES = [
  // internet / degen culture
  'Skibidi', 'Sigma', 'Giga', 'Based', 'Rekt', 'Ngmi', 'Wagmi', 'Yolo',
  'Fomo', 'Degen', 'Gigachad', 'Bonk', 'Smol', 'Thicc', 'Turbo',
  'Goated', 'Cooked', 'Banger', 'Glazed', 'Bricked', 'Cozy', 'Cursed',
  'Feral', 'Unhinged', 'Menacing', 'Sweaty', 'Sleepy', 'Goofy', 'Sussy',
  'Fried', 'Crispy', 'Soggy', 'Chunky', 'Crusty', 'Stinky', 'Goblin',
  'Boomer', 'Doomer', 'Zoomer', 'Bloated', 'Haunted', 'Cosmic', 'Omega',
  'Ultra', 'Mega', 'Hyper', 'Plump', 'Wobbly', 'Spooky', 'Laser',
  'Diamond', 'Quantum', 'Atomic', 'Galaxy', 'Lurking', 'Sneaky', 'Final',
];

const NOUNS = [
  // animals (real meme energy)
  'Pepe', 'Doge', 'Shib', 'Floki', 'Bonk', 'Frog', 'Toad', 'Cat',
  'Dog', 'Ape', 'Chimp', 'Rat', 'Hamster', 'Capybara', 'Raccoon',
  'Axolotl', 'Narwhal', 'Platypus', 'Ferret', 'Iguana', 'Crab',
  'Shrimp', 'Goat', 'Sloth', 'Panda', 'Yeti', 'Bunny', 'Duck',
  // crypto / degen slang
  'Wojak', 'Chad', 'Karen', 'Bobo', 'Mumu', 'Goblin', 'Clown', 'Wizard',
  'Rug', 'Pump', 'Dump', 'Bag', 'Shill', 'Gem', 'Whale', 'Degen',
  'Lambo', 'Tendies', 'Hopium', 'Copium', 'Ngmi', 'Rekt', 'Moon',
  // random chaos
  'Corn', 'Sock', 'Spoon', 'Toaster', 'Crayon', 'Helmet', 'Potato',
  'Noodle', 'Waffle', 'Taco', 'Burrito', 'Nugget', 'Cheeto', 'Donut',
];

const SUFFIXES = [
  'Inu', 'Coin', 'Moon', 'X', 'Rug', 'Token', 'Dao', 'Cash', 'Ai',
  'Swap', 'Gang', 'Club', 'Labs', 'Base', 'Verse', 'Elon', 'Gpt',
  'Pro', '420', '69', '2049', 'Turbo', 'Ultra', 'Max', 'Plus', 'Go',
  'Finance', 'Protocol', 'Network', 'Chain', 'World', 'Floki',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateName() {
  const r = Math.random();
  if (r < 0.10) return `${rand(NOUNS)}${rand(NOUNS)}${rand(NOUNS)}`; // e.g. PepeDogeCorn
  if (r < 0.20) return `${rand(ADJECTIVES)}${rand(NOUNS)}${rand(NOUNS)}`; // e.g. GoatedCapybaraRug
  if (r < 0.30) return `${rand(NOUNS)}${rand(SUFFIXES)}`; // e.g. CornInu
  if (r < 0.40) return `${rand(ADJECTIVES)}${rand(ADJECTIVES)}${rand(NOUNS)}`; // e.g. SkibidiGoatedDoge
  return `${rand(ADJECTIVES)}${rand(NOUNS)}${rand(SUFFIXES)}`; // e.g. FerRetGpt69
}

/**
 * Derive a ticker from the coin name.
 * Strategy: grab all capital letters (camelCase boundaries), up to 5 chars.
 * Fall back to first 4 chars uppercased if too short.
 */
function nameToTickerBase(name) {
  const caps = name.match(/[A-Z]/g) ?? [];
  let base   = caps.join('').slice(0, 5);
  if (base.length < 3) base = name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  return base.toUpperCase();
}

/** Resolve ticker uniqueness — append a number suffix if colliding. */
async function uniqueTicker(base) {
  let ticker  = base;
  let attempt = 0;
  while (true) {
    const existing = await prisma.coin.findUnique({ where: { ticker } });
    if (!existing) return ticker;
    attempt++;
    ticker = base.slice(0, 4) + attempt; // e.g. SDI → SDI1 → SDI2
  }
}

// Starting MC distribution:
// - 80% start exactly at $2K MC
// - 20% start randomly between $2K and $10K MC
function randomStartingPrice() {
  const startingMc = Math.random() < 0.80
    ? 2_000
    : 2_000 + Math.random() * 8_000;
  return startingMc / 1_000_000_000;
}

/**
 * Each coin's base rug probability sits between 0.5% and 1% per tick.
 * The age multiplier in priceEngine then scales this up or down.
 * Stored in DB for reference but the engine reads it at bootstrap time.
 */
function randomRugProbability() {
  return 0.005 + Math.random() * 0.005; // 0.5% – 1.0%
}

// 60% bleeders, 30% pumpers, 10% runners
function randomFate() {
  const r = Math.random();
  if (r < 0.60) return 'bleeder';
  if (r < 0.90) return 'pumper';
  return 'runner';
}

// ── Spawn ──────────────────────────────────────────────────────────────────────

async function spawnCoin() {
  try {
    const name           = generateName();
    const tickerBase     = nameToTickerBase(name);
    const ticker         = await uniqueTicker(tickerBase);
    const currentPrice   = randomStartingPrice();
    const rugProbability = randomRugProbability();
    const marketCap      = currentPrice * 1_000_000_000;

    const coin = await prisma.coin.create({
      data: {
        name,
        ticker,
        currentPrice,
        marketCap,
        rugProbability,
        isActive: true,
      },
    });

    const fate = randomFate();

    // Register with price engine — ticks start immediately
    priceEngine.registerCoin(coin, fate);

    // Broadcast to all connected clients
    const io = priceEngine.getIo();
    if (io) {
      io.emit('coin_added', {
        id:            coin.id,
        name:          coin.name,
        ticker:        coin.ticker,
        currentPrice:  coin.currentPrice,
        marketCap:     coin.currentPrice * 1_000_000_000,
        rugProbability: coin.rugProbability,
        createdAt:     coin.createdAt,
        change24h:     0,
      });
    }

    const rugPct = (rugProbability * 100).toFixed(2);
    console.log(`🪙 New coin: ${name} (${ticker}) - fate: ${fate}`);
    console.log(`🪙  Spawned: ${name} (${ticker}) @ $${currentPrice.toExponential(3)} | rug base=${rugPct}%/tick`);

    return coin;
  } catch (err) {
    console.error('tokenGenerator spawn error:', err.message);
    return null;
  }
}

/**
 * Spawn a coin with explicit overrides — used by tweetService for celebrity/scam coins.
 */
async function spawnCoinWithOverrides(overrides = {}) {
  try {
    const name = overrides.name || generateName();
    const tickerBase = overrides.ticker
      ? overrides.ticker.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)
      : nameToTickerBase(name);
    const ticker         = await uniqueTicker(tickerBase);
    // Celebrity official coins spawn near migration; scam copies spawn mid-range
    const isCeleb    = overrides.isCelebrityCoin === true;
    const isOfficial = overrides.isOfficial === true;
    const isScam     = overrides.isOfficial === false && !!overrides.tweetMention;
    const startMc    = isCeleb && isOfficial
      ? 20_000 + Math.random() * 30_000   // $20K–$50K — near migration already
      : isScam
      ? 5_000  + Math.random() * 15_000   // $5K–$20K — visible but will rug
      : null;                             // normal coins use standard pricing
    const currentPrice   = startMc ? startMc / 1_000_000_000 : randomStartingPrice();
    const rugProbability = isScam ? 0.012 + Math.random() * 0.008 : randomRugProbability();
    const marketCap      = currentPrice * 1_000_000_000;

    const coin = await prisma.coin.create({
      data: {
        name,
        ticker,
        currentPrice,
        marketCap,
        rugProbability,
        isActive:     true,
        tweetMention: overrides.tweetMention ?? null,
        isOfficial:   overrides.isOfficial   ?? false,
      },
    });

    const fate    = overrides.fate    ?? randomFate();
    const options = {
      ...(overrides.isCelebrityCoin ? { isCelebrityCoin: true } : {}),
      isOfficial:   overrides.isOfficial   ?? null,
      tweetMention: overrides.tweetMention ?? null,
    };

    // Register with price engine
    priceEngine.registerCoin(coin, fate, options);

    // Broadcast
    const io = priceEngine.getIo();
    if (io) {
      io.emit('coin_added', {
        id:           coin.id,
        name:         coin.name,
        ticker:       coin.ticker,
        currentPrice: coin.currentPrice,
        marketCap:    coin.currentPrice * 1_000_000_000,
        rugProbability: coin.rugProbability,
        createdAt:    coin.createdAt,
        change24h:    0,
        tweetMention: coin.tweetMention,
        isOfficial:   coin.isOfficial,
      });
    }

    console.log(`🐦 Tweet-spawned coin: ${name} (${ticker}) [${fate}] official=${overrides.isOfficial ?? false}`);
    return coin;
  } catch (err) {
    console.error('tokenGenerator spawnCoinWithOverrides error:', err.message);
    return null;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

const ACTIVE_POPULATION_TARGET = 150; // maintain a full market, not just startup fill
const MAX_BULK_SPAWN_PER_CYCLE = 10; // avoid slamming Postgres connection limits
let bulkSpawning = false;

async function _bulkSpawn() {
  if (bulkSpawning) return;
  bulkSpawning = true;
  try {
    const count = await prisma.coin.count({ where: { isActive: true } });
    const needed = Math.max(0, ACTIVE_POPULATION_TARGET - count);
    const toSpawn = Math.min(needed, MAX_BULK_SPAWN_PER_CYCLE);
    if (toSpawn === 0) return;
    console.log(`🏭  Bulk spawn: ${toSpawn}/${needed} coins toward ${ACTIVE_POPULATION_TARGET} (currently ${count})`);
    for (let i = 0; i < toSpawn; i++) {
      await spawnCoin();
      // stagger DB writes so Railway/Postgres doesn't hit connection limits
      await new Promise(r => setTimeout(r, 750));
    }
    console.log(`🏭  Bulk spawn cycle complete — ${toSpawn} coins added`);
  } catch (err) {
    console.error('Bulk spawn error:', err.message);
  } finally {
    bulkSpawning = false;
  }
}

let interval = null;
let running  = false;

function start() {
  if (running) return;
  running  = true;
  // Populate immediately, then keep refilling every 10s if active count falls.
  _bulkSpawn();
  interval = setInterval(_bulkSpawn, SPAWN_INTERVAL_MS);
  console.log(`🏭  Token generator started — maintaining ${ACTIVE_POPULATION_TARGET} active coins`);
}

function stop() {
  running = false;
  if (interval) clearInterval(interval);
}

module.exports = { start, stop, spawnCoin, spawnCoinWithOverrides };
