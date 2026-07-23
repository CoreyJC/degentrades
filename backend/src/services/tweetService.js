/**
 * tweetService.js
 *
 * Simulated Twitter-style feed for DegenTrades.
 * - Celebrity accounts spawn official coins + lookalike scams every 8-20 min
 * - Small accounts shill/FUD existing coins every 20-45 seconds
 * - Emits `tweet_added` socket events in real-time
 */

const { randomUUID } = require('crypto');

// ── Celebrity accounts ─────────────────────────────────────────────────────────
const CELEBRITY_ACCOUNTS = [
  { handle: '@realDonaldTrump', name: 'Donald J. Trump', verified: true, followers: '18.2M', avatar: '🇺🇸', coinTheme: 'TRUMP', coinNames: ['TrumpX', 'TrumpMaga', 'TrumpInu', 'Maga45'] },
  { handle: '@elonmusk', name: 'Elon Musk', verified: true, followers: '220M', avatar: '🚀', coinTheme: 'GROK', coinNames: ['Grok2', 'XCoin', 'ElonInu', 'DogeX'] },
  { handle: '@kanyewest', name: 'Ye', verified: true, followers: '32M', avatar: '🎤', coinTheme: 'YE', coinNames: ['YeezyX', 'YeCoin', 'YeezyInu', 'Donda'] },
  { handle: '@snoopdogg', name: 'Snoop Dogg', verified: true, followers: '21M', avatar: '🐕', coinTheme: 'DOGG', coinNames: ['Dogg2', 'SnoopX', 'DoggInu', 'GinAndJuice'] },
  { handle: '@parishilton', name: 'Paris Hilton', verified: true, followers: '17M', avatar: '💅', coinTheme: 'PARIS', coinNames: ['HiltonX', 'ParisInu', 'HotDog', 'Simple2'] },
  { handle: '@mcafee', name: 'John McAfee', verified: false, followers: '1.1M', avatar: '🔫', coinTheme: 'MCAF', coinNames: ['McafeeX', 'McafeeInu', 'JohnX', 'Antivirus'] },
];

// ── Small degen/KOL accounts ──────────────────────────────────────────────────
const SMALL_ACCOUNTS = [
  { handle: '@cryptowhale99', name: 'CryptoWhale', verified: false, followers: '42.1K', avatar: '🐋' },
  { handle: '@degen_lord', name: 'Degen Lord', verified: false, followers: '12.8K', avatar: '🎰' },
  { handle: '@pumpdotfun_fan', name: 'PumpFan', verified: false, followers: '8.3K', avatar: '📈' },
  { handle: '@solana_ape', name: 'SolanaApe', verified: false, followers: '31.2K', avatar: '🦍' },
  { handle: '@rugged_again', name: 'RuggedAgain', verified: false, followers: '5.1K', avatar: '💀' },
  { handle: '@ngmi_forever', name: 'NGMI Forever', verified: false, followers: '2.9K', avatar: '😭' },
  { handle: '@wagmi_bro', name: 'WagmiBro', verified: false, followers: '15.6K', avatar: '🤝' },
  { handle: '@moonmath', name: 'Moon Math', verified: false, followers: '22.4K', avatar: '🌕' },
  { handle: '@alphasniffer', name: 'AlphaSniffer', verified: false, followers: '9.7K', avatar: '👃' },
  { handle: '@copium_dealer', name: 'Copium Dealer', verified: false, followers: '4.4K', avatar: '💊' },
  { handle: '@chart_goblin', name: 'Chart Goblin', verified: false, followers: '18.1K', avatar: '👺' },
  { handle: '@defi_rekt', name: 'DeFi Rekt', verified: false, followers: '7.2K', avatar: '🔥' },
  { handle: '@lambo_soon', name: 'Lambo Soon', verified: false, followers: '11.9K', avatar: '🏎️' },
  { handle: '@based_anon', name: 'Based Anon', verified: false, followers: '33.7K', avatar: '🎭' },
  { handle: '@fomo_maximus', name: 'FOMO Maximus', verified: false, followers: '6.5K', avatar: '😱' },
  { handle: '@sol_maxi', name: 'SOL Maxi', verified: false, followers: '19.3K', avatar: '☀️' },
  { handle: '@ponzi_pete', name: 'Ponzi Pete', verified: false, followers: '3.8K', avatar: '🤡' },
  { handle: '@gm_frens', name: 'gm frens', verified: false, followers: '28.6K', avatar: '🌅' },
  { handle: '@wen_lambo', name: 'Wen Lambo', verified: false, followers: '14.2K', avatar: '🔑' },
  { handle: '@exit_liquidity', name: 'Exit Liquidity', verified: false, followers: '21.1K', avatar: '🚪' },
  { handle: '@nfa_noob', name: 'NFA Noob', verified: false, followers: '5.9K', avatar: '🤷' },
  { handle: '@diamond_paws', name: 'Diamond Paws', verified: false, followers: '37.4K', avatar: '💎' },
  { handle: '@bear_trap_dan', name: 'Bear Trap Dan', verified: false, followers: '8.8K', avatar: '🐻' },
  { handle: '@anon_caller', name: 'Anon Caller', verified: false, followers: '16.7K', avatar: '📞' },
  { handle: '@mev_bot_real', name: 'MEV Bot (Real)', verified: false, followers: '1.2K', avatar: '🤖' },
  { handle: '@sol_detective', name: 'SOL Detective', verified: false, followers: '44.9K', avatar: '🔍' },
  { handle: '@rug_hunter', name: 'Rug Hunter', verified: false, followers: '29.5K', avatar: '🕵️' },
  { handle: '@this_is_fine', name: 'This Is Fine', verified: false, followers: '7.6K', avatar: '🐕‍🔥' },
  { handle: '@probably_nothing', name: 'Probably Nothing', verified: false, followers: '52.3K', avatar: '👀' },
  { handle: '@degentrades_og', name: 'DegenTrades OG', verified: false, followers: '3.1K', avatar: '🦾' },
];

// ── Tweet templates ────────────────────────────────────────────────────────────
const LAUNCH_TWEETS = [
  'Just launched $[COIN] 🚀 This is the REAL one. Get in now.',
  'We\'re launching $[COIN] today. The future is ours. 🇺🇸🚀',
  '$[COIN] is LIVE. This one is going to the moon and back. 🌕',
  'Officially launching $[COIN] right now. Don\'t miss this one. 🔥',
  'I\'ve been working on $[COIN] for months. It\'s finally here. 🚀',
  '$[COIN] just went live. This is the real deal, not a scam. 💯',
  'BREAKING: $[COIN] is now available. Get in early. 🎯',
  'The wait is over. $[COIN] launches TODAY. 🏆',
];

const SHILL_TWEETS = [
  'NGL $[COIN] is looking juicy rn 👀',
  'Just aped into $[COIN], chart looking clean af 📈',
  '$[COIN] about to go parabolic fr fr 🚀',
  'Bro I just found $[COIN] and it\'s undervalued as hell 💎',
  '$[COIN] low key slept on. Not gonna be for long 👀',
  'Aping $[COIN] rn. Chart is insane. NFA obviously 🎯',
  '$[COIN] is the gem of the day imo. Do your own research',
  'Accumulating $[COIN] heavily. This is my top call 📊',
  'Strong buy on $[COIN] at these levels. Chart don\'t lie 📈',
  '$[COIN] looking like a 10x from here easy 🔥',
];

const FUD_TWEETS = [
  '$[COIN] dev wallet moving... 👀 be careful',
  'heard the $[COIN] team is about to dump',
  '$[COIN] looking sus rn. Check the on-chain data 🔍',
  'WARNING: $[COIN] dev has been seen selling 🚨',
  '$[COIN] honeypot? Someone just tried to sell and couldn\'t 😬',
  'The $[COIN] chart is giving rug vibes ngl 💀',
  'be careful with $[COIN] — smells like a coordinated dump incoming',
  '$[COIN] liquidity looking thin... not a good sign',
];

const GENERAL_TWEETS = [
  'this market is absolutely cooked',
  'wen lambo',
  'just rugged again 💀 ngmi',
  'gm degenerates 🌅',
  'the meta rn is just aping into everything and praying',
  'another day another rug. staying ngmi forever fr',
  'why do i keep doing this to myself lmao',
  'WAGMI (we are all gonna make it) eventually right?? right??',
  'the volatility is insane today. not complaining tho 📈',
  'imagine not being in crypto right now 😂',
  'just lost my rent money on a dog coin. totally fine 🐕',
  'sleep is for people who aren\'t watching charts at 3am',
  'my portfolio is down 80% but at least i\'m having fun',
  'bought the top again. i am ngmi',
  'the audacity of this market to rug me twice in one day',
  'paper hands get rekt, diamond hands get rekt slightly later',
  'price discovery is just another word for "we have no idea"',
  'charts are just astrology for men',
  'my therapist told me to stop checking prices. i fired my therapist.',
  'not financial advice but also definitely financial advice',
];

// ── In-memory buffer ──────────────────────────────────────────────────────────
const tweetBuffer = [];
const MAX_TWEETS  = 100;
let io            = null;
let tokenGenerator = null;

function _rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function _addTweet(tweet) {
  tweetBuffer.unshift(tweet); // newest first
  if (tweetBuffer.length > MAX_TWEETS) tweetBuffer.pop();
  if (io) io.emit('tweet_added', tweet);
}

// ── Celebrity launch event ────────────────────────────────────────────────────
async function _triggerCelebLaunch() {
  if (!tokenGenerator) return;

  const celeb = _rand(CELEBRITY_ACCOUNTS);
  const launchTemplate = _rand(LAUNCH_TWEETS);

  // Pick official coin name: e.g. "TrumpCoin" or "TrumpMoon" etc
  const officialBase = celeb.coinTheme;
  const officialSuffixes = ['Coin', 'Moon', 'X', 'Official', 'Real'];
  const officialName = officialBase + _rand(officialSuffixes);
  const officialTicker = officialBase.toUpperCase();

  const tweetText = launchTemplate.replace(/\[COIN\]/g, officialTicker);

  let officialCoinId = null;
  const scamIds = [];

  try {
    // Spawn official coin
    const officialCoin = await tokenGenerator.spawnCoinWithOverrides({
      name: officialName,
      ticker: officialTicker,
      fate: 'runner',
      isCelebrityCoin: true,
      tweetMention: celeb.handle,
      isOfficial: true,
    });
    if (officialCoin) officialCoinId = officialCoin.id;

    // Spawn 3 lookalike scams
    for (const scamName of celeb.coinNames.slice(0, 3)) {
      const scamTicker = scamName.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
      const scamCoin = await tokenGenerator.spawnCoinWithOverrides({
        name: scamName,
        ticker: scamTicker,
        fate: 'bleeder',
        isCelebrityCoin: false,
        tweetMention: celeb.handle,
        isOfficial: false,
      });
      if (scamCoin) scamIds.push(scamCoin.id);
    }
  } catch (err) {
    console.error('[tweetService] celebrity spawn error:', err.message);
  }

  const tweet = {
    id: randomUUID(),
    handle: celeb.handle,
    name: celeb.name,
    avatar: celeb.avatar,
    verified: celeb.verified,
    followers: celeb.followers,
    text: tweetText,
    coinTicker: officialTicker,
    coinId: officialCoinId,
    type: 'launch',
    likes: _randInt(10_000, 500_000),
    retweets: _randInt(2_000, 100_000),
    timestamp: new Date().toISOString(),
    coinSpawned: { officialId: officialCoinId, scamIds },
  };

  _addTweet(tweet);
  console.log(`📢 [tweetService] Celebrity launch: ${celeb.handle} → $${officialTicker}`);
}

// ── Small account tweet ───────────────────────────────────────────────────────
function _triggerSmallTweet() {
  const account = _rand(SMALL_ACCOUNTS);
  const r = Math.random();

  // Figure out a coin to reference (if any is in the buffer)
  const recentWithCoins = tweetBuffer.filter(t => t.coinTicker);
  const refCoin = recentWithCoins.length > 0 && Math.random() < 0.7
    ? _rand(recentWithCoins)
    : null;

  let text, type, coinTicker, coinId;

  if (refCoin && r < 0.35) {
    // Shill
    type = 'shill';
    coinTicker = refCoin.coinTicker;
    coinId = refCoin.coinId;
    text = _rand(SHILL_TWEETS).replace(/\[COIN\]/g, coinTicker);
  } else if (refCoin && r < 0.55) {
    // FUD
    type = 'fud';
    coinTicker = refCoin.coinTicker;
    coinId = refCoin.coinId;
    text = _rand(FUD_TWEETS).replace(/\[COIN\]/g, coinTicker);
  } else {
    // General degen commentary
    type = 'general';
    coinTicker = undefined;
    coinId = undefined;
    text = _rand(GENERAL_TWEETS);
  }

  const tweet = {
    id: randomUUID(),
    handle: account.handle,
    name: account.name,
    avatar: account.avatar,
    verified: account.verified,
    followers: account.followers,
    text,
    coinTicker,
    coinId,
    type,
    likes: _randInt(10, 50_000),
    retweets: _randInt(1, 10_000),
    timestamp: new Date().toISOString(),
  };

  _addTweet(tweet);
}

// ── Scheduling ─────────────────────────────────────────────────────────────────
let celebTimer = null;
let smallTimer = null;
let running = false;

function _scheduleCeleb() {
  if (!running) return;
  // 8–20 minutes between celebrity events
  const delayMs = _randInt(8 * 60_000, 20 * 60_000);
  celebTimer = setTimeout(async () => {
    await _triggerCelebLaunch();
    _scheduleCeleb();
  }, delayMs);
}

function _scheduleSmall() {
  if (!running) return;
  // 20–45 seconds between small account tweets
  const delayMs = _randInt(20_000, 45_000);
  smallTimer = setTimeout(() => {
    _triggerSmallTweet();
    _scheduleSmall();
  }, delayMs);
}

// ── Public API ─────────────────────────────────────────────────────────────────
function setIo(socketIo) {
  io = socketIo;
}

function setTokenGenerator(tg) {
  tokenGenerator = tg;
}

function getTweets() {
  return tweetBuffer.slice(0, 50);
}

function start() {
  if (running) return;
  running = true;
  // Seed with a couple of general tweets right away
  setTimeout(() => _triggerSmallTweet(), 3_000);
  setTimeout(() => _triggerSmallTweet(), 8_000);
  // Schedule ongoing events
  _scheduleSmall();
  // First celebrity event in 2-5 minutes (let the market warm up first)
  celebTimer = setTimeout(async () => {
    await _triggerCelebLaunch();
    _scheduleCeleb();
  }, _randInt(2 * 60_000, 5 * 60_000));

  console.log('📡 Tweet service started');
}

function stop() {
  running = false;
  if (celebTimer) clearTimeout(celebTimer);
  if (smallTimer)  clearTimeout(smallTimer);
}

module.exports = { start, stop, getTweets, setIo, setTokenGenerator };
