-- AlterTable
ALTER TABLE "PrivateMessage" ADD COLUMN     "replyToId" INTEGER;

-- CreateIndex
CREATE INDEX "PrivateMessage_replyToId_idx" ON "PrivateMessage"("replyToId");

-- AddForeignKey
ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "PrivateMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
