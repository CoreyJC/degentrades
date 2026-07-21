-- AlterTable
ALTER TABLE "User" ADD COLUMN "walletAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");
