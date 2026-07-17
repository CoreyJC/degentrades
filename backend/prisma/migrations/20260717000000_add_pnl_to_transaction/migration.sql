-- AlterTable: add avgBuyPrice and pnlPct to Transaction (nullable)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "avgBuyPrice" DOUBLE PRECISION;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "pnlPct" DOUBLE PRECISION;
