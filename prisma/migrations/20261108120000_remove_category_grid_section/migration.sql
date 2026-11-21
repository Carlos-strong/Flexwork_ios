-- Section d'accueil « Parcourir les talents par domaine » (clé category_grid) retirée le
-- 2026-11-08 : son composant (CategoryGrid.tsx) n'existe plus. Sans cette suppression, la
-- section resterait éditable dans /backoffice/content/accueil sans jamais s'afficher.
-- Ses vignettes (FrontendSectionItem) partent avec elle (ON DELETE CASCADE).
DELETE FROM "FrontendSection" WHERE "key" = 'category_grid';
