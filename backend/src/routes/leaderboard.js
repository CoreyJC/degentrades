const express = require('express');
const prisma = require('../lib/prisma');
const priceEngine = require('../services/priceEngine');

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

    const ranked = users
      .map((user) => {
        const holdingsValue = user.holdings.reduce((sum, h) => {
          const price = priceEngine.getCurrentPrice(h.coinId) || h.coin.currentPrice;
          return sum + h.amount * price;
        }, 0);
        const totalValue = (user.portfolio?.solBalance || 0) + holdingsValue;
        const gainPct = ((totalValue - 100) / 100) * 100;
        return {
          username: user.username,
          startingBalance: 100,
          currentValue: parseFloat(totalValue.toFixed(4)),
          gainPct: parseFloat(gainPct.toFixed(2)),
        };
      })
      .sort((a, b) => b.gainPct - a.gainPct)
      .slice(0, 20);

    res.json(ranked);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
