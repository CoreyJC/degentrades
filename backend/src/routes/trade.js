const express = require('express');
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/auth');
const priceEngine = require('../services/priceEngine');

const router = express.Router();

const GAS_FEE      = 0.000025; // flat Solana network fee per tx
const PROTOCOL_FEE = 0.01;     // 1% pump.fun-style protocol fee

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

    const protocolFee  = solAmount * PROTOCOL_FEE;
    const totalCost    = solAmount + protocolFee + GAS_FEE;

    if (portfolio.solBalance < totalCost) {
      return res.status(400).json({ error: 'Insufficient SOL balance (include fees)' });
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
        data: { solBalance: { decrement: totalCost } },
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

    // Apply buy pressure to the market — your SOL going in pumps the price
    priceEngine.applyTradeImpact(coinId, solAmount, true);
    const newPrice = priceEngine.getCurrentPrice(coinId);

    res.json({
      success: true,
      coinsReceived,
      price: currentPrice,
      newPrice,
      solSpent:     solAmount,
      protocolFee,
      gasFee:       GAS_FEE,
      totalCost,
      newSolBalance: portfolio.solBalance - totalCost,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/trade/sell
router.post('/sell', authenticate, async (req, res) => {
  const { coinId, coinAmount, sellAll } = req.body;

  if (!coinId || (!coinAmount && !sellAll) || (coinAmount != null && coinAmount <= 0)) {
    return res.status(400).json({ error: 'coinId and coinAmount (>0) are required' });
  }

  try {
    const coin = await prisma.coin.findUnique({ where: { id: coinId } });
    if (!coin) return res.status(404).json({ error: 'Coin not found' });

    const holding = await prisma.holding.findUnique({
      where: { userId_coinId: { userId: req.userId, coinId } },
    });

    if (!holding || holding.amount <= 0) {
      return res.status(400).json({ error: 'Insufficient holdings' });
    }

    // sellAll uses the exact DB amount — no float precision issues
    // otherwise clamp to holding.amount with a small epsilon tolerance
    const actualAmount = sellAll
      ? holding.amount
      : Math.min(coinAmount, holding.amount);

    if (actualAmount <= 0) {
      return res.status(400).json({ error: 'Insufficient holdings' });
    }

    const currentPrice  = priceEngine.getCurrentPrice(coinId) || coin.currentPrice;
    const grossReceived = actualAmount * currentPrice;
    const protocolFee   = grossReceived * PROTOCOL_FEE;
    const solReceived   = grossReceived - protocolFee - GAS_FEE;
    const newAmount     = holding.amount - actualAmount;
    const sellPnlPct    = holding.avgBuyPrice > 0
      ? ((currentPrice - holding.avgBuyPrice) / holding.avgBuyPrice) * 100
      : 0;

    await prisma.$transaction([
      prisma.portfolio.update({
        where: { userId: req.userId },
        data: { solBalance: { increment: solReceived } },
      }),
      newAmount > 0.000001 // treat dust as zero
        ? prisma.holding.update({
            where: { userId_coinId: { userId: req.userId, coinId } },
            data: { amount: newAmount },
          })
        : prisma.holding.delete({
            where: { userId_coinId: { userId: req.userId, coinId } },
          }),
      prisma.transaction.create({
        data: {
          userId:      req.userId,
          coinId,
          type:        'SELL',
          amount:      actualAmount,
          price:       currentPrice,
          solSpent:    -solReceived,
          avgBuyPrice: holding.avgBuyPrice,
          pnlPct:      sellPnlPct,
        },
      }),
    ]);

    // Apply sell pressure — your tokens hitting the market drops the price
    priceEngine.applyTradeImpact(coinId, solReceived, false);
    const newPrice = priceEngine.getCurrentPrice(coinId);

    res.json({
      success: true,
      coinsSold:    actualAmount,
      price:        currentPrice,
      newPrice,
      grossReceived,
      protocolFee,
      gasFee:       GAS_FEE,
      solReceived,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
