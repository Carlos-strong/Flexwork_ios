import crypto from "crypto";

// Chaîne de hash append-only générique, réutilisée par ProfessionalDeclaration (Phase 3),
// PrestationContract (Phase 4) et VerificationHistoryEntry (Phase 8) — un seul mécanisme,
// jamais réimplémenté séparément (etat-consolide-Flexwork.md §1.3 : « traçabilité
// append-only avec hash chaîné »).
export function computeChainedHash(previousHash: string | null, payload: Record<string, unknown>): string {
  const material = `${previousHash ?? ""}:${JSON.stringify(payload)}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

// Vérifie qu'une chaîne (ordonnée du plus ancien au plus récent) n'a pas été altérée :
// chaque maillon doit être le hash de son payload concaténé au hash précédent.
export function verifyChainIntegrity(
  entries: Array<{ previousHash: string | null; currentHash: string; payload: Record<string, unknown> }>
): boolean {
  let expectedPrevious: string | null = null;
  for (const entry of entries) {
    if (entry.previousHash !== expectedPrevious) return false;
    const recomputed = computeChainedHash(entry.previousHash, entry.payload);
    if (recomputed !== entry.currentHash) return false;
    expectedPrevious = entry.currentHash;
  }
  return true;
}
