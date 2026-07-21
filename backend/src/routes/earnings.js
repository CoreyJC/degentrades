const express = require('express');
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/auth');

const router = express.Router();

const PROTOCOL_FEE = 0.01;
const HOLDER_SHARE = 0.50;
const SOL_USD      = 150;

// ─── GET /api/earnings/stats ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const distService = require('../services/distributionService');

    // Platform volume / fee aggregates
    const agg = await prisma.transaction.aggregate({ _sum: { solSpent: true } });
    const totalVolumeSol = agg._sum.solSpent ?? 0;
    const totalFeesSol   = totalVolumeSol * PROTOCOL_FEE;
    const holderPoolSol  = totalFeesSol * HOLDER_SHARE;

    const registeredCount = await prisma.user.count({ where: { walletAddress: { not: null } } });
    const traderCount     = await prisma.user.count();
    const txCount         = await prisma.transaction.count();

    // Active epochs
    const activeEpochs = await prisma.distributionEpoch.findMany({
      where:   { status: 'active' },
      orderBy: { startedAt: 'asc' },
    });

    // All-time distributed
    const distAgg = await prisma.distributionEpoch.aggregate({
      _sum: { distributedSol: true, totalSol: true },
    });

    // Caller wallet (optional auth)
    let myWallet = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const jwt     = require('jsonwebtoken');
        const payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const me      = await prisma.user.findUnique({
          where:  { id: payload.userId },
          select: { walletAddress: true },
        });
        myWallet = me?.walletAddress ?? null;
      } catch (_) {}
    }

    res.json({
      totalVolumeSol,
      totalVolumeSolUsd: totalVolumeSol * SOL_USD,
      totalFeesSol,
      totalFeesSolUsd:   totalFeesSol   * SOL_USD,
      holderPoolSol,
      holderPoolSolUsd:  holderPoolSol  * SOL_USD,
      registeredCount,
      traderCount,
      txCount,
      myWallet,
      activeEpochs,
      allTimeDistributedSol: distAgg._sum.distributedSol ?? 0,
      allTimeTotalSol:       distAgg._sum.totalSol       ?? 0,
      distributionService:   distService.getStatus(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ─── GET /api/earnings/epochs ───────────────────────────────────────────────
router.get('/epochs', async (req, res) => {
  try {
    const epochs = await prisma.distributionEpoch.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    res.json(epochs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load epochs' });
  }
});

// ─── GET /api/earnings/payouts?wallet=... ───────────────────────────────────
router.get('/payouts', async (req, res) => {
  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: 'wallet query param required' });

  try {
    const payouts = await prisma.distributionPayout.findMany({
      where:   { wallet, status: 'confirmed' },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    const total = payouts.reduce((s, p) => s + p.amountSol, 0);
    res.json({ payouts, totalSol: total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load payouts' });
  }
});

// ─── PUT /api/earnings/wallet ───────────────────────────────────────────────
router.put('/wallet', authenticate, async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    return res.status(400).json({ error: 'walletAddress is required' });
  }
  const solAddressRe = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!solAddressRe.test(walletAddress.trim())) {
    return res.status(400).json({ error: 'Invalid Solana wallet address' });
  }
  try {
    const user = await prisma.user.update({
      where:  { id: req.userId },
      data:   { walletAddress: walletAddress.trim() },
      select: { walletAddress: true },
    });
    res.json({ success: true, walletAddress: user.walletAddress });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'That wallet is already registered to another account' });
    }
    res.status(500).json({ error: 'Failed to save wallet' });
  }
});

// ─── DELETE /api/earnings/wallet ────────────────────────────────────────────
router.delete('/wallet', authenticate, async (req, res) => {
  try {
    await prisma.user.update({ where: { id: req.userId }, data: { walletAddress: null } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove wallet' });
  }
});

module.exports = router;
