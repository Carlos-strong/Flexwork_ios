-- Mode de pointage d'une mission au temps (2026-10-01).
--
-- Règle de validation des relevés de présence, posée par le client à la publication :
-- « totale » (un relevé se valide en entier, ou se refuse / se conteste) ou « partielle » (le
-- validateur peut n'en reconnaître qu'une partie). Nulle hors mission au temps.
--
-- Figée au contrat dans SpotTimeTerms. Les contrats existants prennent « partielle » : c'est le
-- comportement qu'ils avaient jusqu'ici, aucun n'a été signé sous une autre règle.
CREATE TYPE "AttendanceValidation" AS ENUM ('totale', 'partielle');

ALTER TABLE "Mission" ADD COLUMN "attendanceValidation" "AttendanceValidation";

ALTER TABLE "SpotTimeTerms" ADD COLUMN "attendanceValidation" "AttendanceValidation" NOT NULL DEFAULT 'partielle';
