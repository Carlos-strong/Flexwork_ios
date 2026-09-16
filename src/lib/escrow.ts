import { randomUUID } from "crypto";
import type { Payable, Prisma, PspEscrowOperation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { IN_FLIGHT_STATUSES, netHeldAmount, outstandingFreeze } from "@/lib/escrow-instructions";
import { totalRetentionAmount } from "@/lib/jalons";
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

// ── Préconditions communes à TOUT financement du séquestre ─────────────────────────────────
// Partagées par le financement initial (`requestContractHold`) et par la recharge
// (src/lib/escrow-recharge.ts) : ce qui autorise à débiter un client ne dépend pas de ce qui
// motive le débit. Les laisser dans `requestContractHold` aurait obligé la recharge à les
// recopier — trois règles de conformité (flag PSP par zone, assurance effective, plafond de
// couverture) qu'il aurait fallu corriger à deux endroits.
//
// Retourne `null` quand tout est en règle, ou l'erreur à renvoyer telle quelle.
type FundingRefusal = { ok: false; error: string; status: number };

export async function assertFundingPreconditions(contract: {
  id: string;
  missionId: string;
  client: { country: string | null };
  mission: { budget: number; riskLevel: string };
  termsSnapshot: unknown;
}): Promise<FundingRefusal | null> {
  const enabled = await isFeatureEnabledForZone("psp_montage_valide", contract.client.country ?? "BJ");
  if (!enabled) {
    return { ok: false, error: "psp_not_enabled", status: 403 };
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

  return null;
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
  // Paiement fractionné en granularité `per_jalon` : chaque jalon se finance individuellement
  // via POST /api/missions/[id]/jalons/[jalonId]/hold — pas de HOLD global possible.
  //
  // En granularité `upfront` (§8, mode S1), c'est exactement l'inverse : UN financement couvre
  // tout le contrat et les jalons le consomment. Le refus ci-dessous ne s'applique donc pas —
  // c'est même le seul chemin de financement de ces contrats.
  if (contract.jalons.length > 0 && contract.fundingGranularity !== "upfront") {
    return { ok: false, error: "use_jalon_hold", status: 409 };
  }

  const precondition = await assertFundingPreconditions(contract);
  if (precondition) return precondition;

  // Un HOLD déjà en vol (`pending`) ou abouti (`confirmed`) interdit d'en transmettre un
  // second — mais un HOLD `failed` (paiement Mobile Money refusé, PSP indisponible) ne doit
  // PAS condamner le contrat : avant 2026-09-10 ce `findFirst` ne filtrait pas sur le statut,
  // donc le moindre échec rendait la mission définitivement infinançable (aucune route ne
  // permet de supprimer une opération). Le client peut désormais simplement réessayer.
  //
  // Cette garde vise le financement INITIAL. Une recharge délibérée du séquestre (§13) passe
  // par un chemin distinct, avec sa propre garde — voir src/lib/escrow-recharge.ts.
  if (await hasInFlightHold({ contractId: contract.id })) {
    return { ok: false, error: "hold_already_requested", status: 409 };
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
    by: ["instructionType", "status"],
    where: { contractId, status: { in: IN_FLIGHT_STATUSES } },
    _sum: { amount: true },
  });
  // Règle de solde partagée avec le moteur Gig (netHeldAmount, src/lib/escrow-instructions.ts)
  // — un `hold` ne crédite qu'une fois CONFIRMÉ, `freeze` est neutre, tout le reste débite dès
  // qu'il est en vol.
  return netHeldAmount(
    rows.map((row) => ({
      instructionType: row.instructionType,
      status: row.status,
      amount: row._sum.amount ?? 0,
    }))
  );
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
// Solde DISPONIBLE à partir de lignes d'opérations déjà agrégées — pendant interne de
// `escrowBalance`, pour les appelants qui ont déjà payé le coût de l'agrégat et ne veulent pas
// le refaire (c'est le cas sous verrou, voir emitScopedRelease). Même règle, mêmes bornes.
async function availableFrom(
  flat: { instructionType: string; status: string; amount: number }[],
  contractId: string,
  retentionRate: number,
  client: Prisma.TransactionClient | typeof prisma
): Promise<number> {
  const sum = (type: string) =>
    flat.filter((r) => r.instructionType === type).reduce((acc, r) => acc + r.amount, 0);

  const held = netHeldAmount(flat);
  // Gelé NET : un dégel (2026-09-14) referme la parenthèse ouverte par le gel. La borne par
  // `held` reste, en défense : elle couvre les médiations closes AVANT l'existence du dégel,
  // dont le gel n'a jamais été levé et dépasse aujourd'hui ce qui reste au séquestre.
  const blocked = Math.min(outstandingFreeze(flat), Math.max(0, held));

  // Sans retenue de garantie, rien à retrancher et AUCUNE requête à faire. La branche coûteuse
  // est réservée au seul mode qui en porte une (J4).
  let retained = 0;
  if (retentionRate > 0) {
    const liberes = await client.jalon.findMany({
      where: { contractId, status: "libere" },
      select: { montant: true },
    });
    retained = Math.max(0, totalRetentionAmount(liberes, retentionRate) - sum("retention_release"));
  }

  return Math.max(0, held - blocked - retained);
}

export type ScopedReleaseResult =
  | { ok: true; operation: PspEscrowOperation; payable: Payable }
  /** Rien à transmettre : le plafond de la portée est déjà entièrement parti. */
  | { ok: false; reason: "nothing_to_release" }
  /**
   * Le séquestre ne couvre pas le montant dû. Aucune instruction n'est transmise ; le payable
   * reste `validated` et attend une recharge (§13 du cahier des charges).
   */
  | { ok: false; reason: "escrow_insufficient"; payable: Payable; available: number; wanted: number };

export async function emitScopedRelease(args: {
  contractId: string;
  jalonId: string | null;
  /** Mission portant la dépense — informatif sur le payable, pour les vues financières. */
  missionId?: string | null;
  currency: string;
  /** Plafond libérable sur la VIE de la portée (montant, retenue de garantie déduite). */
  plafond: number;
  /**
   * Taux de retenue de garantie du contrat (0 hors mode J4). Passé par l'appelant, qui l'a déjà
   * sous la main pour calculer `plafond` — plutôt que relu ici. Sur un contrat sans retenue, le
   * cas de très loin le plus courant, cela épargne une requête À L'INTÉRIEUR du verrou.
   */
  retentionRate?: number;
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
  /**
   * Source métier de la créance, quand ce n'est ni un jalon ni la mission entière.
   *
   * Ajouté pour les contrats au temps (§9-13) : un relevé de présence validé produit une créance
   * dont la source est CE relevé, pas le contrat — c'est ce qui permet de remonter d'un paiement
   * à la journée qui l'a justifié. Par défaut (omis), le comportement historique est inchangé :
   * la source est le jalon, ou la mission quand il n'y en a pas.
   */
  payableSource?: {
    sourceType: "jalon" | "mission" | "attendance";
    sourceId: string;
    idempotencyKey: string;
  };
}): Promise<ScopedReleaseResult> {
  const scope = args.jalonId
    ? ({ jalonId: args.jalonId } as const)
    : ({ contractId: args.contractId, jalonId: null } as const);

  const outcome = await prisma.$transaction(async (tx): Promise<ScopedReleaseResult> => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;

    // UN seul agrégat pour les deux questions posées sous ce verrou : « qu'est-il déjà parti sur
    // CETTE portée ? » (borne du plafond, règle 18.3) et « que reste-t-il DISPONIBLE sur tout le
    // contrat ? » (invariant n°4). Les deux se lisent sur les mêmes lignes, à deux découpages
    // près — un `groupBy` par type ET par jalon les donne d'un coup.
    //
    // Ce n'est pas une micro-optimisation : ces requêtes s'exécutent à l'intérieur d'un
    // `FOR UPDATE` sur la ligne du contrat, et tout aller-retour supplémentaire allonge d'autant
    // la section où les autres prétendants attendent. Le contrôle de solde ajouté par la Phase 1
    // ne devait pas se payer en temps de verrou.
    const rows = await tx.pspEscrowOperation.groupBy({
      by: ["instructionType", "jalonId", "status"],
      where: { contractId: args.contractId, status: { in: IN_FLIGHT_STATUSES } },
      _sum: { amount: true },
    });
    const flat = rows.map((r) => ({
      instructionType: r.instructionType as string,
      jalonId: r.jalonId,
      status: r.status as string,
      amount: r._sum.amount ?? 0,
    }));

    const inFlight = flat
      .filter((r) => r.instructionType === "release" && r.jalonId === args.jalonId)
      .reduce((sum, r) => sum + r.amount, 0);
    const amount = Math.max(0, Math.min(args.targetCumulative, args.plafond) - inFlight);
    if (amount <= 0) return { ok: false, reason: "nothing_to_release" };

    // ── Obligation de paiement (Phase 1) ────────────────────────────────────────────────
    // Créée AVANT l'instruction, et dans la même transaction : c'est elle qui matérialise
    // « cette somme est due », indépendamment de sa transmission au PSP. La clé porte le cumul
    // VISÉ, pas la source seule — un jalon en financement progressif en produit légitimement
    // un par palier.
    const idempotencyKey =
      args.payableSource?.idempotencyKey ??
      `${args.jalonId ?? args.contractId}:target:${Math.min(args.targetCumulative, args.plafond)}`;
    const existing = await tx.payable.findUnique({ where: { idempotencyKey } });
    // Un payable rejoué `instructed`/`paid` n'atteint pas ce point : son montant compte déjà
    // dans `inFlight`, donc `amount` vaut 0 et on est sorti plus haut. Reste le cas d'un payable
    // resté `validated` (séquestre insuffisant au tour précédent) ou `failed` : son montant est
    // réaligné sur ce qui reste réellement dû.
    const payable = existing
      ? await tx.payable.update({
          where: { id: existing.id },
          data: { amount, status: "validated", escrowOperationId: null },
        })
      : await tx.payable.create({
          data: {
            contractId: args.contractId,
            missionId: args.missionId ?? null,
            sourceType: args.payableSource?.sourceType ?? (args.jalonId ? "jalon" : "mission"),
            sourceId: args.payableSource?.sourceId ?? args.jalonId ?? args.contractId,
            amount,
            currency: args.currency,
            status: "validated",
            idempotencyKey,
          },
        });

    // ── Invariant n°4 du cahier des charges ─────────────────────────────────────────────
    // « payableAmount <= availableEscrowAmount ». Jusqu'ici la seule borne était le montant
    // CONTRACTUEL de la portée (`plafond`) ; la coïncidence avec le solde réel n'était garantie
    // que par une garde de statut (`fonds_sous_sequestre`), c'est-à-dire par un effet de bord.
    // Le solde est relu SOUS le même verrou que l'écriture, seule lecture qui vaille.
    //
    // Insuffisant : aucune instruction, conformément à la règle par défaut du §13 — « aucune
    // instruction PSP tant que le payable complet n'est couvert par le séquestre ». Le payable
    // RESTE dû, en `validated` : c'est le seul état d'attente réel du modèle, et il attend ici
    // sa recharge. Ne pas payer partiellement en silence est le point entier de la règle.
    const available = await availableFrom(flat, args.contractId, args.retentionRate ?? 0, tx);
    if (amount > available) {
      return { ok: false, reason: "escrow_insufficient", payable, available, wanted: amount };
    }

    const operation = await tx.pspEscrowOperation.create({
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
    const linked = await tx.payable.update({
      where: { id: payable.id },
      data: { status: "instructed", escrowOperationId: operation.id },
    });
    return { ok: true, operation, payable: linked };
  }, LOCKED_TX_OPTIONS);

  if (!outcome.ok) return outcome;

  // Confirmation HORS transaction : `autoConfirmPending` rejoue le chemin webhook, qui écrit en
  // base — l'appeler dedans ferait attendre le verrou détenu par cette même transaction.
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(outcome.operation.pspReference!);
  }
  return outcome;
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
    // Même borne que toutes les autres sorties (2026-09-14) : le DISPONIBLE. Une résolution qui
    // distribue des fonds gelés commence par les dégeler (voir la route de réponse) — c'est le
    // dégel qui les rend disponibles, pas la médiation qui s'affranchit de la règle.
    const amount = Math.min(args.requested, (await escrowBalance(args.contractId, tx)).available);
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
// ── Remboursement du reliquat séquestré au CLIENT (2026-09-14) ─────────────────────────────
// Dernière sortie manquante du séquestre. Jusqu'ici l'enum `refund` n'était émis QUE par le
// domaine Gig (src/lib/gig-expiry.ts, annulation des 24h) : un contrat de mission n'avait
// aucun chemin de retour. Une mission interrompue, abandonnée, ou close sur une médiation
// partielle laissait donc au séquestre un reliquat que `heldBalance` voyait parfaitement et
// qu'aucune instruction ne venait chercher — le solde orphelin que le cahier des charges
// interdit (§18, « ne jamais laisser un solde orphelin »).
//
// Même défaillance, et même remède, que la retenue de garantie bloquée sur une mission arrêtée
// (voir POST /api/admin/contracts/[contractId]/retention/settle) : l'argent ne disparaît pas,
// il s'immobilise. C'est le mode de défaillance propre à tout séquestre dont une des issues
// n'est pas câblée.
//
// Borné par `heldBalance` et non par le prix du contrat : rembourser se fait sur ce qui RESTE,
// jamais sur ce qui a été engagé. Un contrat dont les trois quarts sont déjà partis au
// prestataire ne doit rendre au client que le dernier quart — la borne est la même que celle de
// `emitMediationRelease`, pour la même raison, et elle est relue SOUS le verrou qui protège
// l'écriture : sans cela une libération concurrente changerait le solde entre la lecture et
// l'instruction, et les deux mouvements cumulés sortiraient plus que le séquestre ne contient.
//
// Retourne null quand il ne reste rien à rendre (0 n'est pas une instruction valide) — ce qui
// rend l'appel IDEMPOTENT par construction : un second appel ne trouve plus de solde et
// n'instruit rien, sans avoir besoin d'une garde « déjà remboursé » séparée.
export async function emitContractRefund(args: {
  contractId: string;
  currency: string;
  /** Plafond demandé. Omis = tout le reliquat séquestré. */
  requested?: number;
}): Promise<PspEscrowOperation | null> {
  const operation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;
    // Borné par le DISPONIBLE, et non par le solde détenu (correction 2026-09-14) : un
    // remboursement ne doit pas emporter ce qui est gelé par un litige, ni une retenue de
    // garantie acquise au prestataire. Ces sommes sont bien au séquestre, mais elles attendent
    // encore quelque chose — les rendre au client trancherait le litige en sa faveur, en silence.
    //
    // C'est l'invariant n°4 appliqué à la sortie CLIENT comme il l'est à la sortie prestataire :
    // rien ne quitte le séquestre au-delà de ce qui est disponible.
    const available = (await escrowBalance(args.contractId, tx)).available;
    const amount = args.requested === undefined ? available : Math.min(args.requested, available);
    if (amount <= 0) return null;
    return tx.pspEscrowOperation.create({
      data: {
        contractId: args.contractId,
        pspName: virtualPspName(),
        pspReference: `refund_${randomUUID()}`,
        amount,
        currency: args.currency,
        instructionType: "refund",
      },
    });
  }, LOCKED_TX_OPTIONS);
  if (!operation) return null;

  // Confirmation HORS transaction, même raison que `emitScopedRelease` : `autoConfirmPending`
  // rejoue le chemin webhook, qui écrit en base.
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }
  return operation;
}

// ── Soldes explicites du séquestre (Phase 1, 2026-09-14) ───────────────────────────────────
// `heldBalance` répond à UNE question — « combien reste-t-il ? » — et c'était la seule que le
// code savait poser. Le cahier des charges (§3) en distingue plusieurs, parce qu'elles ne
// commandent pas les mêmes décisions : ce qui reste au séquestre n'est pas ce qui peut en
// SORTIR maintenant. Une somme gelée par un litige ou retenue au titre de la garantie est bien
// là, et pourtant indisponible.
//
// C'est cette distinction qui manquait pour tenir l'invariant n°4 du cahier des charges
// (« payableAmount <= availableEscrowAmount »). Aujourd'hui `emitScopedRelease` se borne au
// montant CONTRACTUEL de sa portée ; la coïncidence avec le solde réel n'est garantie que par
// une garde de STATUT (`fonds_sous_sequestre`), jamais par un contrôle de solde.
export type EscrowBalance = {
  /**
   * Prix du contrat. Ce à quoi les deux parties se sont engagées — jamais un mouvement de
   * fonds. Il figure au compte financier parce que c'est le seul repère qui dise si le
   * séquestre couvre l'engagement : `funded < contractual` signale un contrat sous-financé.
   */
  contractual: number;
  /** Σ des mises sous séquestre (`hold`) CONFIRMÉES. Tout ce que le client a effectivement versé. */
  funded: number;
  /**
   * Un financement est transmis au PSP et pas encore tranché. Distinct de `funded === 0` : le
   * client a peut-être déjà autorisé le débit sur son téléphone, le webhook n'est pas arrivé.
   * C'est ce qui sépare « non financé » de « financement en attente » (§3 du cahier des charges).
   */
  fundingPending: boolean;
  /** Σ de ce qui est parti au PRESTATAIRE (`release` + `retention_release`). */
  released: number;
  /** Σ de ce qui est revenu au CLIENT (`refund`). */
  refunded: number;
  /** Ce qui reste au séquestre : `funded − released − refunded`. Le gel ne déplace rien. */
  held: number;
  /**
   * Part gelée par un litige. Bornée par `held` — un gel porte le solde du moment, et le modèle
   * n'a pas d'instruction inverse (voir POST /api/admin/mediations/[id]/respond, « ce que cette
   * route ne fait PAS »). Sans cette borne, une libération de médiation ferait passer
   * `available` sous zéro : le gel resterait à son montant d'origine alors que le solde a
   * baissé. Le dégel explicite reste à câbler.
   */
  blocked: number;
  /**
   * Retenue de garantie accumulée et pas encore versée : la part prélevée sur les jalons DÉJÀ
   * libérés, moins l'instruction finale si elle est partie. Un jalon jamais validé n'a rien
   * retenu — son montant entier est encore là, et il relève du `held`, pas d'ici.
   */
  retained: number;
  /**
   * Reconnu DÛ au prestataire, pas encore instruit au PSP : Σ des payables `validated`.
   *
   * C'est le chaînon que « financer ≠ payer » rend nécessaire. Un montant peut être validé par
   * le client sans être parti — soit qu'il attende son instruction, soit que le séquestre ne le
   * couvre pas encore (§18, recharge). Le confondre avec `released` ferait croire le prestataire
   * payé ; le confondre avec `available` ferait croire le client libre de ses fonds.
   */
  releasable: number;
  /**
   * Ce qui peut réellement être instruit maintenant : `held − blocked − retained`. Jamais
   * négatif. C'est la borne de l'invariant n°4 — la seule qu'un payable doive respecter.
   */
  available: number;
  /**
   * Part du disponible déjà revendiquée par des payables validés : `min(releasable, available)`.
   * Bornée par le disponible et non égale à `releasable`, parce qu'un montant peut être dû sans
   * être couvert (§18, insuffisance de séquestre).
   */
  owedToProvider: number;
  /**
   * Part du disponible que personne ne réclame — restituable au client. C'est le complément de
   * `owedToProvider`, et le seul chiffre qui dise au client ce qu'il peut espérer récupérer.
   */
  refundable: number;
};

// `held` se partitionne EXACTEMENT ainsi — c'est la décomposition du §3 :
//
//   held
//    ├── blocked   (litige : gelé par une médiation)
//    ├── retained  (garantie J4 : acquise au prestataire, versée en fin de parcours)
//    └── available
//         ├── owedToProvider  (reconnu dû par une validation)
//         └── refundable      (libre)
//
// Le cahier des charges distingue « PARTIE BLOQUÉE » et « PARTIE LITIGIEUSE ». La plateforme n'a
// qu'un seul mécanisme de blocage — le gel accompagnant une médiation — et les présenter comme
// deux chiffres laisserait croire à deux causes distinctes. Un seul : `blocked`.

export async function escrowBalance(
  contractId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<EscrowBalance> {
  const [rows, contract, dueAgg] = await Promise.all([
    client.pspEscrowOperation.groupBy({
      by: ["instructionType", "status"],
      where: { contractId, status: { in: IN_FLIGHT_STATUSES } },
      _sum: { amount: true },
    }),
    client.prestationContract.findUnique({
      where: { id: contractId },
      select: {
        retentionRate: true,
        termsSnapshot: true,
        mission: { select: { budget: true } },
        jalons: { select: { montant: true, status: true } },
      },
    }),
    // Reconnu dû, pas encore instruit. Un agrégat à part et non une jointure : les payables ne
    // vivent pas dans le registre des instructions, et c'est précisément ce qui les distingue —
    // un payable existe AVANT toute instruction, et peut ne jamais en produire.
    client.payable.aggregate({
      where: { contractId, status: "validated" },
      _sum: { amount: true },
    }),
  ]);

  const sum = (type: string) =>
    rows.filter((r) => r.instructionType === type).reduce((acc, r) => acc + (r._sum.amount ?? 0), 0);

  // `funded` ne compte que les mises sous séquestre CONFIRMÉES : une instruction `pending` est un
  // débit transmis, pas un encaissement (voir netHeldAmount). Un séquestre affiché « financé »
  // sur la foi d'un paiement que le client n'a pas encore autorisé serait un mensonge coûteux.
  const funded = rows
    .filter((r) => r.instructionType === "hold" && r.status === "confirmed")
    .reduce((acc, r) => acc + (r._sum.amount ?? 0), 0);
  const released = sum("release") + sum("retention_release");
  const refunded = sum("refund");
  // Même règle que `heldBalance`, sur les mêmes lignes : un seul endroit décide de ce qui
  // crédite et de ce qui débite.
  const flatRows = rows.map((row) => ({
    instructionType: row.instructionType as string,
    status: row.status as string,
    amount: row._sum.amount ?? 0,
  }));
  const held = netHeldAmount(flatRows);

  // Gelé NET : un dégel (2026-09-14) referme la parenthèse ouverte par le gel. La borne par
  // `held` reste, en défense : elle couvre les médiations closes AVANT l'existence du dégel,
  // dont le gel n'a jamais été levé et dépasse aujourd'hui ce qui reste au séquestre.
  const blocked = Math.min(outstandingFreeze(flatRows), Math.max(0, held));

  // Retenue encore due : celle des jalons libérés, moins ce qui est déjà parti. Calculée jalon
  // par jalon (et non sur le prix total) pour la même raison que `totalRetentionAmount` —
  // passer par le total ferait diverger les deux calculs de quelques francs, c'est-à-dire
  // laisser un résidu que plus aucune instruction ne viendrait chercher.
  const rate = contract?.retentionRate ?? 0;
  const liberes = (contract?.jalons ?? []).filter((j) => j.status === "libere");
  const retained = Math.max(0, totalRetentionAmount(liberes, rate) - sum("retention_release"));

  const available = Math.max(0, held - blocked - retained);
  const releasable = dueAgg._sum.amount ?? 0;
  const owedToProvider = Math.min(releasable, available);

  return {
    contractual: contract
      ? contractPrice({ mission: contract.mission, termsSnapshot: contract.termsSnapshot })
      : 0,
    funded,
    released,
    refunded,
    held,
    blocked,
    retained,
    releasable,
    available,
    owedToProvider,
    refundable: available - owedToProvider,
    fundingPending: rows.some((r) => r.instructionType === "hold" && r.status === "pending"),
  };
}

// ── Levée du gel (2026-09-14) ──────────────────────────────────────────────────────────────
// Referme la parenthèse ouverte par l'instruction `freeze` à l'ouverture d'une médiation. Son
// absence était une dette explicitement notée dans POST /api/admin/mediations/[id]/respond :
// « ce que cette route ne fait toujours PAS : dégeler les fonds au PSP ». Une médiation close
// laissait donc ses fonds gelés indéfiniment — la mission reprenait son cours, mais plus aucune
// libération ne pouvait sortir, puisque `available` retranche ce qui est bloqué.
//
// Le montant dégelé est l'ordre de gel encore en vigueur — voir le commentaire dans le corps
// pour la raison, subtile, qui interdit d'utiliser `EscrowBalance.blocked` à sa place.
//
// Idempotent par construction, comme `emitContractRefund` : une fois le gel net retombé à zéro,
// il n'y a plus rien à dégeler et aucune instruction n'est créée. Pas de garde « déjà dégelé »
// séparée à maintenir.
export async function emitUnfreeze(args: {
  contractId: string;
  currency: string;
  /**
   * Part de l'ordre de gel à lever. Omis = tout ce qui reste gelé (clôture de médiation).
   *
   * Un montant explicite sert aux gels CIBLÉS : une journée de présence contestée gèle sa part
   * seule, et sa résolution ne doit lever que celle-là — pas les autres litiges en cours sur le
   * même contrat.
   */
  amount?: number;
}): Promise<PspEscrowOperation | null> {
  const operation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;

    // Le montant dégelé est l'ORDRE DE GEL encore en vigueur (Σ freeze − Σ unfreeze), et non
    // `EscrowBalance.blocked`. Les deux diffèrent dès qu'une résolution de médiation a libéré
    // une partie des fonds entre le gel et sa levée : `blocked` est alors plafonné par ce qui
    // reste au séquestre, alors que l'ordre lui-même porte toujours sur le montant gelé
    // d'origine. Dégeler le montant plafonné laisserait un reliquat d'ordre que plus rien ne
    // viendrait lever — et `blocked` ne retomberait jamais à zéro.
    //
    // Un `unfreeze` ne déplace aucun fonds : que son montant dépasse le solde restant n'a pas
    // d'incidence monétaire, il lève une consigne.
    const rows = await tx.pspEscrowOperation.groupBy({
      by: ["instructionType"],
      where: {
        contractId: args.contractId,
        instructionType: { in: ["freeze", "unfreeze"] },
        status: { in: IN_FLIGHT_STATUSES },
      },
      _sum: { amount: true },
    });
    const sum = (type: string) =>
      rows.find((r) => r.instructionType === type)?._sum.amount ?? 0;
    const outstanding = outstandingFreeze(
      rows.map((r) => ({ instructionType: r.instructionType as string, amount: r._sum.amount ?? 0 }))
    );
    // Jamais plus que ce qui est réellement gelé : un dégel excédentaire rendrait `blocked`
    // négatif, donc `available` supérieur au solde.
    const montant = args.amount === undefined ? outstanding : Math.min(args.amount, outstanding);
    if (montant <= 0) return null;

    return tx.pspEscrowOperation.create({
      data: {
        contractId: args.contractId,
        pspName: virtualPspName(),
        pspReference: `unfreeze_${randomUUID()}`,
        amount: montant,
        currency: args.currency,
        instructionType: "unfreeze",
      },
    });
  }, LOCKED_TX_OPTIONS);
  if (!operation) return null;

  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }
  return operation;
}

// ── Gel CIBLÉ d'une somme contestée (§21, 2026-09-14) ──────────────────────────────────────
// « Les montants litigieux restent dans le séquestre. » Le gel ne fait pas sortir les fonds — il
// les rend indisponibles le temps de l'arbitrage, ce qui est exactement ce qu'on attend d'un
// différend : ni versé au prestataire, ni rendu au client tant que rien n'est tranché.
//
// Distinct du gel de MÉDIATION, qui porte le solde entier parce qu'il suspend tout le contrat.
// Ici on gèle une somme précise — deux jours de présence contestés — et le reste du séquestre
// continue de financer les journées suivantes. Un chantier ne s'arrête pas parce qu'une journée
// est discutée.
//
// Borné par le DISPONIBLE : on ne peut pas geler ce qui est déjà parti, ni ce qui est déjà gelé.
export async function emitDisputeFreeze(args: {
  contractId: string;
  currency: string;
  amount: number;
}): Promise<PspEscrowOperation | null> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) return null;

  const operation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;
    const balance = await escrowBalance(args.contractId, tx);
    const montant = Math.min(args.amount, balance.available);
    if (montant <= 0) return null;
    return tx.pspEscrowOperation.create({
      data: {
        contractId: args.contractId,
        pspName: virtualPspName(),
        pspReference: `freeze_dispute_${randomUUID()}`,
        amount: montant,
        currency: args.currency,
        instructionType: "freeze",
      },
    });
  }, LOCKED_TX_OPTIONS);
  if (!operation) return null;

  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }
  return operation;
}

// ── Soldes de PLUSIEURS contrats en un nombre CONSTANT de requêtes (2026-09-14) ─────────────
// `escrowBalance` coûte trois allers-retours par contrat. Un écran qui en agrège plusieurs — le
// tableau de bord du responsable de chantier, qui peut en suivre vingt — en faisait donc
// soixante, et ce nombre grandissait avec le nombre de chantiers confiés.
//
// Ici : un `groupBy` pour toutes les opérations, un pour tous les payables, une lecture des
// jalons seulement s'il existe une retenue de garantie quelque part. Trois requêtes, quel que
// soit le nombre de contrats.
//
// La RÈGLE de calcul reste exactement celle de `escrowBalance` — mêmes fonctions pures
// (`netHeldAmount`, `outstandingFreeze`, `totalRetentionAmount`), mêmes bornes. Seule la façon
// d'aller chercher les lignes change ; une divergence de calcul entre la vue unitaire et la vue
// agrégée serait le pire défaut possible pour un écran qui sert à décider.
export async function escrowBalancesFor(
  contractIds: string[]
): Promise<Map<string, EscrowBalance>> {
  const resultat = new Map<string, EscrowBalance>();
  if (contractIds.length === 0) return resultat;

  const [rows, payables, contracts] = await Promise.all([
    prisma.pspEscrowOperation.groupBy({
      by: ["contractId", "instructionType", "status"],
      where: { contractId: { in: contractIds }, status: { in: IN_FLIGHT_STATUSES } },
      _sum: { amount: true },
    }),
    prisma.payable.groupBy({
      by: ["contractId"],
      where: { contractId: { in: contractIds }, status: "validated" },
      _sum: { amount: true },
    }),
    prisma.prestationContract.findMany({
      where: { id: { in: contractIds } },
      select: {
        id: true,
        retentionRate: true,
        termsSnapshot: true,
        mission: { select: { budget: true } },
        // Chargés inconditionnellement : la seule alternative serait une requête supplémentaire
        // pour savoir lesquels en ont besoin, ce qui coûterait plus que de les lire.
        jalons: { select: { montant: true, status: true } },
      },
    }),
  ]);

  const parContrat = new Map<string, { instructionType: string; status: string; amount: number }[]>();
  for (const r of rows) {
    if (!r.contractId) continue;
    const liste = parContrat.get(r.contractId) ?? [];
    liste.push({
      instructionType: r.instructionType as string,
      status: r.status as string,
      amount: r._sum.amount ?? 0,
    });
    parContrat.set(r.contractId, liste);
  }
  const dusParContrat = new Map(
    payables.filter((p) => p.contractId).map((p) => [p.contractId!, p._sum.amount ?? 0])
  );

  for (const contract of contracts) {
    const flat = parContrat.get(contract.id) ?? [];
    const sum = (type: string) =>
      flat.filter((r) => r.instructionType === type).reduce((acc, r) => acc + r.amount, 0);

    const funded = flat
      .filter((r) => r.instructionType === "hold" && r.status === "confirmed")
      .reduce((acc, r) => acc + r.amount, 0);
    const released = sum("release") + sum("retention_release");
    const refunded = sum("refund");
    const held = netHeldAmount(flat);
    const blocked = Math.min(outstandingFreeze(flat), Math.max(0, held));

    const liberes = contract.jalons.filter((j) => j.status === "libere");
    const retained = Math.max(
      0,
      totalRetentionAmount(liberes, contract.retentionRate) - sum("retention_release")
    );

    const available = Math.max(0, held - blocked - retained);
    const releasable = dusParContrat.get(contract.id) ?? 0;
    const owedToProvider = Math.min(releasable, available);

    resultat.set(contract.id, {
      contractual: contractPrice({ mission: contract.mission, termsSnapshot: contract.termsSnapshot }),
      funded,
      released,
      refunded,
      held,
      blocked,
      retained,
      releasable,
      available,
      owedToProvider,
      refundable: available - owedToProvider,
      fundingPending: flat.some((r) => r.instructionType === "hold" && r.status === "pending"),
    });
  }

  return resultat;
}

// ── Réinstruction d'une créance restée due (2026-09-15) ────────────────────────────────────
// Une créance peut rester due sans instruction dans deux cas :
//   - `validated` : le séquestre ne la couvrait pas au moment de la validation (§13) ;
//   - `failed`    : le PSP a refusé le versement (solde, indisponibilité…).
//
// Aucun chemin ne la relançait. La recharge encaissait l'argent du client sans que le versement
// parte, et un relevé de présence déjà validé ne pouvait plus l'être une seconde fois : le
// prestataire restait impayé malgré un séquestre couvrant sa créance. Constaté par le test de
// workflow complet. La console admin annonçait « à réinstruire » sans geste pour le faire.
//
// La créance porte déjà son montant — calculé à sa validation comme ce qui restait dû sur sa
// portée —, donc la réinstruire, c'est émettre ce montant, et rien d'autre. Même verrou, même
// borne par le disponible, même confirmation hors transaction que toute émission. Un second appel
// concurrent relit la créance sous le verrou, la trouve `instructed`, et s'arrête.
export type OwedInstructionResult =
  | { ok: true; operation: PspEscrowOperation; payable: Payable }
  | { ok: false; reason: "not_found" | "not_owed" | "out_of_scope" | "escrow_insufficient"; available?: number };

// Les sources dont le versement est un `release` de contrat. Les commandes Gig ont leur propre
// domaine ; la médiation et la retenue n'émettent pas de créance réinstructible.
const REINSTRUCTABLE_SOURCES: readonly string[] = ["jalon", "mission", "attendance"];

export async function instructOwedPayable(payableId: string): Promise<OwedInstructionResult> {
  const head = await prisma.payable.findUnique({ where: { id: payableId }, select: { contractId: true } });
  if (!head) return { ok: false, reason: "not_found" };
  if (!head.contractId) return { ok: false, reason: "out_of_scope" };
  const contractId = head.contractId;

  const outcome = await prisma.$transaction(async (tx): Promise<OwedInstructionResult> => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${contractId} FOR UPDATE`;
    const payable = await tx.payable.findUnique({
      where: { id: payableId },
      include: { contract: { select: { retentionRate: true } } },
    });
    if (!payable) return { ok: false, reason: "not_found" };
    if (payable.status !== "validated" && payable.status !== "failed") return { ok: false, reason: "not_owed" };
    if (!REINSTRUCTABLE_SOURCES.includes(payable.sourceType)) return { ok: false, reason: "out_of_scope" };

    const rows = await tx.pspEscrowOperation.groupBy({
      by: ["instructionType", "status"],
      where: { contractId, status: { in: IN_FLIGHT_STATUSES } },
      _sum: { amount: true },
    });
    const flat = rows.map((r) => ({
      instructionType: r.instructionType as string,
      status: r.status as string,
      amount: r._sum.amount ?? 0,
    }));
    const available = await availableFrom(flat, contractId, payable.contract?.retentionRate ?? 0, tx);
    if (payable.amount > available) return { ok: false, reason: "escrow_insufficient", available };

    const operation = await tx.pspEscrowOperation.create({
      data: {
        contractId,
        jalonId: payable.sourceType === "jalon" ? payable.sourceId : null,
        pspName: virtualPspName(),
        pspReference: `release_${randomUUID()}`,
        amount: payable.amount,
        currency: payable.currency,
        instructionType: "release",
      },
    });
    const linked = await tx.payable.update({
      where: { id: payable.id },
      data: { status: "instructed", escrowOperationId: operation.id },
    });
    return { ok: true, operation, payable: linked };
  }, LOCKED_TX_OPTIONS);

  if (outcome.ok && isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(outcome.operation.pspReference!);
  }
  return outcome;
}

/**
 * Instruit, dans l'ordre où elles ont été reconnues, les créances `validated` d'un contrat que le
 * séquestre couvre désormais. Appelé à la confirmation de tout financement : c'est précisément le
 * moment où une créance en attente de fonds peut partir.
 *
 * Les créances `failed` n'en font PAS partie : un refus du PSP se reprend par une décision (le
 * client revalide son jalon, ou l'administration réinstruit), jamais en boucle automatique.
 */
export async function instructOwedPayables(contractId: string): Promise<{ instructed: number; waiting: number }> {
  const owed = await prisma.payable.findMany({
    where: { contractId, status: "validated", sourceType: { in: ["jalon", "mission", "attendance"] } },
    orderBy: [{ validatedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  let instructed = 0;
  for (const p of owed) {
    const res = await instructOwedPayable(p.id);
    if (res.ok) instructed++;
    // La plus ancienne n'est pas couverte : les suivantes attendront avec elle, dans l'ordre.
    else if (res.reason === "escrow_insufficient") break;
  }
  return { instructed, waiting: owed.length - instructed };
}
