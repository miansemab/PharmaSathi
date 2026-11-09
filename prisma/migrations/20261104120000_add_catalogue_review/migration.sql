-- CreateTable
CREATE TABLE "CatalogueReview" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "CatalogueStatus" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogueReview_medicineId_createdAt_idx"
ON "CatalogueReview"("medicineId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogueReview_reviewerId_createdAt_idx"
ON "CatalogueReview"("reviewerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CatalogueReview"
ADD CONSTRAINT "CatalogueReview_medicineId_fkey"
FOREIGN KEY ("medicineId") REFERENCES "MasterMedicine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueReview"
ADD CONSTRAINT "CatalogueReview_reviewerId_fkey"
FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
