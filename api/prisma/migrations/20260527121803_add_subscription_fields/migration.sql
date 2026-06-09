/*
  Warnings:

  - Added the required column `trial_ends_at` to the `Company` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'LOCKED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "payment_failed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "trial_ends_at" TIMESTAMP(3) NOT NULL;
