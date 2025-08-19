/*
  Warnings:

  - You are about to drop the `Attachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CardLabel` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Label` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_cardId_fkey";

-- DropForeignKey
ALTER TABLE "CardLabel" DROP CONSTRAINT "CardLabel_cardId_fkey";

-- DropForeignKey
ALTER TABLE "CardLabel" DROP CONSTRAINT "CardLabel_labelId_fkey";

-- DropForeignKey
ALTER TABLE "Label" DROP CONSTRAINT "Label_boardId_fkey";

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "imageUrl" TEXT;

-- DropTable
DROP TABLE "Attachment";

-- DropTable
DROP TABLE "CardLabel";

-- DropTable
DROP TABLE "Label";
