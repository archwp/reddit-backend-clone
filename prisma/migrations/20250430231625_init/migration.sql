/*
  Warnings:

  - The primary key for the `BoardMember` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[boardId,userId]` on the table `BoardMember` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BoardMember" DROP CONSTRAINT "BoardMember_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ALTER COLUMN "role" SET DEFAULT 'member',
ADD CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "_CardBoardMembers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CardBoardMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CardBoardMembers_B_index" ON "_CardBoardMembers"("B");

-- CreateIndex
CREATE UNIQUE INDEX "BoardMember_boardId_userId_key" ON "BoardMember"("boardId", "userId");

-- AddForeignKey
ALTER TABLE "_CardBoardMembers" ADD CONSTRAINT "_CardBoardMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "BoardMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CardBoardMembers" ADD CONSTRAINT "_CardBoardMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
