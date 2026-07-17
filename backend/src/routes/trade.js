const express = require('express');
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/auth');
const priceEngine = require('../services/priceEngine');

const router = express.Router();

// POST /api/trade/buy
router.post('/buy', authenticate, async (req, res) => {
  const { coinId, solAmount } = req.body;

  if (!coinId || !solAmount || solAmount <= 0) {
    return res.status(400).json({ error: 'coinId and solAmount (>0) are required' });
  }

  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) return res.status(404).json({ error: 'Coin not found' });

    const portfolio = await prisma.portfolio.findUnique({ where: { userId: req.userId } });
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

    const currentPrice = priceEngine.getCurrentPrice(coinId) || coin.currentPrice;

    if (portfolio.solBalance < solAmount) {
      return res.status(400).json({ error: 'Insufficient SOL balance' });
    }

    const coinsReceived = solAmount / currentPrice;

    // Upsert holding
    const existing = await prisma.holding.findUnique({
      where: { userId_coinId: { userId: req.userId, coinId } },
    });

    let newAmount, newAvgBuy;
    if (existing) {
      newAmount = existing.amount + coinsReceived;
      const totalCost = existing.amount * existing.avgBuyPrice + solAmount;
      newAvgBuy = totalCost / newAmount;
    } else {
      newAmount = coinsReceived;
      newAvgBuy = currentPrice;
    }

    await prisma.$transaction([
      prisma.portfolio.update({
        where: { userId: req.userId },
        data: { solBalance: { decrement: solAmount } },
      }),
      prisma.holding.upsert({
        where: { userId_coinId: { userId: req.userId, coinId } },
        create: { userId: req.userId, coinId, amount: newAmount, avgBuyPrice: newAvgBuy },
        update: { amount: newAmount, avgBuyPrice: newAvgBuy },
      }),
      prisma.transaction.create({
        data: {
          userId: req.userId,
          coinId,
          type: 'BUY',
          amount: coinsReceived,
          price: currentPrice,
          solSpent: solAmount,
        },
      }),
    ]);

    res.json({
      success: true,
      coinsReceived,
      price: currentPrice,
      solSpent: solAmount,
      newSolBalance: portfolio.solBalance - solAmount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/trade/sell
router.post('/sell', authenticate, async (req, res) => {
  const { coinId, coinAmount } = req.body;

  if (!coinId || !coinAmount || coinAmount <= 0) {
    return res.status(400).json({ error: 'coinId and coinAmount (>0) are required' });
  }

  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) return res.status(404).json({ error: 'Coin not found' });

    const holding = await prisma.holding.findUnique({
      where: { userId_coinId: { userId: req.userId, coinId } },
    });

    if (!holding || holding.amount < coinAmount) {
      return res.status(400).json({ error: 'Insufficient holdings' });
    }

    const currentPrice = priceEngine.getCurrentPrice(coinId) || coin.currentPrice;
    const solReceived = coinAmount * currentPrice;
    const newAmount = holding.amount - coinAmount;

    await prisma.$transaction([
      prisma.portfolio.update({
        where: { userId: req.userId },
        data: { solBalance: { increment: solReceived } },
      }),
      newAmount > 0
        ? prisma.holding.update({
            where: { userId_coinId: { userId: req.userId, coinId } },
            data: { amount: newAmount },
          })
        : prisma.holding.delete({
            where: { userId_coinId: { userId: req.userId, coinId } },
          }),
      prisma.transaction.create({
        data: {
          userId: req.userId,
          coinId,
          type: 'SELL',
          amount: coinAmount,
          price: currentPrice,
          solSpent: -solReceived,
        },
      }),
    ]);

    res.json({
      success: true,
      coinsSold: coinAmount,
      price: currentPrice,
      solReceived,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
