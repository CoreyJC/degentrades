require('dotenv').config();
const prisma = require('./lib/prisma');

const COINS = [
  { name: 'Pepe 2.0',    ticker: 'PEPE2',  currentPrice: 0.0000234,  marketCap: 23400000 },
  { name: 'Bonk X',      ticker: 'BONKX',  currentPrice: 0.00156,    marketCap: 156000000 },
  { name: 'Rug Me',      ticker: 'RUGME',  currentPrice: 0.000089,   marketCap: 8900000 },
  { name: 'Moon Shot',   ticker: 'MOON',   currentPrice: 0.00445,    marketCap: 44500000 },
  { name: 'Not Gonna Make It', ticker: 'NGMI', currentPrice: 0.0000012, marketCap: 1200000 },
];

async function main() {
  console.log('🌱 Seeding coins...');
  for (const coin of COINS) {
    await prisma.coin.upsert({
      where: { ticker: coin.ticker },
      update: {},
      create: coin,
    });
    console.log(`  ✓ ${coin.ticker} @ $${coin.currentPrice}`);
  }
  console.log('✅ Seed complete');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
