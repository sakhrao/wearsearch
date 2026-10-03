-- AlterTable
ALTER TABLE "ProductOfferVariant" ADD COLUMN     "canonicalSizeOptionId" TEXT,
ADD COLUMN     "sizeResolutionProvenance" TEXT,
ADD COLUMN     "sizeResolutionStatus" TEXT,
ADD COLUMN     "sizeResolutionSystem" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "canonicalSizeOptionId" TEXT,
ADD COLUMN     "sizeResolutionProvenance" TEXT,
ADD COLUMN     "sizeResolutionStatus" TEXT,
ADD COLUMN     "sizeResolutionSystem" TEXT;

-- CreateIndex
CREATE INDEX "ProductOfferVariant_canonicalSizeOptionId_idx" ON "ProductOfferVariant"("canonicalSizeOptionId");

-- CreateIndex
CREATE INDEX "ProductOfferVariant_sizeResolutionSystem_idx" ON "ProductOfferVariant"("sizeResolutionSystem");

-- CreateIndex
CREATE INDEX "ProductVariant_canonicalSizeOptionId_idx" ON "ProductVariant"("canonicalSizeOptionId");

-- CreateIndex
CREATE INDEX "ProductVariant_sizeResolutionSystem_idx" ON "ProductVariant"("sizeResolutionSystem");
