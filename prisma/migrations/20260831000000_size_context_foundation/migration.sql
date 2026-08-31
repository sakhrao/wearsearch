-- CreateEnum
CREATE TYPE "SizeAudience" AS ENUM ('MEN', 'WOMEN', 'KIDS', 'UNISEX', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SizeProductType" AS ENUM ('CLOTHING', 'FOOTWEAR', 'ACCESSORY', 'HEADWEAR', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Size" ADD COLUMN     "audience" "SizeAudience" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "displayValue" TEXT,
ADD COLUMN     "numericValue" DOUBLE PRECISION,
ADD COLUMN     "ordinal" INTEGER,
ADD COLUMN     "productType" "SizeProductType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "subsystem" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Size_audience_productType_system_value_key" ON "Size"("audience", "productType", "system", "value");