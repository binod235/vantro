-- CreateEnum
CREATE TYPE "IntakeMethod" AS ENUM ('MANUAL', 'EMAIL', 'DIRECT_LINK');

-- AlterTable: add slug to Company
ALTER TABLE "Company" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- AlterTable: add intake_method to Enquiry
ALTER TABLE "Enquiry" ADD COLUMN "intake_method" "IntakeMethod" NOT NULL DEFAULT 'MANUAL';
