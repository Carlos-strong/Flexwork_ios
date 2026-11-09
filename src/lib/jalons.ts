// Paiement fractionné optionnel par jalons (2026-08-06) — un contrat peut être décomposé
// en jalons dont les montants somment exactement au prix convenu (proposition acceptée).
// Toute la logique de validation vit ici pour être testée une seule fois et réutilisée par
// la génération de contrat (POST /api/missions/[id]/contract) et par les routes /jalons/*.

import { canDecideDeliverable } from "@/lib/progress-rules";

export type JalonInput = { titre: string; montant: number };

// Tolérance flottant sur une comparaison de montants XOF. Exportée : le même seuil sert à
// décider qu'une somme de jalons vaut le prix du contrat (ici) et qu'un cumul de libérations
// couvre un montant dû (src/lib/psp-webhook.ts) — deux questions de la même nature, qui
// doivent répondre avec la même précision.
export const MONTANT_EPSILON = 0.01;

export function validateJalonsSum(jalons: JalonInput[], prixContrat: number): { ok: true } | { ok: false; error: string } {
  if (jalons.length === 0) {
    return { ok: false, error: "jalons_empty" };
  }
  if (jalons.some((j) => j.montant <= 0)) {
    return { ok: false, error: "jalon_montant_invalide" };
  }
  if (jalons.some((j) => j.titre.trim().length === 0)) {
    return { ok: false, error: "jalon_titre_requis" };
  }
  const total = jalons.reduce((sum, j) => sum + j.montant, 0);
  if (Math.abs(total - prixContrat) > MONTANT_EPSILON) {
    return { ok: false, error: "jalons_sum_mismatch" };
  }
  return { ok: true };
}

// Un jalon ne peut recevoir de livrable que s'il est financé (HOLD confirmé), rejeté (nouveau
// cycle), OU — signalé 2026-09-04 — en cours de validation PARTIELLE par le client
// (livrable_soumis avec observedProgress constaté entre 0 et 100 exclus, voir POST
// .../checkpoint) : le prestataire peut alors continuer à fournir des preuves pour atteindre
// les 100% sans attendre un rejet formel. Au-delà de 100% constatés, place à la clôture
// (validation finale ou rejet), pas à de nouvelles preuves — observedProgress reste à son
// défaut de 0 pour les appelants qui ne le passent pas (comportement historique inchangé).
export function canSubmitJalonDeliverable(status: string, observedProgress = 0): boolean {
  if (status === "fonds_sous_sequestre" || status === "rejete") return true;
  return status === "livrable_soumis" && observedProgress > 0 && observedProgress < 100;
}

// Le montant du jalon n'est pas encore engagé auprès du PSP : il reste donc à la fois
// FINANÇABLE (HOLD, POST .../hold) et REDÉCOUPABLE (POST .../split). Les deux gestes posaient
// la même question sous deux noms — `canHoldJalon` et `canSplitJalon` avaient le même corps.
// Une seule règle, un seul nom : une fois le HOLD transmis, ni l'un ni l'autre n'est possible.
export function isJalonUnengaged(status: string): boolean {
  return status === "en_attente";
}

// Le client ne peut valider/rejeter qu'un jalon dont le livrable a été soumis — règle commune
// au jalon et à la mission, voir canDecideDeliverable (src/lib/progress-rules.ts).
export const canDecideJalon = canDecideDeliverable;

// Règles de progression partagées avec le domaine MISSION — définies une seule fois dans
// src/lib/progress-rules.ts, ré-exportées ici pour que les routes du domaine jalon gardent un
// point d'import unique.
export { isValidProgress, isAboveProgressFloor } from "@/lib/progress-rules";

// Un jalon ne peut recevoir de progression déclarée (prestataire) que s'il n'est pas dans un
// état terminal — propre au jalon (le pendant mission, canReportMissionDeclaredProgress, porte
// une liste de statuts DIFFÉRENTE : ce n'est pas la même règle, il n'y a rien à mutualiser).
export function canReportDeclaredProgress(status: string): boolean {
  return status === "fonds_sous_sequestre" || status === "livrable_soumis" || status === "rejete";
}

export type JalonProgressInput = { montant: number; observedProgress: number };

// Progression GLOBALE de la mission, pondérée par montant (règle de gestion des jalons
// §18.14, 2026-09-08) :
//
//   Σ(montant_jalon × observedProgress_jalon) / Σ(montant_jalon)
//
// Remplace l'ancien calcul (jalons.filter(status === "libere").length / jalons.length),
// dupliqué dans provider-summary/route.ts et MesMissions.tsx, qui avait deux défauts : (1) il
// ignorait tout jalon pas encore LIBÉRÉ, même constaté à 65% par le client — un jalon en
// cours de validation partielle comptait pour 0 ; (2) il pondérait chaque jalon à parts
// égales, alors que des jalons de montants différents ne pèsent pas pareil dans l'avancement
// réel de la mission (un jalon à 300 000 XOF validé à 100% ne vaut pas la même chose qu'un
// jalon à 50 000 XOF au même taux). `observedProgress` reste la SEULE source (jamais
// declaredProgress, purement déclaratif côté prestataire, voir isAboveProgressFloor
// ci-dessus) — un jalon `libere` a nécessairement observedProgress === 100 (gate de
// POST .../validate), donc déjà pleinement représenté ici sans cas particulier à coder.
//
// Retourne 0 si la liste est vide ou si la somme des montants est nulle (garde contre une
// division par zéro — ne devrait pas arriver en pratique, validateJalonsSum exige des
// montants strictement positifs à la création).
export function weightedJalonsProgress(jalons: JalonProgressInput[]): number {
  if (jalons.length === 0) return 0;
  const totalMontant = jalons.reduce((sum, j) => sum + j.montant, 0);
  if (totalMontant <= 0) return 0;
  const weighted = jalons.reduce((sum, j) => sum + j.montant * j.observedProgress, 0);
  return Math.round(weighted / totalMontant);
}

// ── Financement progressif (règle 18.4, PrestationContract.financingMode) ──────────────────
// Fonctions génériques (montant + pourcentages en paramètres, pas de dépendance à `Jalon` ni
// Prisma) — réutilisées TELLES QUELLES par les routes .../checkpoint et .../validate, avec OU
// sans jalon (voir le commentaire sur `financingMode`, prisma/schema.prisma) : un contrat sans
// jalon applique la même mécanique sur son prix total plutôt que sur `jalon.montant`.

// Cumul qui DOIT avoir été libéré à un taux de progression donné — et non l'incrément depuis
// le palier précédent. Raisonner en cible rend le calcul indépendant du chemin parcouru : peu
// importe par quelle route `observedProgress` a bougé, et peu importe qu'un palier ait été
// confirmé deux fois, le montant dû à ce stade est le même. L'incrément réellement instruit est
// la différence avec ce qui est déjà parti, calculée sous verrou (emitScopedRelease,
// src/lib/escrow.ts).
//
// Arrondi à l'unité (le XOF n'a pas de sous-unité courante) ; l'arrondi de la cible finale
// retombe exactement sur `plafond` à 100 %, donc aucun résidu ne subsiste à la clôture.
export function progressiveReleaseTarget(plafond: number, progress: number): number {
  const borne = Math.min(100, Math.max(0, progress));
  return Math.round((plafond * borne) / 100);
}

// Solde restant réellement libérable — jamais négatif (protège contre un dépassement par
// cumul d'arrondis ou un double appel concurrent : le total libéré sur la vie d'un jalon/d'un
// contrat sans jalon ne peut jamais dépasser `montant`, condition 18.3). Utilisé par
// POST .../validate en mode progressif : la clôture ne transmet que ce qui n'a pas déjà été
// libéré par les points d'étape successifs, jamais `montant` en entier une seconde fois.
export function remainingReleasableAmount(montant: number, alreadyReleased: number): number {
  return Math.max(0, montant - alreadyReleased);
}

// ── Retenue de garantie (règle 18.10, PrestationContract.retentionRate, mode J4) ────────────
// Une fraction de CHAQUE jalon reste au séquestre au moment où le jalon est libéré, et n'est
// versée qu'en UNE SEULE instruction finale, une fois tous les jalons du contrat `libere`
// (voir closeJalonFullyReleased, src/lib/psp-webhook.ts). C'est le seul levier de la
// plateforme contre l'abandon en cours de route : sans lui, un prestataire encaisse 100 % du
// jalon 1 et peut disparaître avant le jalon 2 — le client n'a alors que la médiation.
//
// Fonctions génériques (montant + taux), sans dépendance à `Jalon` ni Prisma, exactement comme
// le bloc « financement progressif » ci-dessus : elles s'appliquent telles quelles partout où
// un montant est libéré.

// Part retenue sur un montant donné. Arrondie à l'unité (le XOF n'a pas de sous-unité
// courante), même convention que `progressiveReleaseIncrement`. Un taux nul ou négatif ne
// retient rien — c'est le cas de TOUS les modes sauf J4, donc le chemin par défaut.
export function retentionAmount(montant: number, retentionRate: number): number {
  if (!Number.isFinite(retentionRate) || retentionRate <= 0) return 0;
  return Math.round(montant * retentionRate);
}

// Plafond réellement libérable sur un jalon AVANT la libération finale de la retenue. Sans
// retenue (taux 0), c'est le montant plein : tout le code appelant peut donc l'utiliser
// inconditionnellement, sans brancher sur le mode — le comportement historique est le cas
// particulier `retentionRate === 0`, pas une branche séparée.
export function releasableBeforeRetention(montant: number, retentionRate: number): number {
  return montant - retentionAmount(montant, retentionRate);
}

// Retenue cumulée d'un contrat = somme des retenues de chaque jalon. Calculée jalon par jalon
// (et non `retentionAmount(prixContrat)`) pour que la somme des libérations partielles + la
// libération finale retombe EXACTEMENT sur le prix du contrat : chaque jalon a déjà libéré
// `montant − retentionAmount(montant)`, arrondi compris. Passer par le prix total ferait
// diverger les deux calculs d'un franc ou deux par jalon, c'est-à-dire laisser un résidu
// séquestré que plus aucune instruction ne viendrait chercher.
export function totalRetentionAmount(jalons: { montant: number }[], retentionRate: number): number {
  return jalons.reduce((sum, j) => sum + retentionAmount(j.montant, retentionRate), 0);
}

// ── Jalons séquentiels (règle 18.8/18.9, PrestationContract.jalonsSequential) ───────────────
// Un jalon ne peut être financé (HOLD) que si tous les jalons d'ordre inférieur sont au moins
// `valide` (le client a validé — inutile d'attendre la confirmation PSP asynchrone du RELEASE
// du jalon précédent, potentiellement lente en prod avec un vrai PSP). Sans effet si
// `sequential` est faux (comportement historique : canHoldJalon seul suffit, tous les jalons
// finançables dans n'importe quel ordre).
const UNLOCKED_FOR_SEQUENTIAL: readonly string[] = ["valide", "libere"];

// Premier jalon ANTÉRIEUR qui empêche encore le financement de `ordre`, ou null s'il n'y en a
// plus. Même règle et même liste de statuts que `canHoldJalonSequential` ci-dessous — c'est
// tout l'objet de cette fonction : la route .../hold reconstruisait ce calcul à la main pour
// nommer le jalon bloquant dans son message d'erreur, avec sa propre copie de
// UNLOCKED_FOR_SEQUENTIAL. Deux endroits où changer la règle, c'est un endroit de trop.
export function firstBlockingSequentialJalon<T extends { ordre: number; status: string }>(
  ordre: number,
  siblingJalons: T[]
): T | null {
  return (
    siblingJalons
      .filter((j) => j.ordre < ordre && !UNLOCKED_FOR_SEQUENTIAL.includes(j.status))
      .sort((a, b) => a.ordre - b.ordre)[0] ?? null
  );
}

export function canHoldJalonSequential(
  status: string,
  ordre: number,
  siblingJalons: { ordre: number; status: string }[],
  sequential: boolean
): boolean {
  if (!isJalonUnengaged(status)) return false;
  if (!sequential) return true;
  return firstBlockingSequentialJalon(ordre, siblingJalons) === null;
}
