/*
  Warnings:

  - You are about to drop the `CardBoardMember` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CardBoardMember" DROP CONSTRAINT "CardBoardMember_boardId_userId_fkey";

-- DropForeignKey
ALTER TABLE "CardBoardMember" DROP CONSTRAINT "CardBoardMember_cardId_fkey";

-- DropTable
DROP TABLE "CardBoardMember";
