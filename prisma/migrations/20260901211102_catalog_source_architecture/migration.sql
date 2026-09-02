-- CreateEnum
CREATE TYPE "AliasKind" AS ENUM ('EXACT', 'CONTAINS');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "identityLayer" INTEGER;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "authRef" TEXT,
ADD COLUMN     "freshnessHours" INTEGER DEFAULT 24,
ADD COLUMN     "official" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "BrandAlias" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "sourceId" TEXT,
    "token" TEXT NOT NULL,
    "kind" "AliasKind" NOT NULL DEFAULT 'EXACT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryMapping" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceToken" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOffer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalListingId" TEXT NOT NULL,
    "sourceProductUrl" TEXT NOT NULL,
    "purchaseUrl" TEXT NOT NULL DEFAULT '',
    "originalPrice" DECIMAL(10,2) NOT NULL,
    "originalCurrency" TEXT NOT NULL,
    "salePrice" DECIMAL(10,2),
    "normalizedEur" DECIMAL(10,2) NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availabilityUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtinRecord" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "gtinType" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GtinRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpnRecord" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "mpn" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MpnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "droppedCount" INTEGER NOT NULL DEFAULT 0,
    "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SourceSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductQuarantine" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalListingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "categoryToken" TEXT,
    "brandToken" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQuarantine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandAlias_brandId_idx" ON "BrandAlias"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandAlias_token_sourceId_key" ON "BrandAlias"("token", "sourceId");

-- CreateIndex
CREATE INDEX "CategoryMapping_categoryId_idx" ON "CategoryMapping"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMapping_sourceId_sourceToken_key" ON "CategoryMapping"("sourceId", "sourceToken");

-- CreateIndex
CREATE INDEX "ProductOffer_productId_idx" ON "ProductOffer"("productId");

-- CreateIndex
CREATE INDEX "ProductOffer_sourceId_idx" ON "ProductOffer"("sourceId");

-- CreateIndex
CREATE INDEX "ProductOffer_availability_idx" ON "ProductOffer"("availability");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOffer_sourceId_externalListingId_key" ON "ProductOffer"("sourceId", "externalListingId");

-- CreateIndex
CREATE INDEX "GtinRecord_gtin_idx" ON "GtinRecord"("gtin");

-- CreateIndex
CREATE INDEX "GtinRecord_productId_idx" ON "GtinRecord"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "GtinRecord_gtin_gtinType_sourceId_key" ON "GtinRecord"("gtin", "gtinType", "sourceId");

-- CreateIndex
CREATE INDEX "MpnRecord_brandId_mpn_idx" ON "MpnRecord"("brandId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "MpnRecord_brandId_mpn_sourceId_key" ON "MpnRecord"("brandId", "mpn", "sourceId");

-- CreateIndex
CREATE INDEX "SourceSyncRun_sourceId_idx" ON "SourceSyncRun"("sourceId");

-- CreateIndex
CREATE INDEX "SourceSyncRun_status_idx" ON "SourceSyncRun"("status");

-- CreateIndex
CREATE INDEX "ProductQuarantine_sourceId_idx" ON "ProductQuarantine"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductQuarantine_sourceId_externalListingId_key" ON "ProductQuarantine"("sourceId", "externalListingId");

-- AddForeignKey
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GtinRecord" ADD CONSTRAINT "GtinRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpnRecord" ADD CONSTRAINT "MpnRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpnRecord" ADD CONSTRAINT "MpnRecord_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSyncRun" ADD CONSTRAINT "SourceSyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQuarantine" ADD CONSTRAINT "ProductQuarantine_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
