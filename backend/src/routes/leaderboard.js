const express = require('express');
const prisma = require('../lib/prisma');
const priceEngine = require('../services/priceEngine');
const seasonService = require('../services/seasonService');

const router = express.Router();

// GET /api/leaderboard — top 20 by % gain from starting 100 SOL
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        portfolio: true,
        holdings: { include: { coin: true } },
      },
      take: 100,
    });

    const allRanked = users
      .map((user) => {
        const holdingsValue = user.holdings.reduce((sum, h) => {
          const price = priceEngine.getCurrentPrice(h.coinId) || h.coin.currentPrice;
          return sum + h.amount * price;
        }, 0);
        const totalValue = (user.portfolio?.solBalance || 0) + holdingsValue;
        const gainPct = ((totalValue - 10) / 10) * 100;
        return {
          username: user.username,
          startingBalance: 10,
          currentValue: parseFloat(totalValue.toFixed(4)),
          gainPct: parseFloat(gainPct.toFixed(2)),
        };
      })
      .sort((a, b) => b.gainPct - a.gainPct);

    // Add rank + projected bonusSol for top 10
    const ranked = allRanked.slice(0, 20).map((row, i) => {
      const rank = i + 1;
      return {
        ...row,
        rank,
        bonusSol: seasonService.getBonusSolForRank(rank),
      };
    });

    res.json(ranked);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leaderboard/season — current season info + top 10 rewards
router.get('/season', async (req, res) => {
  try {
    const season = await seasonService.getOrCreateCurrentSeason();

    // Calculate days until reset (next 1st of the month)
    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const msUntilReset = nextReset - now;
    const daysUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60 * 24));

    const rewards = await seasonService.getSeasonRewards(season.id);

    res.json({
      currentSeason: {
        number: season.number,
        startedAt: season.startedAt,
        daysUntilReset,
      },
      rewards,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leaderboard/reset — admin manual reset (secret param)
router.post('/reset', async (req, res) => {
  if (req.query.secret !== 'degenreset2024') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const result = await seasonService.resetSeason();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Reset failed', details: err.message });
  }
});

module.exports = router;
