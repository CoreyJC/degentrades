/**
 * DegenTrades Distribution Service
 *
 * Monitors the treasury wallet for new SOL. When funds arrive, creates a
 * distribution epoch that drips the total amount over 10 hours (600 × 60s ticks)
 * to all $DEGEN holders who have registered their wallet on the platform.
 *
 * Env vars required to activate:
 *   TREASURY_WALLET_PUBLIC_KEY  — treasury SOL address (to monitor)
 *   TREASURY_PRIVATE_KEY        — bs58 or JSON-array private key (to sign sends)
 *   SOLANA_RPC_URL              — Helius / QuickNode / mainnet RPC
 *
 * Optional:
 *   DEGEN_TOKEN_MINT            — token CA; if set, only wallets holding > 0
 *                                 tokens are eligible and payouts are proportional
 *                                 to balance. If unset, equal split among all
 *                                 registered wallets.
 */

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');

const prisma = require('../lib/prisma');

// Solana token program (hardcoded to avoid extra dep)
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const DISTRIBUTION_HOURS   = 10;
const DISTRIBUTION_MS      = DISTRIBUTION_HOURS * 60 * 60 * 1000;
const TICK_MS              = 60 * 1000;          // 60 seconds
const MIN_PAYOUT_LAMPORTS  = 10_000;             // ~0.00001 SOL — skip dust
const DETECTION_THRESHOLD  = 0.005;              // ignore sub-0.005 SOL bumps (rounding/fees)

let connection      = null;
let treasuryKeypair = null;
let treasuryPubkey  = null;
let degenMint       = null;
let lastBalance     = null;   // SOL float, seeded on startup
let tickTimer       = null;
let ready           = false;

// ─── Initialise ────────────────────────────────────────────────────────────

async function init() {
  const pub  = process.env.TREASURY_WALLET_PUBLIC_KEY;
  const priv = process.env.TREASURY_PRIVATE_KEY;
  const rpc  = process.env.SOLANA_RPC_URL;

  if (!pub || !priv || !rpc) {
    console.log('⚠️  Distribution service disabled — set TREASURY_WALLET_PUBLIC_KEY, TREASURY_PRIVATE_KEY, SOLANA_RPC_URL to enable.');
    return;
  }

  try {
    connection     = new Connection(rpc, 'confirmed');
    treasuryPubkey = new PublicKey(pub);

    // Support both bs58 and JSON-array private key formats
    let secretKey;
    if (priv.trim().startsWith('[')) {
      secretKey = Uint8Array.from(JSON.parse(priv));
    } else {
      const bs58 = require('bs58');
      secretKey = bs58.default?.decode ? bs58.default.decode(priv) : bs58.decode(priv);
    }
    treasuryKeypair = Keypair.fromSecretKey(secretKey);

    if (process.env.DEGEN_TOKEN_MINT) {
      degenMint = new PublicKey(process.env.DEGEN_TOKEN_MINT);
      console.log(`🪙  $DEGEN mint: ${process.env.DEGEN_TOKEN_MINT}`);
    } else {
      console.log('ℹ️  DEGEN_TOKEN_MINT not set — equal split among all registered wallets');
    }

    // Seed balance so we don't re-distribute existing funds on restart
    lastBalance = (await connection.getBalance(treasuryPubkey)) / LAMPORTS_PER_SOL;
    console.log(`💰 Distribution service ready. Treasury: ${lastBalance.toFixed(4)} SOL`);

    ready = true;
    tickTimer = setInterval(tick, TICK_MS);
    tick(); // immediate first tick
  } catch (err) {
    console.error('Distribution service init failed:', err.message);
  }
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  ready = false;
}

// ─── Main tick ─────────────────────────────────────────────────────────────

async function tick() {
  if (!ready) return;
  try {
    await detectNewFunds();
    await processActiveEpochs();
  } catch (err) {
    console.error('Distribution tick error:', err.message);
  }
}

// ─── Fund detection ────────────────────────────────────────────────────────

async function detectNewFunds() {
  const lamports = await connection.getBalance(treasuryPubkey);
  const currentBalance = lamports / LAMPORTS_PER_SOL;
  const delta = currentBalance - lastBalance;

  if (delta > DETECTION_THRESHOLD) {
    console.log(`🚀 New funds: +${delta.toFixed(4)} SOL → opening distribution epoch`);

    const now    = new Date();
    const endsAt = new Date(now.getTime() + DISTRIBUTION_MS);

    await prisma.distributionEpoch.create({
      data: { totalSol: delta, distributedSol: 0, endsAt, status: 'active' },
    });

    lastBalance = currentBalance;
    console.log(`📅 Epoch created — distributing ${delta.toFixed(4)} SOL over ${DISTRIBUTION_HOURS}h`);
  } else {
    lastBalance = currentBalance;
  }
}

// ─── Epoch processing ──────────────────────────────────────────────────────

async function processActiveEpochs() {
  const epochs = await prisma.distributionEpoch.findMany({
    where: { status: 'active' },
  });

  for (const epoch of epochs) {
    await processEpochTick(epoch);
  }
}

async function processEpochTick(epoch) {
  const now       = new Date();
  const endsAt    = new Date(epoch.endsAt);
  const remaining = epoch.totalSol - epoch.distributedSol;

  // Epoch expired or fully distributed
  if (now >= endsAt || remaining < MIN_PAYOUT_LAMPORTS / LAMPORTS_PER_SOL) {
    await prisma.distributionEpoch.update({
      where: { id: epoch.id },
      data:  { status: 'completed' },
    });
    console.log(`✅ Epoch ${epoch.id.slice(-6)} completed — distributed ${epoch.distributedSol.toFixed(4)} SOL`);
    return;
  }

  // How much to send this tick (pro-rate remaining over remaining time)
  const msLeft         = endsAt - now;
  const ticksLeft      = Math.max(1, Math.ceil(msLeft / TICK_MS));
  const tickAmountSol  = remaining / ticksLeft;

  if (tickAmountSol * LAMPORTS_PER_SOL < MIN_PAYOUT_LAMPORTS) return;

  // Get eligible holders and their weights
  const holders = await getEligibleHolders();
  if (holders.length === 0) {
    console.log('⚠️  No eligible holders this tick — skipping');
    return;
  }

  const totalWeight  = holders.reduce((s, h) => s + h.weight, 0);
  let totalSent      = 0;

  for (const holder of holders) {
    const share     = (holder.weight / totalWeight) * tickAmountSol;
    const lamports  = Math.floor(share * LAMPORTS_PER_SOL);
    if (lamports < MIN_PAYOUT_LAMPORTS) continue;

    try {
      const sig = await sendSol(holder.wallet, lamports);
      await prisma.distributionPayout.create({
        data: {
          epochId:   epoch.id,
          wallet:    holder.wallet,
          amountSol: lamports / LAMPORTS_PER_SOL,
          txSig:     sig,
          status:    'confirmed',
        },
      });
      totalSent += lamports / LAMPORTS_PER_SOL;
    } catch (err) {
      console.error(`❌ Send failed to ${holder.wallet}: ${err.message}`);
      await prisma.distributionPayout.create({
        data: {
          epochId:   epoch.id,
          wallet:    holder.wallet,
          amountSol: lamports / LAMPORTS_PER_SOL,
          status:    'failed',
        },
      });
    }
  }

  if (totalSent > 0) {
    await prisma.distributionEpoch.update({
      where: { id: epoch.id },
      data:  { distributedSol: { increment: totalSent } },
    });
    console.log(`💸 Tick — sent ${totalSent.toFixed(6)} SOL to ${holders.length} holder(s)`);
    lastBalance -= totalSent; // adjust so next balance read doesn't treat outgoing as income
  }
}

// ─── Holder resolution ─────────────────────────────────────────────────────

async function getEligibleHolders() {
  // All wallets registered on the platform
  const registered = await prisma.user.findMany({
    where:  { walletAddress: { not: null } },
    select: { walletAddress: true },
  });

  if (!degenMint) {
    // Token not launched yet — equal weight to all registered wallets
    return registered.map(u => ({ wallet: u.walletAddress, weight: 1 }));
  }

  // Fetch ALL $DEGEN token accounts in a single RPC call, then cross-reference
  const tokenAccounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: degenMint.toBase58() } },
    ],
  });

  // Build wallet → balance map
  const balanceMap = new Map();
  for (const { account } of tokenAccounts) {
    const info    = account.data?.parsed?.info;
    if (!info) continue;
    const owner   = info.owner;
    const balance = parseFloat(info.tokenAmount?.uiAmountString || '0');
    if (balance > 0) {
      balanceMap.set(owner, (balanceMap.get(owner) || 0) + balance);
    }
  }

  // Only eligible if: registered on platform AND holds > 0 $DEGEN
  const holders = [];
  for (const { walletAddress } of registered) {
    const balance = balanceMap.get(walletAddress) || 0;
    if (balance > 0) holders.push({ wallet: walletAddress, weight: balance });
  }
  return holders;
}

// ─── SOL transfer ──────────────────────────────────────────────────────────

async function sendSol(toWallet, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasuryKeypair.publicKey,
      toPubkey:   new PublicKey(toWallet),
      lamports,
    })
  );
  return sendAndConfirmTransaction(connection, tx, [treasuryKeypair]);
}

// ─── Status helper (used by API route) ─────────────────────────────────────

function getStatus() {
  return {
    ready,
    treasuryAddress: treasuryPubkey?.toBase58() || null,
    tokenMint:       degenMint?.toBase58()       || null,
    lastBalanceSol:  lastBalance,
  };
}

module.exports = { init, stop, getStatus };
