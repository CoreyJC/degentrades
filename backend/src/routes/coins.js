const express      = require('express');
const prisma       = require('../lib/prisma');
const priceEngine  = require('../services/priceEngine');

const router = express.Router();

// GET /api/coins — all active coins with live prices + 24h change estimate
router.get('/', async (req, res) => {
  try {
    const coins = await prisma.coin.findMany({ where: { isActive: true } });

    const result = coins.map((coin) => {
      // Re-register any coin the engine lost (e.g. created during a restart window)
      if (priceEngine.getCurrentPrice(coin.id) === null) {
        priceEngine.registerCoin(coin);
      }
      const history      = priceEngine.getHistory(coin.id);
      const currentPrice = priceEngine.getCurrentPrice(coin.id) ?? coin.currentPrice;

      // Use the oldest candle we have as a rough 24h proxy
      const oldPrice   = history.length >= 2 ? history[0].close : currentPrice;
      const change24h  = oldPrice > 0
        ? parseFloat((((currentPrice - oldPrice) / oldPrice) * 100).toFixed(2))
        : 0;

      return {
        id:            coin.id,
        name:          coin.name,
        ticker:        coin.ticker,
        currentPrice,
        marketCap:     currentPrice * 1_000_000_000,
        rugProbability: coin.rugProbability,
        migrated:      coin.migrated,
        migratedAt:    coin.migratedAt,
        createdAt:     coin.createdAt ?? priceEngine.getCreatedAt(coin.id),
        change24h,
        holderCount:    priceEngine.getHolderCount(coin.id),
        topHolderPct:   parseFloat((priceEngine.getTopHolderPct?.(coin.id) ?? 0).toFixed(1)),
        isBundled:      priceEngine.getIsBundled?.(coin.id) ?? false,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/coins/:id/history — OHLCV candle history for a specific coin
router.get('/:id/history', async (req, res) => {
  const { id }  = req.params;
  const limit   = Math.min(parseInt(req.query.limit) || 500, 500);

  // Re-register if engine lost state for this coin
  if (priceEngine.getCurrentPrice(id) === null) {
    const coin = await prisma.coin.findUnique({ where: { id } }).catch(() => null);
    if (coin) priceEngine.registerCoin(coin);
  }

  const history = priceEngine.getHistory(id);
  if (!history.length) return res.status(404).json({ error: 'No history for this coin' });
  res.json(history.slice(-limit));
});

module.exports = router;
