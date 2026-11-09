-- CreateEnum
CREATE TYPE "CatalogueStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "MasterMedicine" (
    "id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "genericName" TEXT NOT NULL DEFAULT '',
    "strength" TEXT NOT NULL DEFAULT '',
    "dosageForm" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "barcode" TEXT NOT NULL DEFAULT '',
    "registrationNumber" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CatalogueStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterMedicine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MasterMedicine_brandName_idx" ON "MasterMedicine"("brandName");

-- CreateIndex
CREATE INDEX "MasterMedicine_genericName_idx" ON "MasterMedicine"("genericName");

-- CreateIndex
CREATE INDEX "MasterMedicine_manufacturer_idx" ON "MasterMedicine"("manufacturer");

-- CreateIndex
CREATE INDEX "MasterMedicine_category_idx" ON "MasterMedicine"("category");

-- CreateIndex
CREATE INDEX "MasterMedicine_status_isActive_idx" ON "MasterMedicine"("status", "isActive");

-- CreateIndex
CREATE INDEX "MasterMedicine_barcode_idx" ON "MasterMedicine"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "MasterMedicine_brandName_genericName_strength_dosageForm_ma_key" ON "MasterMedicine"("brandName", "genericName", "strength", "dosageForm", "manufacturer");
