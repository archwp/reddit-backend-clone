/*
  Warnings:

  - You are about to drop the `Clinic` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Clinic" DROP CONSTRAINT "Clinic_doctorId_fkey";

-- DropTable
DROP TABLE "Clinic";
