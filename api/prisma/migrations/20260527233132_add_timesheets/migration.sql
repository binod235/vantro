/*
  Warnings:

  - You are about to drop the column `clock_in` on the `Timesheet` table. All the data in the column will be lost.
  - You are about to drop the column `clock_out` on the `Timesheet` table. All the data in the column will be lost.
  - You are about to drop the column `mileage` on the `Timesheet` table. All the data in the column will be lost.
  - Added the required column `company_id` to the `Timesheet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date` to the `Timesheet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `duration_minutes` to the `Timesheet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `finish_time` to the `Timesheet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hourly_rate_pence` to the `Timesheet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start_time` to the `Timesheet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total_pence` to the `Timesheet` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BillingRate" AS ENUM ('STANDARD', 'OVERTIME', 'DOUBLE_TIME', 'UNPAID');

-- DropForeignKey
ALTER TABLE "Timesheet" DROP CONSTRAINT "Timesheet_job_id_fkey";

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "double_time_rate_pence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtime_rate_pence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "standard_rate_pence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Timesheet" DROP COLUMN "clock_in",
DROP COLUMN "clock_out",
DROP COLUMN "mileage",
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" TEXT,
ADD COLUMN     "billing_rate" "BillingRate" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "break_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "company_id" TEXT NOT NULL,
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "duration_minutes" INTEGER NOT NULL,
ADD COLUMN     "finish_time" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "hourly_rate_pence" INTEGER NOT NULL,
ADD COLUMN     "is_approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "start_time" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "total_pence" INTEGER NOT NULL,
ALTER COLUMN "job_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Timesheet_company_id_idx" ON "Timesheet"("company_id");

-- CreateIndex
CREATE INDEX "Timesheet_user_id_idx" ON "Timesheet"("user_id");

-- CreateIndex
CREATE INDEX "Timesheet_job_id_idx" ON "Timesheet"("job_id");

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
