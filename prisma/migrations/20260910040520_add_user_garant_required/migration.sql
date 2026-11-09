-- AlterTable
ALTER TABLE "User" ADD COLUMN     "garantRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "garantRequiredSetAt" TIMESTAMP(3),
ADD COLUMN     "garantRequiredSetById" TEXT;
