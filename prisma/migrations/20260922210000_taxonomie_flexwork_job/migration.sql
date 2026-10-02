-- DropForeignKey
ALTER TABLE "TaxonomyCompetency" DROP CONSTRAINT "TaxonomyCompetency_specialtyId_fkey";

-- DropForeignKey
ALTER TABLE "TaxonomySpecialty" DROP CONSTRAINT "TaxonomySpecialty_domainId_fkey";

-- DropTable
DROP TABLE "TaxonomyCompetency";

-- DropTable
DROP TABLE "TaxonomyDomain";

-- DropTable
DROP TABLE "TaxonomySpecialty";

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metiers" (
    "id" TEXT NOT NULL,
    "categorieId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "metiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "metierId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "description" TEXT,
    "dureeEstimee" INTEGER,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_libelle_key" ON "categories"("libelle");

-- CreateIndex
CREATE INDEX "metiers_categorieId_idx" ON "metiers"("categorieId");

-- CreateIndex
CREATE UNIQUE INDEX "metiers_categorieId_libelle_key" ON "metiers"("categorieId", "libelle");

-- CreateIndex
CREATE INDEX "services_metierId_idx" ON "services"("metierId");

-- CreateIndex
CREATE UNIQUE INDEX "services_metierId_libelle_key" ON "services"("metierId", "libelle");

-- AddForeignKey
ALTER TABLE "metiers" ADD CONSTRAINT "metiers_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_metierId_fkey" FOREIGN KEY ("metierId") REFERENCES "metiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

