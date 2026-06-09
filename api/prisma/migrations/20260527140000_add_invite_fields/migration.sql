-- AlterTable
ALTER TABLE "user" ADD COLUMN "invite_token" TEXT,
ADD COLUMN "invite_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "user_invite_token_key" ON "user"("invite_token");
