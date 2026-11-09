-- Spécialités de diplômes alimentées par les prestataires (2026-11-07) : voir QualificationSpecialty.
-- CreateTable
CREATE TABLE "qualification_specialties" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "categorieId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualification_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qualification_specialties_normalized_key" ON "qualification_specialties"("normalized");

-- CreateIndex
CREATE INDEX "qualification_specialties_categorieId_idx" ON "qualification_specialties"("categorieId");

-- AddForeignKey
ALTER TABLE "qualification_specialties" ADD CONSTRAINT "qualification_specialties_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

