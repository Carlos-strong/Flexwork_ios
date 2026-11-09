-- CreateEnum
CREATE TYPE "FrontendStatus" AS ENUM ('brouillon', 'publie', 'desactive', 'archive');

-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'frontend';

-- CreateTable
CREATE TABLE "TaxonomyDomain" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontendStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomySpecialty" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontendStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomySpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyCompetency" (
    "id" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontendStatus" NOT NULL DEFAULT 'brouillon',
    "verificationExpected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontendSection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "ctaText" TEXT,
    "ctaLink" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontendStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontendSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontendSectionItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sublabel" TEXT,
    "href" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontendStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontendSectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontendMenuItem" (
    "id" TEXT NOT NULL,
    "menu" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontendStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontendMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontendPage" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "status" "FrontendStatus" NOT NULL DEFAULT 'publie',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontendPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontendSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontendSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "FrontendRelease" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "note" TEXT,
    "rolledBackFromVersion" INTEGER,

    CONSTRAINT "FrontendRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyDomain_slug_key" ON "TaxonomyDomain"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyDomain_name_key" ON "TaxonomyDomain"("name");

-- CreateIndex
CREATE INDEX "TaxonomyDomain_status_sortOrder_idx" ON "TaxonomyDomain"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "TaxonomySpecialty_domainId_sortOrder_idx" ON "TaxonomySpecialty"("domainId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomySpecialty_domainId_slug_key" ON "TaxonomySpecialty"("domainId", "slug");

-- CreateIndex
CREATE INDEX "TaxonomyCompetency_specialtyId_sortOrder_idx" ON "TaxonomyCompetency"("specialtyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyCompetency_specialtyId_slug_key" ON "TaxonomyCompetency"("specialtyId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "FrontendSection_key_key" ON "FrontendSection"("key");

-- CreateIndex
CREATE INDEX "FrontendSection_status_sortOrder_idx" ON "FrontendSection"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "FrontendSectionItem_sectionId_sortOrder_idx" ON "FrontendSectionItem"("sectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "FrontendMenuItem_menu_sortOrder_idx" ON "FrontendMenuItem"("menu", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FrontendPage_path_key" ON "FrontendPage"("path");

-- CreateIndex
CREATE UNIQUE INDEX "FrontendRelease_version_key" ON "FrontendRelease"("version");

-- CreateIndex
CREATE INDEX "FrontendRelease_publishedAt_idx" ON "FrontendRelease"("publishedAt");

-- AddForeignKey
ALTER TABLE "TaxonomySpecialty" ADD CONSTRAINT "TaxonomySpecialty_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "TaxonomyDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyCompetency" ADD CONSTRAINT "TaxonomyCompetency_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "TaxonomySpecialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrontendSectionItem" ADD CONSTRAINT "FrontendSectionItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "FrontendSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrontendRelease" ADD CONSTRAINT "FrontendRelease_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
