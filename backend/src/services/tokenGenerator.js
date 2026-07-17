/**
 * tokenGenerator.js
 *
 * Spawns 1 new random memecoin into the DB every 30 seconds.
 * Notifies clients via Socket.io `coin_added` and registers the coin
 * with the price engine so ticks start immediately.
 */

const prisma      = require('../lib/prisma');
const priceEngine = require('./priceEngine');

const SPAWN_INTERVAL_MS = 30_000; // exactly 30 seconds

// ── Word banks ─────────────────────────────────────────────────────────────────
const ADJECTIVES = [
  'Sleepy', 'Turbo', 'Giga', 'Noodle', 'Skibidi', 'Sigma', 'Gigachad',
  'Rekt', 'Smooth', 'Degen', 'Based', 'Cozy', 'Feral', 'Chad', 'Maxi',
  'Plump', 'Crispy', 'Wobbly', 'Galaxy', 'Atomic', 'Cursed', 'Boomer',
  'Ultra', 'Hyper', 'Stinky', 'Chunky', 'Fluffy', 'Soggy', 'Mega',
  'Zesty', 'Spooky', 'Yolo', 'Diamond', 'Laser', 'Quantum', 'Cosmic',
  'Thicc', 'Goblin', 'Sneaky', 'Crusty', 'Sweaty', 'Zoomer', 'Banger',
  'Grumpy', 'Fomo', 'Rogue', 'Lurking', 'Hidden', 'Final', 'Omega',
];

const NOUNS = [
  'Dog', 'Ape', 'Brain', 'Frog', 'Pepe', 'Cat', 'Rat', 'Goat', 'Monk',
  'Clown', 'Goblin', 'Shrimp', 'Toad', 'Wizard', 'Sloth', 'Panda',
  'Hamster', 'Whale', 'Degen', 'Rug', 'Chad', 'Karen', 'Boomer',
  'Rocket', 'Lambo', 'Gem', 'Shill', 'Bag', 'Pump', 'Dump',
  'Sniper', 'Pixel', 'Duck', 'Chimp', 'Yeti', 'Bunny', 'Crab',
  'Narwhal', 'Capybara', 'Raccoon', 'Ferret', 'Iguana', 'Axolotl',
  'Wojak', 'Pepe', 'Doomer', 'Coomer', 'Bobo', 'Mumu',
];

const SUFFIXES = [
  'Inu', 'Coin', 'Moon', 'X', 'Rug', 'Token', 'Finance', 'Dao',
  'Protocol', 'Cash', 'Ai', 'Swap', 'World', 'Gang', 'Club',
  'Network', 'Labs', 'Base', 'Chain', 'Verse', 'Floki', 'Elon',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateName() {
  // ~20% chance of triple-word name for spice
  if (Math.random() < 0.2) {
    return `${rand(ADJECTIVES)}${rand(NOUNS)}${rand(NOUNS)}`;
  }
  return `${rand(ADJECTIVES)}${rand(NOUNS)}${rand(SUFFIXES)}`;
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

/**
 * Log-uniform random starting price between $0.000001 and $0.01.
 * This mirrors the range real memecoins launch at — mostly micro-cap junk.
 */
function randomStartingPrice() {
  const logMin = Math.log(0.000001);
  const logMax = Math.log(0.01);
  return Math.exp(logMin + Math.random() * (logMax - logMin));
}

/**
 * Each coin's base rug probability sits between 0.5% and 1% per tick.
 * The age multiplier in priceEngine then scales this up or down.
 * Stored in DB for reference but the engine reads it at bootstrap time.
 */
function randomRugProbability() {
  return 0.005 + Math.random() * 0.005; // 0.5% – 1.0%
}

// ── Spawn ──────────────────────────────────────────────────────────────────────

async function spawnCoin() {
  try {
    const name           = generateName();
    const tickerBase     = nameToTickerBase(name);
    const ticker         = await uniqueTicker(tickerBase);
    const currentPrice   = randomStartingPrice();
    const rugProbability = randomRugProbability();
    const marketCap      = currentPrice * (1_000_000 + Math.random() * 9_000_000);

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

    // Register with price engine — ticks start immediately
    priceEngine.registerCoin(coin);

    // Broadcast to all connected clients
    const io = priceEngine.getIo();
    if (io) {
      io.emit('coin_added', {
        id:            coin.id,
        name:          coin.name,
        ticker:        coin.ticker,
        currentPrice:  coin.currentPrice,
        marketCap:     coin.marketCap,
        rugProbability: coin.rugProbability,
        change24h:     0,
      });
    }

    const rugPct = (rugProbability * 100).toFixed(2);
    console.log(
      `🪙  Spawned: ${name} (${ticker}) @ $${currentPrice.toExponential(3)} | rug base=${rugPct}%/tick`
    );

    return coin;
  } catch (err) {
    console.error('tokenGenerator spawn error:', err.message);
    return null;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

let interval = null;
let running  = false;

function start() {
  if (running) return;
  running  = true;
  interval = setInterval(spawnCoin, SPAWN_INTERVAL_MS);
  console.log(`🏭  Token generator started — 1 coin every ${SPAWN_INTERVAL_MS / 1000}s`);
}

function stop() {
  running = false;
  if (interval) clearInterval(interval);
}

module.exports = { start, stop, spawnCoin };
