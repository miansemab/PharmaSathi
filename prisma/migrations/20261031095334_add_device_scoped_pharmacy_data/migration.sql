-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "barcode" TEXT NOT NULL DEFAULT '',
    "minimumStock" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineBatch" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicineBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "supplierId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierInvoice" TEXT NOT NULL DEFAULT '',
    "total" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "unitSalePrice" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "customerId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "changeDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "deviceId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceCode_key" ON "Device"("deviceCode");

-- CreateIndex
CREATE INDEX "Device_pharmacyId_idx" ON "Device"("pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_id_pharmacyId_key" ON "Device"("id", "pharmacyId");

-- CreateIndex
CREATE INDEX "Medicine_pharmacyId_deviceId_idx" ON "Medicine"("pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "Medicine_deviceId_name_idx" ON "Medicine"("deviceId", "name");

-- CreateIndex
CREATE INDEX "Medicine_deviceId_barcode_idx" ON "Medicine"("deviceId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Medicine_deviceId_localId_key" ON "Medicine"("deviceId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "Medicine_id_pharmacyId_deviceId_key" ON "Medicine"("id", "pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "MedicineBatch_pharmacyId_deviceId_idx" ON "MedicineBatch"("pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "MedicineBatch_deviceId_expiryDate_idx" ON "MedicineBatch"("deviceId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_deviceId_localId_key" ON "MedicineBatch"("deviceId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_medicineId_batchNumber_key" ON "MedicineBatch"("medicineId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_id_pharmacyId_deviceId_key" ON "MedicineBatch"("id", "pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "Supplier_pharmacyId_deviceId_idx" ON "Supplier"("pharmacyId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_deviceId_localId_key" ON "Supplier"("deviceId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_pharmacyId_deviceId_key" ON "Supplier"("id", "pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "Customer_pharmacyId_deviceId_idx" ON "Customer"("pharmacyId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_deviceId_localId_key" ON "Customer"("deviceId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_pharmacyId_deviceId_key" ON "Customer"("id", "pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "Purchase_pharmacyId_deviceId_idx" ON "Purchase"("pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "Purchase_deviceId_createdAt_idx" ON "Purchase"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_deviceId_localId_key" ON "Purchase"("deviceId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_deviceId_invoiceNumber_key" ON "Purchase"("deviceId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_id_pharmacyId_deviceId_key" ON "Purchase"("id", "pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_deviceId_medicineId_idx" ON "PurchaseItem"("deviceId", "medicineId");

-- CreateIndex
CREATE INDEX "Sale_pharmacyId_deviceId_idx" ON "Sale"("pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "Sale_deviceId_createdAt_idx" ON "Sale"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_deviceId_localId_key" ON "Sale"("deviceId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_deviceId_invoiceNumber_key" ON "Sale"("deviceId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_id_pharmacyId_deviceId_key" ON "Sale"("id", "pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_deviceId_medicineId_idx" ON "SaleItem"("deviceId", "medicineId");

-- CreateIndex
CREATE INDEX "SyncEvent_pharmacyId_deviceId_idx" ON "SyncEvent"("pharmacyId", "deviceId");

-- CreateIndex
CREATE INDEX "SyncEvent_deviceId_status_idx" ON "SyncEvent"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEvent_deviceId_localEventId_key" ON "SyncEvent"("deviceId", "localEventId");

-- CreateIndex
CREATE INDEX "AuditLog_pharmacyId_createdAt_idx" ON "AuditLog"("pharmacyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_deviceId_createdAt_idx" ON "AuditLog"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_medicineId_pharmacyId_deviceId_fkey" FOREIGN KEY ("medicineId", "pharmacyId", "deviceId") REFERENCES "Medicine"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_pharmacyId_deviceId_fkey" FOREIGN KEY ("supplierId", "pharmacyId", "deviceId") REFERENCES "Supplier"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_pharmacyId_deviceId_fkey" FOREIGN KEY ("purchaseId", "pharmacyId", "deviceId") REFERENCES "Purchase"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_medicineId_pharmacyId_deviceId_fkey" FOREIGN KEY ("medicineId", "pharmacyId", "deviceId") REFERENCES "Medicine"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_batchId_pharmacyId_deviceId_fkey" FOREIGN KEY ("batchId", "pharmacyId", "deviceId") REFERENCES "MedicineBatch"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_pharmacyId_deviceId_fkey" FOREIGN KEY ("customerId", "pharmacyId", "deviceId") REFERENCES "Customer"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_pharmacyId_deviceId_fkey" FOREIGN KEY ("saleId", "pharmacyId", "deviceId") REFERENCES "Sale"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_medicineId_pharmacyId_deviceId_fkey" FOREIGN KEY ("medicineId", "pharmacyId", "deviceId") REFERENCES "Medicine"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_batchId_pharmacyId_deviceId_fkey" FOREIGN KEY ("batchId", "pharmacyId", "deviceId") REFERENCES "MedicineBatch"("id", "pharmacyId", "deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvent" ADD CONSTRAINT "SyncEvent_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvent" ADD CONSTRAINT "SyncEvent_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_deviceId_pharmacyId_fkey" FOREIGN KEY ("deviceId", "pharmacyId") REFERENCES "Device"("id", "pharmacyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
