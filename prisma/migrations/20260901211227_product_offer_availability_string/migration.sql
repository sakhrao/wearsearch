/*
  Warnings:

  - The `availability` column on the `ProductOffer` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "ProductOffer" DROP COLUMN "availability",
ADD COLUMN     "availability" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX "ProductOffer_availability_idx" ON "ProductOffer"("availability");
