import { prisma } from "@/lib/db";
import { contractPrice } from "@/lib/escrow";
import type { ProofScope } from "@/lib/proof-appreciation";
import { canVerify, contractRole, type ValidationMode } from "@/lib/validation-mode";

// Portée d'un geste de validation de livrable : UN JALON, ou la MISSION entière quand le
// contrat n'est pas fractionné.
//
// Pourquoi ce module : huit routes existaient par paires jumelles — observe-progress,
// checkpoint, reject et validate/release avaient chacune une version jalon et une version
// mission, structurellement identiques à la table près. Même chargement du contrat, même
// contrôle de propriété, même garde de statut, même pré-validation des preuves, même garde
// anti-régression ; seuls changeaient la ligne où vit `observedProgress` (Jalon ou Mission) et
// le montant de référence (`jalon.montant` ou le prix du contrat). Toute règle corrigée d'un
// côté devait l'être de l'autre, sans rien pour signaler l'oubli — et c'est arrivé : la garde
// anti-régression de observe-progress a vécu un temps côté jalon seulement.
//
// Le contrat de ce module : les routes ne décident plus RIEN de la portée. Elles résolvent une
// `DeliverableScope`, lisent ses champs, et laissent les écritures aux fonctions d'ici.
export type DeliverableScope = {
  kind: "jalon" | "mission";
  missionId: string;
  jalonId: string | null;
  contractId: string;
  clientId: string;
  providerId: string;
  currency: string;
  missionTitre: string;
  financingMode: "lump_sum" | "progressive";
  retentionRate: number;
  // Statut qui gate la décision du client : celui du jalon, ou celui de la mission sans jalon.
  status: string;
  observedProgress: number;
  // Montant sur lequel portent les libérations : montant du jalon, ou prix du contrat.
  montant: number;
  jalonTitre: string | null;
  // Mode de vérification (2026-10-01) : en OPR, le responsable vérifie et transmet, le client
  // valide définitivement. `verifiedAt` = transmission du responsable pour CE livrable.
  validationMode: ValidationMode;
  siteManagerId: string | null;
  verifiedAt: Date | null;
  // Rôle de l'appelant sur ce contrat : le client, ou le responsable de chantier désigné.
  actorRole: "client" | "site_manager";
};

/**
 * Qui peut agir via cette résolution :
 *   - "client"   : le client propriétaire (gestes définitifs : point d'étape, validation) ;
 *   - "verifier" : celui qui vérifie — le client en « Moi-même », le responsable désigné en OPR
 *                  (appréciation des preuves, constat d'avancement, transmission) ;
 *   - "client_or_verifier" : l'un ou l'autre (refus renvoyé au prestataire).
 */
export type ScopeActor = "client" | "verifier" | "client_or_verifier";

export type ScopeResult =
  | { ok: true; scope: DeliverableScope }
  | { ok: false; error: string; status: number };

/**
 * Charge la portée pour le CLIENT propriétaire du contrat, ou explique le refus.
 *
 * @param jalonId  L'id du jalon visé, ou null pour la portée mission. Passer null sur un
 *                 contrat À jalons est une erreur d'aiguillage de l'appelant, pas une erreur
 *                 du client : la route renvoie alors `wrongScopeError` (« use_jalon_… »), qui
 *                 dit à l'UI d'appeler la variante jalon.
 */
export async function resolveClientDeliverableScope(args: {
  missionId: string;
  userId: string;
  jalonId: string | null;
  wrongScopeError: string;
  actor?: ScopeActor;
}): Promise<ScopeResult> {
  const contract = await prisma.prestationContract.findUnique({
    where: { missionId: args.missionId },
    include: {
      mission: true,
      jalons: { select: { id: true, titre: true, montant: true, status: true, observedProgress: true, verifiedAt: true } },
    },
  });
  // 404 et non 403 : un tiers n'apprend pas l'existence du contrat.
  if (!contract) return { ok: false, error: "not_found", status: 404 };
  const role = contractRole(contract, args.userId);
  if (role !== "client" && role !== "site_manager") return { ok: false, error: "not_found", status: 404 };

  const actor = args.actor ?? "client";
  const verifier = canVerify(contract, args.userId);
  if (actor === "client" && role !== "client") {
    // Le responsable voit le livrable, mais la décision définitive appartient au client.
    return { ok: false, error: "verification_only", status: 403 };
  }
  if (actor === "verifier" && !verifier) {
    // En OPR, le client ne vérifie pas lui-même : le geste revient au responsable désigné.
    return { ok: false, error: "site_manager_only", status: 409 };
  }
  if (actor === "client_or_verifier" && role !== "client" && !verifier) {
    return { ok: false, error: "not_found", status: 404 };
  }

  const base = {
    missionId: args.missionId,
    contractId: contract.id,
    clientId: contract.clientId,
    providerId: contract.providerId,
    currency: contract.mission.currency,
    missionTitre: contract.mission.titre,
    financingMode: contract.financingMode,
    retentionRate: contract.retentionRate,
    validationMode: contract.validationMode,
    siteManagerId: contract.siteManagerId,
    actorRole: role,
  };

  if (args.jalonId === null) {
    if (contract.jalons.length > 0) {
      return { ok: false, error: args.wrongScopeError, status: 409 };
    }
    return {
      ok: true,
      scope: {
        ...base,
        kind: "mission",
        jalonId: null,
        jalonTitre: null,
        status: contract.mission.status,
        observedProgress: contract.mission.observedProgress,
        montant: contractPrice(contract),
        verifiedAt: contract.mission.verifiedAt,
      },
    };
  }

  const jalon = contract.jalons.find((j) => j.id === args.jalonId);
  // Le jalon est cherché dans la liste DÉJÀ chargée avec le contrat : son appartenance est
  // garantie par construction, sans la requête dédiée que chaque route jalon faisait en plus.
  if (!jalon) return { ok: false, error: "not_found", status: 404 };

  return {
    ok: true,
    scope: {
      ...base,
      kind: "jalon",
      jalonId: jalon.id,
      jalonTitre: jalon.titre,
      status: jalon.status,
      observedProgress: jalon.observedProgress,
      montant: jalon.montant,
      verifiedAt: jalon.verifiedAt,
    },
  };
}

/**
 * Écriture de la transmission du responsable (mode OPR) — ou son effacement (`null`) quand le
 * livrable repart chez le prestataire. Même patron que `observedProgressUpdate`.
 */
export function verificationUpdate(
  scope: Pick<DeliverableScope, "jalonId" | "missionId">,
  verification: { verifiedAt: Date; verifiedById: string; verificationNote: string | null } | null
) {
  const data = verification ?? { verifiedAt: null, verifiedById: null, verificationNote: null };
  return scope.jalonId
    ? prisma.jalon.update({ where: { id: scope.jalonId }, data })
    : prisma.mission.update({ where: { id: scope.missionId }, data });
}

/**
 * Trace de la validation DÉFINITIVE du client (2026-10-01) : qui, et quand. Écrite dès que la
 * validation est acquise — avant même la confirmation PSP, qui est un autre fait, tracé ailleurs.
 */
export function clientValidationUpdate(scope: Pick<DeliverableScope, "jalonId" | "missionId">, clientId: string) {
  const data = { clientValidatedById: clientId, clientValidatedAt: new Date() };
  return scope.jalonId
    ? prisma.jalon.update({ where: { id: scope.jalonId }, data })
    : prisma.mission.update({ where: { id: scope.missionId }, data });
}

/** Portée pour la pré-validation des preuves (assertProofsValidated). */
export function proofScope(scope: DeliverableScope): ProofScope {
  return { missionId: scope.missionId, jalonId: scope.jalonId };
}

/** Portée pour les cumuls d'opérations PSP (totalReleasedAmount, releasedAmounts). */
export function escrowScope(
  scope: DeliverableScope
): { jalonId: string } | { contractId: string; jalonId: null } {
  return scope.jalonId
    ? { jalonId: scope.jalonId }
    : { contractId: scope.contractId, jalonId: null };
}

/**
 * Écriture de la progression constatée, sur la bonne ligne. Renvoie la promesse Prisma sans
 * l'attendre, pour être composable dans un `$transaction([...])` (cas de .../checkpoint, qui
 * écrit la progression et le ProgressCheckpoint d'un seul tenant).
 */
export function observedProgressUpdate(scope: DeliverableScope, progress: number) {
  return scope.jalonId
    ? prisma.jalon.update({ where: { id: scope.jalonId }, data: { observedProgress: progress } })
    : prisma.mission.update({ where: { id: scope.missionId }, data: { observedProgress: progress } });
}

/**
 * Désignation du livrable dans les messages adressés aux parties : « le jalon « Gros œuvre » »
 * ou simplement « le livrable ». Centralisée pour que les deux variantes d'une même
 * notification ne divergent pas de formulation.
 */
export function deliverableLabel(scope: DeliverableScope): string {
  return scope.jalonTitre ? `le jalon « ${scope.jalonTitre} »` : "le livrable";
}
