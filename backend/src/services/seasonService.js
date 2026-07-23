const cron = require('node-cron');
const prisma = require('../lib/prisma');
const priceEngine = require('./priceEngine');

// Reward tiers for top 25
const REWARD_TABLE = [
  { rank: 1,  bonusSol: 10 },
  { rank: 2,  bonusSol: 7  },
  { rank: 3,  bonusSol: 5  },
  { rank: 4,  bonusSol: 3  },
  { rank: 5,  bonusSol: 3  },
  { rank: 6,  bonusSol: 2  },
  { rank: 7,  bonusSol: 2  },
  { rank: 8,  bonusSol: 2  },
  { rank: 9,  bonusSol: 2  },
  { rank: 10, bonusSol: 2  },
  { rank: 11, bonusSol: 1  },
  { rank: 12, bonusSol: 1  },
  { rank: 13, bonusSol: 1  },
  { rank: 14, bonusSol: 1  },
  { rank: 15, bonusSol: 1  },
  { rank: 16, bonusSol: 1  },
  { rank: 17, bonusSol: 1  },
  { rank: 18, bonusSol: 1  },
  { rank: 19, bonusSol: 1  },
  { rank: 20, bonusSol: 1  },
  { rank: 21, bonusSol: 1  },
  { rank: 22, bonusSol: 1  },
  { rank: 23, bonusSol: 1  },
  { rank: 24, bonusSol: 1  },
  { rank: 25, bonusSol: 1  },
];

function getBonusSolForRank(rank) {
  const entry = REWARD_TABLE.find((r) => r.rank === rank);
  return entry ? entry.bonusSol : 0;
}

async function getOrCreateCurrentSeason() {
  let season = await prisma.season.findFirst({
    where: { status: 'active' },
    orderBy: { number: 'desc' },
  });
  if (!season) {
    season = await prisma.season.create({
      data: { number: 1, status: 'active' },
    });
    console.log('🏁 Created Season 1');
  }
  return season;
}

async function getSeasonRewards(seasonId) {
  const rewards = await prisma.seasonReward.findMany({
    where: { seasonId },
    include: { user: { select: { username: true } } },
    orderBy: { rank: 'asc' },
  });
  return rewards.map((r) => ({
    rank: r.rank,
    bonusSol: r.bonusSol,
    userId: r.userId,
    username: r.user.username,
  }));
}

async function buildLeaderboard() {
  const users = await prisma.user.findMany({
    include: {
      portfolio: true,
      holdings: { include: { coin: true } },
    },
  });

  return users
    .map((user) => {
      const holdingsValue = user.holdings.reduce((sum, h) => {
        const price = priceEngine.getCurrentPrice(h.coinId) || h.coin.currentPrice;
        return sum + h.amount * price;
      }, 0);
      const totalValue = (user.portfolio?.solBalance || 0) + holdingsValue;
      const gainPct = ((totalValue - 10) / 10) * 100;
      return {
        userId: user.id,
        username: user.username,
        totalValue: parseFloat(totalValue.toFixed(4)),
        gainPct: parseFloat(gainPct.toFixed(2)),
      };
    })
    .sort((a, b) => b.gainPct - a.gainPct);
}

async function resetSeason() {
  console.log('🔄 Starting season reset...');

  // 1. Get or create current active season
  const currentSeason = await getOrCreateCurrentSeason();

  // 2. Calculate leaderboard rankings
  const ranked = await buildLeaderboard();

  // 3. Save top 25 as SeasonReward records
  const top25 = ranked.slice(0, 25);
  for (let i = 0; i < top25.length; i++) {
    const rank = i + 1;
    const bonusSol = getBonusSolForRank(rank);
    await prisma.seasonReward.create({
      data: {
        seasonId: currentSeason.id,
        userId: top25[i].userId,
        rank,
        bonusSol,
      },
    });
  }

  // Build a map of userId -> bonusSol for top 25
  const bonusMap = {};
  top25.forEach((u, i) => {
    bonusMap[u.userId] = getBonusSolForRank(i + 1);
  });

  // 4. Mark season as completed
  await prisma.season.update({
    where: { id: currentSeason.id },
    data: { status: 'completed', endedAt: new Date() },
  });

  // 5. Create new Season
  const newSeason = await prisma.season.create({
    data: { number: currentSeason.number + 1, status: 'active' },
  });
  console.log(`🏁 Season ${currentSeason.number} completed → Season ${newSeason.number} started`);

  // 6. Reset ALL users: delete holdings, reset SOL balance
  const allUsers = await prisma.user.findMany({ include: { portfolio: true } });
  for (const user of allUsers) {
    const bonus = bonusMap[user.id] || 0;
    // Delete all holdings
    await prisma.holding.deleteMany({ where: { userId: user.id } });
    // Reset balance to 10 + bonus
    if (user.portfolio) {
      await prisma.portfolio.update({
        where: { userId: user.id },
        data: { solBalance: 10 + bonus },
      });
    }
  }

  console.log(`✅ Season reset complete. ${allUsers.length} users reset.`);
  return { season: currentSeason.number, newSeason: newSeason.number, rewarded: top10.length };
}

function startCron() {
  // Run on 1st of each month at midnight
  cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ Monthly cron triggered — resetting season...');
    try {
      await resetSeason();
    } catch (err) {
      console.error('Season reset failed:', err);
    }
  });
  console.log('📅 Season cron scheduled (monthly, 1st at midnight)');
}

module.exports = {
  getOrCreateCurrentSeason,
  getSeasonRewards,
  buildLeaderboard,
  resetSeason,
  getBonusSolForRank,
  startCron,
  REWARD_TABLE,
};
