/*
  Warnings:

  - You are about to drop the column `templateId` on the `Resume` table. All the data in the column will be lost.
  - You are about to drop the `Template` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Resume" DROP CONSTRAINT "Resume_templateId_fkey";

-- AlterTable
ALTER TABLE "Resume" DROP COLUMN "templateId";

-- DropTable
DROP TABLE "Template";
