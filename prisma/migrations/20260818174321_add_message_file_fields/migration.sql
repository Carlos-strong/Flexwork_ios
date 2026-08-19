-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'text';
