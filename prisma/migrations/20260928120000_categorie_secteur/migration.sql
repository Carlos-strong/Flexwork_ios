-- Secteur de la marketplace porté par la CATÉGORIE (2026-09-28).
--
-- Trois pôles — DIGITAL, BTP, SERVICES — regroupent les catégories de la taxonomie. Le
-- classement revient à l'administrateur : la colonne est NULLABLE et reste vide à
-- l'installation (« non classée »). Aucun backfill par libellé — même leçon que le palier de
-- risque et la barrière d'âge : une correspondance devinée sur le texte finit par ne
-- correspondre à rien.
CREATE TYPE "Secteur" AS ENUM ('digital', 'btp', 'services');

ALTER TABLE "categories" ADD COLUMN "secteur" "Secteur";
