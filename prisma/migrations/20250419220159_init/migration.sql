/*
  Warnings:

  - You are about to drop the `Skill` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_ProfileSkills` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `bio` on table `Profile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `resumeUrl` on table `Profile` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "_ProfileSkills" DROP CONSTRAINT "_ProfileSkills_A_fkey";

-- DropForeignKey
ALTER TABLE "_ProfileSkills" DROP CONSTRAINT "_ProfileSkills_B_fkey";

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "skills" TEXT[],
ALTER COLUMN "bio" SET NOT NULL,
ALTER COLUMN "resumeUrl" SET NOT NULL;

-- DropTable
DROP TABLE "Skill";

-- DropTable
DROP TABLE "_ProfileSkills";
