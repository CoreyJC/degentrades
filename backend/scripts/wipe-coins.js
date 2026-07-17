const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Delete in dependency order
  await p.transaction.deleteMany({});
  await p.holding.deleteMany({});
  await p.portfolio.deleteMany({});
  const r = await p.coin.deleteMany({});
  console.log('Deleted', r.count, 'coins and all related records');
  await p.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
