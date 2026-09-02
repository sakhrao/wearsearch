-- CreateTable
CREATE TABLE "ProductOfferVariant" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "externalVariantId" TEXT,
    "variantKey" TEXT NOT NULL,
    "sku" TEXT,
    "gtin" TEXT,
    "gtinType" TEXT,
    "color" TEXT,
    "sizeValue" TEXT,
    "sizeSystem" TEXT,
    "sizeProductType" TEXT,
    "sizeAudience" TEXT,
    "availability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "originalPrice" DECIMAL(10,2) NOT NULL,
    "originalCurrency" TEXT NOT NULL,
    "salePrice" DECIMAL(10,2),
    "normalizedEur" DECIMAL(10,2),
    "purchaseUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availabilityUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOfferVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductOfferVariant_offerId_idx" ON "ProductOfferVariant"("offerId");

-- CreateIndex
CREATE INDEX "ProductOfferVariant_gtin_idx" ON "ProductOfferVariant"("gtin");

-- CreateIndex
CREATE INDEX "ProductOfferVariant_availability_idx" ON "ProductOfferVariant"("availability");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOfferVariant_offerId_variantKey_key" ON "ProductOfferVariant"("offerId", "variantKey");

-- AddForeignKey
ALTER TABLE "ProductOfferVariant" ADD CONSTRAINT "ProductOfferVariant_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ProductOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
