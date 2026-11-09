-- Le palier de risque devient une propriété du métier (2026-09-24).
--
-- Il vivait dans "DomainRiskLevel", indexée sur un libellé libre + un pays. Sur les 220 métiers
-- du catalogue, 4 seulement y trouvaient une ligne, et les 4 lignes « high » n'en désignaient
-- aucun : le palier élevé n'était donc jamais atteint, et l'obligation d'assurance qui en
-- dépend (candidature, séquestre) n'a jamais pu se déclencher.
--
-- La reprise ci-dessous ne recopie QUE ce qui correspond réellement — les libellés identiques
-- dans les deux tables. Rien n'est deviné : laisser un métier à `low` par défaut est exact
-- (c'est ce que le code faisait déjà, faute de ligne), alors qu'inventer un rapprochement
-- classerait des métiers à haut risque que personne n'a évalués.
ALTER TABLE "metiers" ADD COLUMN "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low';

UPDATE "metiers" m
SET "riskLevel" = d."riskLevel"
FROM "DomainRiskLevel" d
WHERE d."domain" = m.libelle
  -- La règle du modèle est « assurance obligatoire si et seulement si le palier est high ».
  -- Un `insuranceRequired` à true sur un palier plus bas n'aurait aucun sens ici : on ne
  -- recopie que les paliers, et l'assurance se déduit du palier.
  AND d."riskLevel" IN ('medium', 'high');
