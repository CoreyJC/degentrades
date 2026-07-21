/**
 * DegenTrades Distribution Service
 *
 * Monitors treasury wallet, creates epochs, and drips SOL to $DEGEN holders.
 * Solana sending is enabled when TREASURY_WALLET_PUBLIC_KEY + TREASURY_PRIVATE_KEY
 * + SOLANA_RPC_URL are all set. Until then the service tracks epochs in DB only.
 */

const prisma = require('../lib/prisma');

const DISTRIBUTION_HOURS  = 10;
const DISTRIBUTION_MS     = DISTRIBUTION_HOURS * 60 * 60 * 1000;
const TICK_MS             = 60 * 1000;
const MIN_PAYOUT_SOL      = 0.00001;
const DETECTION_THRESHOLD = 0.005;

let tickTimer       = null;
let ready           = false;
let solanaReady     = false;
let lastBalance     = 0;

// Solana refs (populated lazily when env vars present)
let connection      = null;
let treasuryKeypair = null;
let treasuryPubkey  = null;
let degenMint       = null;
let LAMPORTS_PER_SOL = 1_000_000_000;
let TOKEN_PROGRAM_ID = null;

async function init() {
  const pub  = process.env.TREASURY_WALLET_PUBLIC_KEY;
  const priv = process.env.TREASURY_PRIVATE_KEY;
  const rpc  = process.env.SOLANA_RPC_URL;

  if (!pub || !priv || !rpc) {
    console.log('ℹ️  Distribution service: env vars not set — epoch tracking only (no SOL sends).');
    ready = true;
    tickTimer = setInterval(tick, TICK_MS);
    return;
  }

  try {
    const web3 = require('@solana/web3.js');
    const bs58 = require('bs58');

    LAMPORTS_PER_SOL  = web3.LAMPORTS_PER_SOL;
    TOKEN_PROGRAM_ID  = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    connection        = new web3.Connection(rpc, 'confirmed');
    treasuryPubkey    = new web3.PublicKey(pub);

    let secretKey;
    if (priv.trim().startsWith('[')) {
      secretKey = Uint8Array.from(JSON.parse(priv));
    } else {
      secretKey = bs58.decode(priv);
    }
    treasuryKeypair = web3.Keypair.fromSecretKey(secretKey);

    if (process.env.DEGEN_TOKEN_MINT) {
      degenMint = new web3.PublicKey(process.env.DEGEN_TOKEN_MINT);
    }

    lastBalance = (await connection.getBalance(treasuryPubkey)) / LAMPORTS_PER_SOL;
    solanaReady = true;
    console.log(`💰 Distribution service LIVE. Treasury: ${lastBalance.toFixed(4)} SOL`);
  } catch (err) {
    console.warn(`⚠️  Distribution service: Solana init failed (${err.message}) — epoch tracking only.`);
  }

  ready = true;
  tickTimer = setInterval(tick, TICK_MS);
  tick();
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  ready = false;
}

async function tick() {
  if (!ready) return;
  try {
    if (solanaReady) await detectNewFunds();
    await processActiveEpochs();
  } catch (err) {
    console.error('Distribution tick error:', err.message);
  }
}

async function detectNewFunds() {
  const web3 = require('@solana/web3.js');
  const lamports = await connection.getBalance(treasuryPubkey);
  const current  = lamports / LAMPORTS_PER_SOL;
  const delta    = current - lastBalance;

  if (delta > DETECTION_THRESHOLD) {
    console.log(`🚀 New funds: +${delta.toFixed(4)} SOL → opening distribution epoch`);
    const now    = new Date();
    const endsAt = new Date(now.getTime() + DISTRIBUTION_MS);
    await prisma.distributionEpoch.create({
      data: { totalSol: delta, distributedSol: 0, endsAt, status: 'active' },
    });
    lastBalance = current;
  } else {
    lastBalance = current;
  }
}

async function processActiveEpochs() {
  const epochs = await prisma.distributionEpoch.findMany({ where: { status: 'active' } });
  for (const epoch of epochs) await processEpochTick(epoch);
}

async function processEpochTick(epoch) {
  const now      = new Date();
  const endsAt   = new Date(epoch.endsAt);
  const remaining = epoch.totalSol - epoch.distributedSol;

  if (now >= endsAt || remaining < MIN_PAYOUT_SOL) {
    await prisma.distributionEpoch.update({ where: { id: epoch.id }, data: { status: 'completed' } });
    return;
  }

  if (!solanaReady) return; // can't send without Solana connection

  const msLeft       = endsAt - now;
  const ticksLeft    = Math.max(1, Math.ceil(msLeft / TICK_MS));
  const tickAmount   = remaining / ticksLeft;
  if (tickAmount < MIN_PAYOUT_SOL) return;

  const holders = await getEligibleHolders();
  if (!holders.length) return;

  const totalWeight = holders.reduce((s, h) => s + h.weight, 0);
  let totalSent = 0;

  for (const holder of holders) {
    const share    = (holder.weight / totalWeight) * tickAmount;
    const lamports = Math.floor(share * LAMPORTS_PER_SOL);
    if (lamports < 1000) continue;

    try {
      const sig = await sendSol(holder.wallet, lamports);
      await prisma.distributionPayout.create({
        data: { epochId: epoch.id, wallet: holder.wallet, amountSol: lamports / LAMPORTS_PER_SOL, txSig: sig, status: 'confirmed' },
      });
      totalSent += lamports / LAMPORTS_PER_SOL;
    } catch (err) {
      console.error(`❌ Send failed to ${holder.wallet}: ${err.message}`);
      await prisma.distributionPayout.create({
        data: { epochId: epoch.id, wallet: holder.wallet, amountSol: lamports / LAMPORTS_PER_SOL, status: 'failed' },
      });
    }
  }

  if (totalSent > 0) {
    await prisma.distributionEpoch.update({
      where: { id: epoch.id },
      data:  { distributedSol: { increment: totalSent } },
    });
    lastBalance -= totalSent;
  }
}

async function getEligibleHolders() {
  const registered = await prisma.user.findMany({
    where:  { walletAddress: { not: null } },
    select: { walletAddress: true },
  });

  if (!degenMint) {
    return registered.map(u => ({ wallet: u.walletAddress, weight: 1 }));
  }

  const web3 = require('@solana/web3.js');
  const tokenAccounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: degenMint.toBase58() } },
    ],
  });

  const balanceMap = new Map();
  for (const { account } of tokenAccounts) {
    const info    = account.data?.parsed?.info;
    if (!info) continue;
    const balance = parseFloat(info.tokenAmount?.uiAmountString || '0');
    if (balance > 0) balanceMap.set(info.owner, (balanceMap.get(info.owner) || 0) + balance);
  }

  return registered
    .map(u => ({ wallet: u.walletAddress, weight: balanceMap.get(u.walletAddress) || 0 }))
    .filter(h => h.weight > 0);
}

async function sendSol(toWallet, lamports) {
  const web3 = require('@solana/web3.js');
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: treasuryKeypair.publicKey,
      toPubkey:   new web3.PublicKey(toWallet),
      lamports,
    })
  );
  return web3.sendAndConfirmTransaction(connection, tx, [treasuryKeypair]);
}

function getStatus() {
  return {
    ready,
    solanaReady,
    treasuryAddress: treasuryPubkey?.toBase58() || null,
    tokenMint:       degenMint?.toBase58()       || null,
    lastBalanceSol:  lastBalance,
  };
}

module.exports = { init, stop, getStatus };
