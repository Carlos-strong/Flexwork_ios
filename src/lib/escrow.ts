import { randomUUID } from "crypto";
import type { Prisma, PspEscrowOperation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { IN_FLIGHT_STATUSES } from "@/lib/escrow-instructions";
import { isFeatureEnabledForZone } from "@/lib/feature-flags";
import { canStartMission, coversAmount } from "@/lib/mission-risk-gate";
import {
  autoConfirmPending,
  isVirtualPspEnabled,
  shouldAutoConfirmStub,
  virtualPspName,
} from "@/lib/psp-virtual";

// Le montant séquestré doit être le PRIX DU CONTRAT (termsSnapshot.prix = montant de la
// proposition acceptée), pas le budget initialement publié de la mission : une contre-
// proposition acceptée à un prix différent du budget publié ne doit pas être séquestrée au
// mauvais montant (écart pointé dans l'analyse du workflow mission, 2026-08-30). Fallback
// sur mission.budget uniquement pour les contrats générés avant que termsSnapshot.prix
// existe (anciens contrats — le snapshot est un JSON immuable, pas de backfill possible).
export function contractPrice(contract: {
  mission: { budget: number };
  termsSnapshot: unknown;
}): number {
  const snapshot = contract.termsSnapshot as { prix?: number } | null;
  return typeof snapshot?.prix === "number" && snapshot.prix > 0
    ? snapshot.prix
    : contract.mission.budget;
}

// Instruction HOLD au PSP pour le prix total du contrat (contrat SANS jalon). Source UNIQUE
// des garde-fous, partagée par :
//   - POST /api/missions/[id]/escrow/hold (déclenchement manuel par le client) ;
//   - POST /api/signature/sign (déclenchement AUTOMATIQUE après la 2ᵉ signature — workflow
//     étape 5 : la contre-signature du client déclenche le paiement sécurisé).
// L'autorisation (seul le client peut financer) reste à la charge de l'appelant : ici on ne
// reçoit que le contractId, pas de userId — le déclenchement automatique n'a pas d'acteur.
export async function requestContractHold(
  contractId: string
): Promise<
  { ok: true; operation: PspEscrowOperation } | { ok: false; error: string; status: number }
> {
  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    include: { client: true, mission: true, jalons: { select: { id: true } } },
  });
  if (!contract) return { ok: false, error: "not_found", status: 404 };
  if (!contract.clientSignedAt || !contract.providerSignedAt) {
    return { ok: false, error: "contract_not_signed", status: 409 };
  }
  // Paiement fractionné : ce contrat a des jalons, chacun se finance individuellement via
  // POST /api/missions/[id]/jalons/[jalonId]/hold — pas de HOLD global possible.
  if (contract.jalons.length > 0) {
    return { ok: false, error: "use_jalon_hold", status: 409 };
  }

  const enabled = await isFeatureEnabledForZone("psp_montage_valide", contract.client.country ?? "BJ");
  if (!enabled) {
    return { ok: false, error: "psp_not_enabled", status: 403 };
  }

  // Un HOLD déjà en vol (`pending`) ou abouti (`confirmed`) interdit d'en transmettre un
  // second — mais un HOLD `failed` (paiement Mobile Money refusé, PSP indisponible) ne doit
  // PAS condamner le contrat : avant 2026-09-10 ce `findFirst` ne filtrait pas sur le statut,
  // donc le moindre échec rendait la mission définitivement infinançable (aucune route ne
  // permet de supprimer une opération). Le client peut désormais simplement réessayer.
  if (await hasInFlightHold({ contractId: contract.id })) {
    return { ok: false, error: "hold_already_requested", status: 409 };
  }

  if (contract.mission.riskLevel === "high") {
    const activeInsurance = await prisma.missionInsurance.findUnique({
      where: { missionId: contract.missionId },
    });
    const hasCoverage = activeInsurance?.status === "active" && activeInsurance.coverageEnd > new Date();
    if (!canStartMission(contract.mission.riskLevel, hasCoverage)) {
      return { ok: false, error: "effective_insurance_required", status: 403 };
    }
    // La couverture doit porter sur l'EXPOSITION réelle, c'est-à-dire le prix du contrat — et
    // non se contenter d'exister (voir coversAmount, src/lib/mission-risk-gate.ts).
    if (!coversAmount(activeInsurance!.coverageCeiling, contractPrice(contract))) {
      return { ok: false, error: "insurance_ceiling_too_low", status: 403 };
    }
  }

  const operation = await prisma.pspEscrowOperation.create({
    data: {
      contractId: contract.id,
      pspName: virtualPspName(),
      pspReference: `hold_${randomUUID()}`,
      amount: contractPrice(contract),
      currency: contract.mission.currency,
      instructionType: "hold",
    },
  });

  // PSP virtuelle (développement) : en mode autoconfirm (ESCROW_STUB_AUTOCONFIRM=true), la
  // confirmation webhook signée est renvoyée immédiatement par le PSP simulé — le flux
  // aboutit de bout en bout sans écran intermédiaire. Sinon l'opération reste `pending` et
  // le client est redirigé vers la page de paiement simulée (décision côté route).
  let status = operation.status;
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    const confirmed = await autoConfirmPending(operation.pspReference!);
    if (confirmed.ok) {
      const refreshed = await prisma.pspEscrowOperation.findUnique({
        where: { id: operation.id },
        select: { status: true },
      });
      if (refreshed) status = refreshed.status;
    }
  }

  return { ok: true, operation: { ...operation, status } };
}

// ── Cumul des RELEASE déjà en vol (règle 18.3) ─────────────────────────────────────────────
// Une instruction RELEASE transmise au PSP n'est PAS confirmée dans la foulée : en production
// `isVirtualPspEnabled()` est faux, donc `autoConfirmPending` n'est jamais appelé et
// l'opération reste `pending` jusqu'à l'arrivée du webhook signé du PSP (US-503), qui peut
// prendre plusieurs secondes ou minutes. Ne compter que les `confirmed` (comportement d'avant
// 2026-09-10) revenait donc à ignorer tout ce qui était déjà parti :
//
//   jalon 1 200 € en `progressive` — checkpoint 50% → RELEASE 600 `pending`, checkpoint 100%
//   → RELEASE 600 `pending`, puis le client clique « Valider » avant les webhooks : le jalon
//   est encore `livrable_soumis` (seul le webhook le passe `libere`), `canDecideJalon` passe,
//   le cumul CONFIRMÉ vaut 0 → un TROISIÈME RELEASE de 1 200 € est transmis. 2 400 € instruits
//   pour un jalon de 1 200 €.
//
// En dev le défaut est invisible (ESCROW_STUB_AUTOCONFIRM=true confirme dans la même requête),
// c'est pourquoi aucun test ne l'avait attrapé. On compte donc TOUT ce qui n'a pas échoué —
// `failed` reste exclu pour qu'une instruction refusée par le PSP puisse être reprise sans
// amputer le solde restant (IN_FLIGHT_STATUSES, src/lib/escrow-instructions.ts).
export type ReleasedAmounts = {
  /** Tout ce qui est parti : `pending` + `confirmed`. Base du « que reste-t-il à libérer ? ». */
  inFlight: number;
  /** Ce que le PSP a confirmé. Base du « peut-on clôturer sans être optimiste ? ». */
  confirmed: number;
};

// Les deux cumuls en UNE requête. Ils étaient auparavant obtenus par deux agrégats distincts
// sur exactement les mêmes lignes — l'un filtrant `pending`+`confirmed`, l'autre `confirmed`
// seul — et POST .../validate les demandait tous les deux à la suite. Un `groupBy` sur le
// statut donne les deux d'un coup : même index, même parcours, un aller-retour au lieu de deux.
export async function releasedAmounts(
  scope: { jalonId: string } | { contractId: string; jalonId: null },
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ReleasedAmounts> {
  const rows = await client.pspEscrowOperation.groupBy({
    by: ["status"],
    where: { ...scope, instructionType: "release", status: { in: IN_FLIGHT_STATUSES } },
    _sum: { amount: true },
  });
  let inFlight = 0;
  let confirmed = 0;
  for (const row of rows) {
    const amount = row._sum.amount ?? 0;
    inFlight += amount;
    if (row.status === "confirmed") confirmed += amount;
  }
  return { inFlight, confirmed };
}

// `client` permet de l'exécuter DANS une transaction : la borne ne vaut que si elle est lue
// sous le même verrou que l'écriture qu'elle protège, sinon une libération concurrente peut
// changer le solde entre la lecture et l'instruction (voir emitRetentionRelease).
export async function heldBalance(
  contractId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<number> {
  const rows = await client.pspEscrowOperation.groupBy({
    by: ["instructionType"],
    where: { contractId, status: { in: IN_FLIGHT_STATUSES } },
    _sum: { amount: true },
  });
  let held = 0;
  for (const row of rows) {
    const amount = row._sum.amount ?? 0;
    // `hold` crédite ; tout ce qui ressort débite — libérations au prestataire comme
    // remboursements. `freeze` ne déplace rien : les fonds restent au séquestre, seul leur
    // déblocage est suspendu.
    if (row.instructionType === "hold") held += amount;
    else if (row.instructionType !== "freeze") held -= amount;
  }
  return held;
}

// Ces transactions prennent un verrou de ligne : l'ATTENTE du verrou est comptée dans le budget
// de la transaction, dont le défaut Prisma (5 s) est court pour un chemin monétaire sous
// contention. On l'élargit — mieux vaut attendre qu'échouer une instruction de paiement.
const LOCKED_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

// ── Un HOLD est-il déjà en vol ou abouti sur cette portée ? (règle 18.1) ───────────────────
// `requestContractHold` avait cette garde depuis 2026-09-10, la variante JALON ne l'avait
// jamais eue : un double-clic ou deux onglets transmettaient DEUX instructions de débit Mobile
// Money pour le même jalon, sans qu'aucune route ne permette d'annuler la seconde. Une seule
// définition désormais, utilisée des deux côtés — et par la scission, qui doit refuser de
// supprimer un jalon dont le paiement est déjà parti.
export async function hasInFlightHold(
  where: { jalonId: string } | { contractId: string },
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const existing = await client.pspEscrowOperation.findFirst({
    where: { ...where, instructionType: "hold", status: { in: IN_FLIGHT_STATUSES } },
    select: { id: true },
  });
  return existing !== null;
}

// ── Émission VERROUILLÉE d'une libération (règle 18.3) ─────────────────────────────────────
// Toutes les libérations passaient par le même anti-patron : lire le cumul déjà transmis, puis
// créer l'opération — deux requêtes non atomiques. Le plafond `remainingReleasableAmount` ne
// protégeait donc rien sous concurrence : deux points d'étape simultanés lisaient le même cumul
// et créaient chacun leur instruction. Ici la relecture du cumul et l'écriture sont dans la
// MÊME transaction, derrière un `FOR UPDATE` sur la ligne du contrat : le second prétendant
// attend, relit un cumul à jour, et ne libère que ce qui reste réellement.
//
// Retourne null quand il ne reste rien à transmettre (0 n'est pas une instruction valide).
export async function emitScopedRelease(args: {
  contractId: string;
  jalonId: string | null;
  currency: string;
  /** Plafond libérable sur la VIE de la portée (montant, retenue de garantie déduite). */
  plafond: number;
  /**
   * Cumul TOTAL qui devrait avoir été libéré sur cette portée à ce stade — et non l'incrément
   * à verser. L'instruction émise est la DIFFÉRENCE avec ce qui est déjà parti.
   *
   * Ce raisonnement en cible, et non en incrément, corrige un défaut de fond : l'incrément se
   * calculait depuis `observedProgress`, que DEUX routes peuvent faire monter — le point
   * d'étape (qui libère) et `observe-progress` (qui ne libère pas). Un client montant à 100 %
   * par observe-progress puis confirmant un point d'étape à 100 % produisait un incrément NUL :
   * le mode progressif se dégradait silencieusement en paiement unique, sans erreur ni trace.
   * Une cible se moque du chemin parcouru — elle ne regarde que l'argent déjà versé.
   */
  targetCumulative: number;
}): Promise<PspEscrowOperation | null> {
  const scope = args.jalonId
    ? ({ jalonId: args.jalonId } as const)
    : ({ contractId: args.contractId, jalonId: null } as const);

  const operation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;
    const { inFlight } = await releasedAmounts(scope, tx);
    const amount = Math.max(0, Math.min(args.targetCumulative, args.plafond) - inFlight);
    if (amount <= 0) return null;
    return tx.pspEscrowOperation.create({
      data: {
        contractId: args.contractId,
        jalonId: args.jalonId,
        pspName: virtualPspName(),
        pspReference: `release_${randomUUID()}`,
        amount,
        currency: args.currency,
        instructionType: "release",
      },
    });
  }, LOCKED_TX_OPTIONS);
  if (!operation) return null;

  // Confirmation HORS transaction : `autoConfirmPending` rejoue le chemin webhook, qui écrit en
  // base — l'appeler dedans ferait attendre le verrou détenu par cette même transaction.
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }
  return operation;
}

// ── Libération décidée par une MÉDIATION ──────────────────────────────────────────────────
// Distincte de `emitScopedRelease` parce que la borne n'est pas la même : une libération
// ordinaire est plafonnée par le montant de sa portée (jalon ou prix du contrat), une résolution
// de médiation par ce qui reste RÉELLEMENT séquestré — elle peut porter sur un reliquat, ou
// sur rien du tout. Même verrou, même relecture sous transaction.
export async function emitMediationRelease(args: {
  contractId: string;
  currency: string;
  requested: number;
}): Promise<PspEscrowOperation | null> {
  const operation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;
    const amount = Math.min(args.requested, await heldBalance(args.contractId, tx));
    if (amount <= 0) return null;
    return tx.pspEscrowOperation.create({
      data: {
        contractId: args.contractId,
        pspName: virtualPspName(),
        pspReference: `mediation_release_${randomUUID()}`,
        amount,
        currency: args.currency,
        instructionType: "release",
      },
    });
  }, LOCKED_TX_OPTIONS);
  if (!operation) return null;
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }
  return operation;
}