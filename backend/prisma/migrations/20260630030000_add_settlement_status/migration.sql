-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NOT_APPLICABLE', 'SETTLEMENT_PENDING', 'SETTLED', 'SETTLEMENT_FAILED');

-- DropForeignKey
ALTER TABLE "deposits" DROP CONSTRAINT "deposits_walletId_fkey";

-- DropForeignKey
ALTER TABLE "deposits" DROP CONSTRAINT "deposits_workspaceId_fkey";

-- AlterTable
ALTER TABLE "deposits" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "lastSettlementAt" TIMESTAMP(3),
ADD COLUMN     "settlementAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settlementError" TEXT,
ADD COLUMN     "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "settlementTxHash" TEXT;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

