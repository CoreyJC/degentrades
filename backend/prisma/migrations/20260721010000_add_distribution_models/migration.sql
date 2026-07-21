-- CreateTable
CREATE TABLE "DistributionEpoch" (
    "id"             TEXT NOT NULL,
    "totalSol"       DOUBLE PRECISION NOT NULL,
    "distributedSol" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt"         TIMESTAMP(3) NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "DistributionEpoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionPayout" (
    "id"        TEXT NOT NULL,
    "epochId"   TEXT NOT NULL,
    "wallet"    TEXT NOT NULL,
    "amountSol" DOUBLE PRECISION NOT NULL,
    "txSig"     TEXT,
    "status"    TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistributionPayout_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DistributionPayout" ADD CONSTRAINT "DistributionPayout_epochId_fkey"
    FOREIGN KEY ("epochId") REFERENCES "DistributionEpoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
