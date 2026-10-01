-- AlterTable
ALTER TABLE "Show" ADD COLUMN "addedById" TEXT;
ALTER TABLE "Show" ADD COLUMN "createdAt" DATETIME;

-- CreateIndex
CREATE INDEX "Show_addedById_createdAt_idx" ON "Show"("addedById", "createdAt");
