/*
  Warnings:

  - You are about to drop the column `appreciationPercent` on the `MissionAttachment` table. All the data in the column will be lost.
  - You are about to drop the column `partialComment` on the `MissionAttachment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MissionAttachment" DROP COLUMN "appreciationPercent",
DROP COLUMN "partialComment";
