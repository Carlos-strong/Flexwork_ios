-- CreateEnum
CREATE TYPE "MissionMode" AS ENUM ('distance', 'presentiel', 'hybride');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "mode" "MissionMode" NOT NULL DEFAULT 'presentiel';
