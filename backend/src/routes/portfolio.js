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

// GET /api/portfolio/trades — closed trades (sells) + win/loss stats
router.get('/trades', authenticate, async (req, res) => {
  try {
    const txns = await prisma.transaction.findMany({
      where:   { userId: req.userId, type: { in: ['SELL', 'RUG'] } },
      include: { coin: { select: { ticker: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });

    // Win/loss stats from all SELL transactions
    const sells = txns.filter((t) => t.pnlPct != null);
    const wins  = sells.filter((t) => t.pnlPct > 0).length;
    const losses = sells.filter((t) => t.pnlPct <= 0).length;
    const total  = wins + losses;
    const winRate = total > 0 ? (wins / total) * 100 : null;
    const totalGainPct = sells.reduce((s, t) => s + (t.pnlPct ?? 0), 0);
    const avgWinPct  = wins > 0
      ? sells.filter(t => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0) / wins
      : 0;
    const avgLossPct = losses > 0
      ? sells.filter(t => t.pnlPct <= 0).reduce((s, t) => s + t.pnlPct, 0) / losses
      : 0;

    // Last 20 closed trades
    const last20 = txns.slice(0, 20).map((t) => ({
      id:        t.id,
      type:      t.type,
      ticker:    t.coin.ticker,
      name:      t.coin.name,
      pnlPct:    t.pnlPct ?? 0,
      createdAt: t.createdAt,
    }));

    res.json({
      stats: { wins, losses, total, winRate, totalGainPct, avgWinPct, avgLossPct },
      trades: last20,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
