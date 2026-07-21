const express = require('express');
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/auth');

const router = express.Router();

const PROTOCOL_FEE  = 0.01;   // 1% of every trade
const HOLDER_SHARE  = 0.50;   // 50% of collected fees go to token holders
const SOL_USD       = 150;

// GET /api/earnings/stats
// Public — returns platform-wide fee stats + (if authed) the caller's wallet
router.get('/stats', async (req, res) => {
  try {
    // Total SOL spent across all transactions → fees collected
    const agg = await prisma.transaction.aggregate({ _sum: { solSpent: true } });
    const totalVolumeSol  = agg._sum.solSpent ?? 0;
    const totalFeesSol    = totalVolumeSol * PROTOCOL_FEE;
    const holderPoolSol   = totalFeesSol * HOLDER_SHARE;

    // Registered wallets count
    const registeredCount = await prisma.user.count({
      where: { walletAddress: { not: null } },
    });

    // Total unique traders
    const traderCount = await prisma.user.count();

    // All-time transaction count
    const txCount = await prisma.transaction.count();

    // Resolve caller wallet if auth header present
    let myWallet = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const jwt = require('jsonwebtoken');
        const token = authHeader.split(' ')[1];
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const me = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { walletAddress: true },
        });
        myWallet = me?.walletAddress ?? null;
      } catch (_) { /* ignore invalid token */ }
    }

    res.json({
      totalVolumeSol,
      totalVolumeSolUsd: totalVolumeSol * SOL_USD,
      totalFeesSol,
      totalFeesSolUsd: totalFeesSol * SOL_USD,
      holderPoolSol,
      holderPoolSolUsd: holderPoolSol * SOL_USD,
      registeredCount,
      traderCount,
      txCount,
      myWallet,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// PUT /api/earnings/wallet   { walletAddress: "..." }
// Authenticated — save or update the user's SOL wallet address
router.put('/wallet', authenticate, async (req, res) => {
  const { walletAddress } = req.body;

  if (!walletAddress || typeof walletAddress !== 'string') {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  // Basic Solana address validation (base58, 32–44 chars)
  const solAddressRe = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!solAddressRe.test(walletAddress.trim())) {
    return res.status(400).json({ error: 'Invalid Solana wallet address' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { walletAddress: walletAddress.trim() },
      select: { username: true, walletAddress: true },
    });
    res.json({ success: true, walletAddress: user.walletAddress });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'That wallet is already registered to another account' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to save wallet' });
  }
});

// DELETE /api/earnings/wallet — remove wallet registration
router.delete('/wallet', authenticate, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { walletAddress: null },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove wallet' });
  }
});

module.exports = router;
