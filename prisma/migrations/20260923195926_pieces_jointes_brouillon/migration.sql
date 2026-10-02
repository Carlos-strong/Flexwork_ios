-- CreateTable
CREATE TABLE "MissionDraftAttachment" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionDraftAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionDraftAttachment_uploaderId_draftId_idx" ON "MissionDraftAttachment"("uploaderId", "draftId");

-- AddForeignKey
ALTER TABLE "MissionDraftAttachment" ADD CONSTRAINT "MissionDraftAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
