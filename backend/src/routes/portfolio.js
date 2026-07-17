const express = require('express');
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/auth');
const priceEngine = require('../services/priceEngine');

const router = express.Router();

// GET /api/portfolio
router.get('/', authenticate, async (req, res) => {
  try {
    const portfolio = await prisma.portfolio.findUnique({ where: { userId: req.userId } });
    const holdings = await prisma.holding.findMany({
      where: { userId: req.userId },
      include: { coin: true },
    });

    const enrichedHoldings = holdings.map((h) => {
      const currentPrice = priceEngine.getCurrentPrice(h.coinId) || h.coin.currentPrice;
      const currentValue = h.amount * currentPrice;
      const pnl = currentValue - h.amount * h.avgBuyPrice;
      return {
        ...h,
        coin: { ...h.coin, currentPrice },
        currentValue,
        pnl,
        pnlPct: h.avgBuyPrice > 0 ? ((currentPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100 : 0,
      };
    });

    const holdingsValue = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalValue = portfolio.solBalance + holdingsValue;

    res.json({
      solBalance: portfolio.solBalance,
      holdingsValue,
      totalValue,
      gainPct: ((totalValue - 100) / 100) * 100,
      holdings: enrichedHoldings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
