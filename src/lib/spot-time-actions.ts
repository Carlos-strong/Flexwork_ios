import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitContractRefund, emitDisputeFreeze, emitScopedRelease, emitUnfreeze } from "@/lib/escrow";
import { notifyMissionParties } from "@/lib/mission-notify";
import {
  attendanceAmount,
  checkCaps,
  periodsOverlap,
  type SpotTimeTerms as Terms,
  checkValidationRule,
} from "@/lib/spot-time";
import { canVerify, type ValidationMode } from "@/lib/validation-mode";

// Cycle de vie d'un relevé de présence (§20 du cahier des charges) — le seul endroit où le
// pointage rencontre l'argent.
//
//   Entrée → présence enregistrée → sortie → durée calculée → pointage soumis
//     → responsable valide → montant calculé → contrôle séquestre → payable créé
//
// La phrase qui gouverne ce fichier est la dernière du §20 : « le pointage n'a AUCUN pouvoir
// financier direct ». Un relevé soumis ne déclenche rien ; seule la validation du CLIENT produit
// une créance, et seule la couverture du séquestre produit une instruction. Les trois étapes
// sont distinctes et se voient dans le code.
//
// Rien de la mécanique financière n'est réécrit ici : le payable, le contrôle de disponible,
// l'émission verrouillée et l'idempotence sont ceux de `emitScopedRelease`, partagés avec tous
// les autres modes. Un contrat au temps n'est pas un moteur financier de plus — c'est une
// nouvelle façon de produire des créances sur le même séquestre.

type ContractWithTerms = {
  id: string;
  missionId: string;
  clientId: string;
  providerId: string;
  spotTimeTerms: Terms | null;
  mission: { currency: string };
};

function toTerms(t: NonNullable<ContractWithTerms["spotTimeTerms"]>): Terms {
  return {
    rateUnit: t.rateUnit,
    rate: t.rate,
    maxQuantity: t.maxQuantity,
    maxAmount: t.maxAmount,
    overtimeAllowed: t.overtimeAllowed,
    overtimeRate: t.overtimeRate,
    attendanceValidation: t.attendanceValidation,
  };
}

/**
 * Qui prononce la décision DÉFINITIVE sur un relevé (validation, contestation, arbitrage) ?
 *
 * Le CLIENT, et lui seul — c'est lui qui paie. Depuis le mode de vérification (2026-10-01), le
 * responsable de chantier ne valide plus : en mode OPR il VÉRIFIE (`verifyAttendance`) et
 * transmet ; la libération reste un geste du client.
 *
 * Le PRESTATAIRE n'y figure pas, et c'est la garde essentielle : valider ses propres heures,
 * c'est se payer soi-même.
 */
export function canDecideAttendance(contract: { clientId: string }, userId: string): boolean {
  return contract.clientId === userId;
}

/** Statut qu'un relevé doit avoir pour que le client décide : vérifié en OPR, soumis sinon. */
function decidableStatus(mode: ValidationMode): "verified" | "submitted" {
  return mode === "opr" ? "verified" : "submitted";
}

const CONTRACT_ACTORS_SELECT = {
  id: true,
  missionId: true,
  clientId: true,
  validationMode: true,
  siteManagerId: true,
  mission: { select: { currency: true, titre: true } },
  spotTimeTerms: true,
} as const;

export type SubmitResult =
  | { ok: true; attendanceId: string }
  | { ok: false; error: "not_found" | "not_a_time_contract" | "period_overlap" | "duplicate_period" | "invalid_quantity" | "contract_closed" | "invalid_period" };

// Statuts de mission où plus aucune présence ne se déclare : le chantier est clos, ou un litige
// suspend le contrat. Un relevé déclaré après la clôture n'aurait plus de séquestre pour le payer —
// le reliquat est déjà en route vers le client.
const ATTENDANCE_CLOSED_STATUSES: readonly string[] = ["cloturee", "remboursee", "mediation_ouverte"];

/**
 * Le prestataire déclare une présence.
 *
 * Purement déclaratif : aucun montant n'est calculé, aucune créance n'est créée. C'est le sens
 * du §9 — un relevé produit un montant EXIGIBLE seulement une fois validé, jamais à la
 * déclaration.
 *
 * Deux garde-fous contre le double pointage (§5 du prompt S2) :
 *   - l'unicité `(contractId, periodStart, periodEnd)` en BASE refuse deux relevés aux mêmes
 *     bornes, y compris sous concurrence ;
 *   - `periodsOverlap` refuse deux plages qui se RECOUVRENT (8h-12h et 10h-14h) — ce qu'aucune
 *     contrainte SQL simple n'exprime, et qui doit donc être vérifié ici, sous le verrou de la
 *     transaction.
 */
export async function submitAttendance(args: {
  contractId: string;
  workerId: string;
  periodStart: Date;
  periodEnd: Date;
  declaredQuantity: number;
}): Promise<SubmitResult> {
  if (!Number.isFinite(args.declaredQuantity) || args.declaredQuantity <= 0) {
    return { ok: false, error: "invalid_quantity" };
  }
  // Plage inversée : défense en profondeur, la route la refuse déjà en 400.
  if (args.periodEnd < args.periodStart) return { ok: false, error: "invalid_period" };

  const contract = await prisma.prestationContract.findUnique({
    where: { id: args.contractId },
    select: { id: true, providerId: true, spotTimeTerms: { select: { id: true } } },
  });
  if (!contract || contract.providerId !== args.workerId) return { ok: false, error: "not_found" };
  if (!contract.spotTimeTerms) return { ok: false, error: "not_a_time_contract" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;
      // Relu SOUS le verrou que prend aussi la clôture (closeTimeContract) : un relevé ne peut pas
      // se glisser entre le contrôle « aucun relevé en attente » et le passage en `cloturee`.
      const etat = await tx.prestationContract.findUnique({
        where: { id: args.contractId },
        select: { mission: { select: { status: true } } },
      });
      if (etat && ATTENDANCE_CLOSED_STATUSES.includes(etat.mission.status)) return "closed" as const;

      // Chevauchement : seuls comptent les relevés encore vivants. Un relevé annulé ou refusé
      // ne réserve plus sa plage — sinon une erreur de saisie condamnerait la journée.
      const voisins = await tx.attendance.findMany({
        where: { contractId: args.contractId, status: { notIn: ["cancelled", "rejected"] } },
        select: { periodStart: true, periodEnd: true },
      });
      if (voisins.some((v) => periodsOverlap(v, args))) return null;

      return tx.attendance.create({
        data: {
          contractId: args.contractId,
          workerId: args.workerId,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          declaredQuantity: args.declaredQuantity,
          status: "submitted",
        },
      });
    }, { maxWait: 10_000, timeout: 20_000 });

    if (created === "closed") return { ok: false, error: "contract_closed" };
    if (!created) return { ok: false, error: "period_overlap" };
    return { ok: true, attendanceId: created.id };
  } catch (e) {
    // Violation d'unicité : deux relevés aux mêmes bornes, arrivés en concurrence.
    if ((e as Prisma.PrismaClientKnownRequestError)?.code === "P2002") {
      return { ok: false, error: "duplicate_period" };
    }
    throw e;
  }
}

export type ApproveResult =
  | { ok: true; amount: number; released: number; payableId: string }
  | { ok: false; error: string; allowed?: number; available?: number }

/**
 * Le client valide un relevé : montant calculé, créance créée, séquestre contrôlé, instruction
 * émise si — et seulement si — les fonds la couvrent.
 *
 * `approvedQuantity` est la quantité que le CLIENT reconnaît, qui peut être inférieure à la
 * quantité déclarée (§21 : 6 jours déclarés, 4 validés). Seule la part validée devient payable ;
 * le reste demeure au séquestre, ni versé ni perdu — SAUF si le mode de pointage du contrat est
 * « totale » : la validation doit alors porter sur la quantité déclarée entière
 * (`partial_validation_not_allowed`).
 */
export async function approveAttendance(args: {
  attendanceId: string;
  validatorId: string;
  approvedQuantity: number;
  overtimeQuantity?: number;
  // Interne : la part RECONNUE d'une contestation (disputeAttendance). Une contestation est une
  // validation partielle motivée et arbitrée — elle reste permise en mode « totale », seule la
  // réduction unilatérale silencieuse ne l'est pas. Jamais exposé par une route.
  partOfDispute?: boolean;
}): Promise<ApproveResult> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: args.attendanceId },
    include: { contract: { select: CONTRACT_ACTORS_SELECT } },
  });
  if (!attendance) return { ok: false, error: "not_found" };
  // Le responsable de chantier ne valide plus : il vérifie (verifyAttendance). Lui répondre
  // `verification_only` plutôt que `not_found` : il voit le relevé, il doit savoir pourquoi le
  // geste ne lui appartient pas.
  if (!canDecideAttendance(attendance.contract, args.validatorId)) {
    return { ok: false, error: canVerify(attendance.contract, args.validatorId) ? "verification_only" : "not_found" };
  }
  const mode = attendance.contract.validationMode;
  if (attendance.status !== decidableStatus(mode)) {
    // En OPR, un relevé encore `submitted` attend le responsable : le client ne le court-circuite
    // pas (choix « strict »). Il peut en revanche désigner un autre responsable.
    return { ok: false, error: mode === "opr" && attendance.status === "submitted" ? "verification_required" : "attendance_not_submitted" };
  }

  const rawTerms = attendance.contract.spotTimeTerms;
  if (!rawTerms) return { ok: false, error: "not_a_time_contract" };
  const terms = toTerms(rawTerms);

  // En OPR, la validation définitive porte sur la quantité VÉRIFIÉE par le responsable : le
  // client la confirme, il ne la ressaisit pas. Seule une contestation (partOfDispute) en
  // reconnaît moins.
  const plafondQuantite = mode === "opr" ? (attendance.verifiedQuantity ?? 0) : attendance.declaredQuantity;
  const approved = mode === "opr" && !args.partOfDispute ? plafondQuantite : args.approvedQuantity;
  const overtime = mode === "opr" && !args.partOfDispute ? attendance.verifiedOvertimeQuantity : (args.overtimeQuantity ?? 0);
  if (!Number.isFinite(approved) || approved <= 0) return { ok: false, error: "invalid_quantity" };
  if (approved > plafondQuantite) {
    // Valider PLUS que déclaré (ou que vérifié) n'a pas de sens : le client reconnaîtrait un
    // travail que personne n'a revendiqué ni constaté.
    return { ok: false, error: "approved_above_declared" };
  }
  // Mode de pointage « totale » : pas de réduction unilatérale. Le validateur refuse le relevé
  // (le prestataire le corrige) ou en conteste une part — deux voies motivées et traçables.
  // En OPR, le mode de pointage a déjà été appliqué à la vérification.
  if (!args.partOfDispute && mode === "client") {
    const rule = checkValidationRule(terms.attendanceValidation ?? "partielle", approved, attendance.declaredQuantity);
    if (!rule.ok) return { ok: false, error: rule.error };
  }

  // Cumuls déjà reconnus sur ce contrat — la base des deux plafonds contractuels.
  const dejaValides = await prisma.attendance.findMany({
    where: { contractId: attendance.contractId, status: "approved" },
    select: { approvedQuantity: true, overtimeQuantity: true },
  });
  const cumulQuantite = dejaValides.reduce((s, a) => s + (a.approvedQuantity ?? 0), 0);
  const cumulMontant = dejaValides.reduce(
    (s, a) => s + attendanceAmount(terms, a.approvedQuantity ?? 0, a.overtimeQuantity),
    0
  );

  const cap = checkCaps(terms, approved, overtime, cumulQuantite, cumulMontant);
  if (!cap.ok) return { ok: false, error: cap.reason, allowed: cap.allowed };

  // Cible CUMULÉE : le total reconnu dû sur ce contrat à ce stade. `emitScopedRelease` raisonne
  // en cible et non en incrément (voir son commentaire) — l'instruction émise est la différence
  // avec ce qui est déjà parti, ce qui rend le calcul insensible aux rejeux.
  const released = await emitScopedRelease({
    contractId: attendance.contractId,
    jalonId: null,
    missionId: attendance.contract.missionId,
    currency: attendance.contract.mission.currency,
    plafond: terms.maxAmount,
    targetCumulative: cumulMontant + cap.amount,
    payableSource: {
      sourceType: "attendance",
      sourceId: attendance.id,
      // Une créance par relevé : c'est le relevé qui justifie le paiement, et c'est par lui
      // qu'on doit pouvoir y remonter.
      idempotencyKey: `attendance:${attendance.id}`,
    },
  });

  if (!released.ok) {
    if (released.reason === "escrow_insufficient") {
      // La créance EXISTE et reste due ; le relevé passe validé pour que le travail reconnu le
      // reste, mais rien n'est versé tant que le client n'a pas rechargé (§18).
      await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          status: "approved",
          approvedQuantity: approved,
          overtimeQuantity: overtime,
          validatedById: args.validatorId,
          validatedAt: new Date(),
          payableId: released.payable.id,
        },
      });
      return {
        ok: false,
        error: "escrow_insufficient",
        allowed: released.wanted,
        available: released.available,
      };
    }
    return { ok: false, error: released.reason };
  }

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      status: "approved",
      approvedQuantity: approved,
      overtimeQuantity: overtime,
      validatedById: args.validatorId,
      validatedAt: new Date(),
      payableId: released.payable.id,
    },
  });

  return {
    ok: true,
    amount: cap.amount,
    released: released.operation.amount,
    payableId: released.payable.id,
  };
}

/**
 * Mode OPR — le responsable de chantier CONSTATE un relevé soumis et le transmet au client.
 *
 * Aucun effet financier : ni créance, ni libération. C'est la validation définitive du client
 * (approveAttendance, sur un relevé `verified`) qui paie. La quantité vérifiée respecte le mode
 * de pointage du contrat (« totale » : la quantité déclarée entière) et borne ce que le client
 * pourra valider.
 */
export async function verifyAttendance(args: {
  attendanceId: string;
  verifierId: string;
  verifiedQuantity: number;
  overtimeQuantity?: number;
}): Promise<{ ok: true } | { ok: false; error: string; allowed?: number }> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: args.attendanceId },
    include: { contract: { select: CONTRACT_ACTORS_SELECT } },
  });
  if (!attendance) return { ok: false, error: "not_found" };
  const { contract } = attendance;
  if (contract.validationMode !== "opr") {
    // En « Moi-même », il n'y a pas d'étape de vérification : le client valide directement.
    return { ok: false, error: contract.clientId === args.verifierId ? "verification_not_applicable" : "not_found" };
  }
  if (!canVerify(contract, args.verifierId)) {
    return { ok: false, error: contract.clientId === args.verifierId ? "site_manager_only" : "not_found" };
  }
  if (attendance.status !== "submitted") return { ok: false, error: "attendance_not_submitted" };

  const rawTerms = contract.spotTimeTerms;
  if (!rawTerms) return { ok: false, error: "not_a_time_contract" };
  const terms = toTerms(rawTerms);

  const quantite = args.verifiedQuantity;
  if (!Number.isFinite(quantite) || quantite <= 0) return { ok: false, error: "invalid_quantity" };
  if (quantite > attendance.declaredQuantity) return { ok: false, error: "approved_above_declared" };
  const rule = checkValidationRule(terms.attendanceValidation ?? "partielle", quantite, attendance.declaredQuantity);
  if (!rule.ok) return { ok: false, error: rule.error };

  // Plafond de quantité vérifié dès ce stade : transmettre au client un relevé qu'il ne pourra pas
  // valider ne ferait que reporter le refus. Les relevés déjà vérifiés mais pas encore validés
  // comptent : ils engagent la même quantité.
  const engages = await prisma.attendance.findMany({
    where: { contractId: attendance.contractId, status: { in: ["approved", "verified"] } },
    select: { status: true, approvedQuantity: true, verifiedQuantity: true },
  });
  const cumul = engages.reduce((s, a) => s + ((a.status === "approved" ? a.approvedQuantity : a.verifiedQuantity) ?? 0), 0);
  const restant = terms.maxQuantity - cumul;
  if (quantite > restant + 1e-9) return { ok: false, error: "quantity_cap_exceeded", allowed: Math.max(0, restant) };

  const overtime = Math.min(Math.max(0, args.overtimeQuantity ?? 0), quantite);
  await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      status: "verified",
      verifiedQuantity: quantite,
      verifiedOvertimeQuantity: overtime,
      verifiedById: args.verifierId,
      verifiedAt: new Date(),
    },
  });

  await notifyMissionParties({
    missionId: contract.missionId,
    type: "pointage_verifie",
    counterpart: {
      userId: contract.clientId,
      message: `Relevé de présence vérifié par le responsable de chantier sur « ${contract.mission.titre} » — à valider définitivement.`,
    },
    actor: {
      userId: args.verifierId,
      message: `Relevé transmis au client pour validation définitive (« ${contract.mission.titre} »).`,
    },
  });
  return { ok: true };
}

/**
 * Un relevé est refusé : rien n'est dû, rien n'est versé, et la période se libère pour une
 * nouvelle déclaration corrigée.
 *
 * Qui refuse, et à quel moment :
 *   - mode « Moi-même » : le client, sur un relevé soumis ;
 *   - mode OPR : le responsable, sur un relevé soumis (constat non conforme) ; le client, sur un
 *     relevé vérifié (il garde le droit de refuser ce qui lui est transmis).
 */
export async function rejectAttendance(args: {
  attendanceId: string;
  validatorId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: args.attendanceId },
    include: { contract: { select: { clientId: true, validationMode: true, siteManagerId: true } } },
  });
  if (!attendance) return { ok: false, error: "not_found" };
  const { contract } = attendance;
  const estClient = contract.clientId === args.validatorId;
  const estVerificateur = contract.validationMode === "opr" && canVerify(contract, args.validatorId);
  if (!estClient && !estVerificateur) return { ok: false, error: "not_found" };
  const statutAttendu = estVerificateur ? "submitted" : decidableStatus(contract.validationMode);
  if (attendance.status !== statutAttendu) {
    return { ok: false, error: estClient && attendance.status === "submitted" ? "verification_required" : "attendance_not_submitted" };
  }
  if (!args.reason.trim()) return { ok: false, error: "rejection_reason_required" };

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { status: "rejected", rejectionReason: args.reason.trim(), validatedById: args.validatorId, validatedAt: new Date() },
  });
  return { ok: true };
}

/** Solde et alerte de financement d'un contrat au temps (§19). */
// ── Contestation d'une partie du relevé (§21) ──────────────────────────────────────────────
//
//     Pointage déclaré : 6 jours
//     Pointage validé  : 4 jours   → payable
//     Pointage contesté: 2 jours   → litige, bloqués
//
// Distinct du simple constat partiel, et c'était le manque : valider 4 jours sur 6 laissait les
// deux autres au séquestre sans les qualifier — ni dus, ni contestés, juste non payés. Le
// prestataire ne savait pas s'ils étaient refusés ou oubliés, et rien ne marquait qu'un
// désaccord existait.
//
// Contester GÈLE la part discutée : elle reste au séquestre, indisponible pour d'autres
// journées, jusqu'à ce que quelqu'un tranche. C'est le sens du §21 — « les montants litigieux
// restent dans le séquestre » : ni versés, ni rendus.

export type DisputeResult =
  | { ok: true; paid: number; frozen: number }
  | { ok: false; error: string; allowed?: number; available?: number };

/**
 * Le validateur reconnaît une partie du relevé et CONTESTE le reste.
 *
 * La part reconnue suit le chemin ordinaire (créance, contrôle de séquestre, libération) ; la
 * part contestée est gelée. Le relevé passe `disputed` — un état qui dit « il reste un désaccord
 * sur ce relevé », ce que ni `approved` ni `rejected` ne peuvent exprimer.
 */
export async function disputeAttendance(args: {
  attendanceId: string;
  validatorId: string;
  approvedQuantity: number;
  reason: string;
}): Promise<DisputeResult> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: args.attendanceId },
    include: { contract: { select: CONTRACT_ACTORS_SELECT } },
  });
  if (!attendance) return { ok: false, error: "not_found" };
  // Contester engage des fonds (gel) : geste du client seul, comme la validation.
  if (!canDecideAttendance(attendance.contract, args.validatorId)) {
    return { ok: false, error: canVerify(attendance.contract, args.validatorId) ? "verification_only" : "not_found" };
  }
  const mode = attendance.contract.validationMode;
  if (attendance.status !== decidableStatus(mode)) {
    return { ok: false, error: mode === "opr" && attendance.status === "submitted" ? "verification_required" : "attendance_not_submitted" };
  }
  if (!args.reason.trim()) return { ok: false, error: "dispute_reason_required" };

  const rawTerms = attendance.contract.spotTimeTerms;
  if (!rawTerms) return { ok: false, error: "not_a_time_contract" };
  const terms = toTerms(rawTerms);

  // En OPR, la base est ce que le responsable a vérifié, pas ce que le prestataire a déclaré.
  const base = mode === "opr" ? (attendance.verifiedQuantity ?? 0) : attendance.declaredQuantity;
  const conteste = base - args.approvedQuantity;
  // Contester zéro n'est pas une contestation : c'est une validation. Refuser ici évite un
  // relevé marqué `disputed` sans qu'aucun désaccord n'existe.
  if (conteste <= 0) return { ok: false, error: "nothing_disputed" };

  // La part reconnue passe par le chemin ORDINAIRE — mêmes plafonds, même créance, même contrôle
  // de séquestre. Contester ne crée pas un second chemin de paiement.
  const approbation =
    args.approvedQuantity > 0
      ? await approveAttendance({
          attendanceId: args.attendanceId,
          validatorId: args.validatorId,
          approvedQuantity: args.approvedQuantity,
          partOfDispute: true,
        })
      : null;
  if (approbation && !approbation.ok) return approbation;

  const montantConteste = attendanceAmount(terms, conteste);
  const gel = await emitDisputeFreeze({
    contractId: attendance.contractId,
    currency: attendance.contract.mission.currency,
    amount: montantConteste,
  });

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      status: "disputed",
      approvedQuantity: args.approvedQuantity,
      rejectionReason: args.reason.trim(),
      validatedById: args.validatorId,
      validatedAt: new Date(),
    },
  });

  return { ok: true, paid: approbation?.ok ? approbation.amount : 0, frozen: gel?.amount ?? 0 };
}

/**
 * Le litige est tranché : la part contestée est soit reconnue et payée, soit définitivement
 * écartée. Dans les deux cas le gel est levé — un différend clos ne doit pas continuer à
 * immobiliser des fonds.
 *
 * @param accept `true` : la part contestée est due et part au prestataire. `false` : elle est
 *   écartée, et redevient simplement disponible au séquestre (donc remboursable au client en fin
 *   de contrat, comme tout reliquat).
 */
export async function resolveAttendanceDispute(args: {
  attendanceId: string;
  validatorId: string;
  accept: boolean;
}): Promise<{ ok: true; paid: number } | { ok: false; error: string }> {
  const attendance = await prisma.attendance.findUnique({
    where: { id: args.attendanceId },
    include: { contract: { select: CONTRACT_ACTORS_SELECT } },
  });
  if (!attendance) return { ok: false, error: "not_found" };
  // Arbitrer libère ou rend des fonds : geste du client seul.
  if (!canDecideAttendance(attendance.contract, args.validatorId)) {
    return { ok: false, error: "not_found" };
  }
  if (attendance.status !== "disputed") return { ok: false, error: "attendance_not_disputed" };

  const rawTerms = attendance.contract.spotTimeTerms;
  if (!rawTerms) return { ok: false, error: "not_a_time_contract" };
  const terms = toTerms(rawTerms);

  const base = attendance.contract.validationMode === "opr" ? (attendance.verifiedQuantity ?? 0) : attendance.declaredQuantity;
  const conteste = base - (attendance.approvedQuantity ?? 0);
  const montantConteste = attendanceAmount(terms, conteste);

  // Le dégel VIENT EN PREMIER, et c'est nécessaire : tant que la somme est gelée, elle n'est pas
  // dans le disponible, et l'invariant n°4 refuserait de la libérer.
  await emitUnfreeze({
    contractId: attendance.contractId,
    currency: attendance.contract.mission.currency,
    amount: montantConteste,
  });

  if (!args.accept) {
    await prisma.attendance.update({
      where: { id: attendance.id },
      data: { status: "approved" },
    });
    return { ok: true, paid: 0 };
  }

  // La totalité déclarée est finalement reconnue : on repasse par le chemin ordinaire, qui
  // réaligne la créance du relevé sur le nouveau montant (clé d'idempotence identique, voir
  // emitScopedRelease).
  const res = await approveAttendanceInternal(attendance.id, args.validatorId, attendance.declaredQuantity);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, paid: res.amount };
}

// `approveAttendance` exige le statut `submitted` ; la résolution d'un litige part de `disputed`.
// Plutôt que d'assouplir cette garde — qui protège le chemin nominal — on remet le relevé dans
// l'état que le chemin ordinaire attend, et on le laisse faire son travail.
async function approveAttendanceInternal(
  attendanceId: string,
  validatorId: string,
  quantity: number
): Promise<ApproveResult> {
  await prisma.attendance.update({ where: { id: attendanceId }, data: { status: "submitted" } });
  return approveAttendance({ attendanceId, validatorId, approvedQuantity: quantity });
}

// ── Clôture d'un contrat au temps (§22, 2026-09-15) ────────────────────────────────────────
//
//     FIN DE CONTRAT → Solde séquestre → Remboursement client
//
// Un contrat au temps finance un PLAFOND et en consomme rarement la totalité. Tant qu'il n'est
// pas épuisé, rien ne disait que le chantier était fini : la mission restait ouverte pour
// toujours, et le reliquat — souvent l'essentiel du séquestre — n'était jamais rendu, puisque le
// balayage des reliquats n'agit que sur les missions déjà terminées. C'était exactement
// « l'argent fantôme » que le §22 interdit.
//
// Seul le CLIENT clôt : c'est son argent qui revient, et c'est lui qui sait que le travail est
// fini. Pas le responsable de chantier — il constate des présences, il ne décide pas de la fin
// d'un engagement financier.
//
// Deux refus, parce qu'une clôture ne doit rien trancher en silence :
//   - un relevé soumis ou contesté attend encore une décision : clore rendrait au client un
//     travail peut-être dû ;
//   - une créance validée mais non payée (séquestre insuffisant, versement en vol ou refusé par
//     le PSP) est DUE au prestataire : rembourser le séquestre maintenant la lui retirerait.
export type CloseTimeContractResult =
  | { ok: true; refunded: number }
  | {
      ok: false;
      error: "not_found" | "not_a_time_contract" | "already_closed" | "mediation_open" | "attendance_pending" | "payment_pending";
      count?: number;
    };

export async function closeTimeContract(args: { missionId: string; clientId: string }): Promise<CloseTimeContractResult> {
  const contract = await prisma.prestationContract.findUnique({
    where: { missionId: args.missionId },
    select: {
      id: true,
      clientId: true,
      providerId: true,
      spotTimeTerms: { select: { id: true } },
      mission: { select: { currency: true, titre: true } },
    },
  });
  if (!contract || contract.clientId !== args.clientId) return { ok: false, error: "not_found" };
  if (!contract.spotTimeTerms) return { ok: false, error: "not_a_time_contract" };

  const verdict = await prisma.$transaction(
    async (tx): Promise<{ ok: true; alreadyClosed: boolean } | Extract<CloseTimeContractResult, { ok: false }>> => {
      // Même verrou que la déclaration d'un relevé et que toute émission sur ce séquestre.
      await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${contract.id} FOR UPDATE`;
      const mission = await tx.mission.findUniqueOrThrow({ where: { id: args.missionId }, select: { status: true } });
      if (mission.status === "mediation_ouverte") return { ok: false, error: "mediation_open" };
      // Mission DÉJÀ close — le cas typique : le webhook la clôt dès que les versements atteignent
      // le plafond, alors qu'une contestation est encore ouverte. Son arbitrage libère ensuite des
      // fonds sur une mission close, que plus rien ne rendait au client avant le balayage du
      // lendemain (constaté par le test de workflow, 2026-09-15). La clôture sert alors à
      // récupérer ce solde, avec les mêmes refus que ci-dessous.
      const alreadyClosed = mission.status === "cloturee" || mission.status === "remboursee";

      const enAttente = await tx.attendance.count({
        where: { contractId: contract.id, status: { in: ["submitted", "verified", "disputed"] } },
      });
      if (enAttente > 0) return { ok: false, error: "attendance_pending", count: enAttente };

      // `failed` compte : un versement refusé par le PSP reste dû et sera repris.
      const dus = await tx.payable.count({
        where: { contractId: contract.id, status: { in: ["validated", "instructed", "failed"] } },
      });
      if (dus > 0) return { ok: false, error: "payment_pending", count: dus };

      if (!alreadyClosed) {
        await tx.mission.update({ where: { id: args.missionId }, data: { status: "cloturee" } });
      }
      return { ok: true, alreadyClosed };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
  if (!verdict.ok) return verdict;

  // Hors transaction, comme toute émission : le remboursement prend lui-même le verrou. S'il
  // échoue ici (PSP indisponible), la mission est close et le balayage des reliquats le reprendra.
  const refund = await emitContractRefund({ contractId: contract.id, currency: contract.mission.currency });
  // Déjà close et rien à rendre : la demande n'a eu aucun effet, et il faut le dire.
  if (verdict.alreadyClosed && !refund) return { ok: false, error: "already_closed" };
  const montant = refund ? `${refund.amount.toLocaleString("fr-FR")} ${contract.mission.currency}` : null;

  await notifyMissionParties({
    missionId: args.missionId,
    type: "time_contract_closed",
    actor: {
      userId: contract.clientId,
      message: montant
        ? `Chantier clôturé — ${montant} non consommés vous sont restitués sur « ${contract.mission.titre} ».`
        : `Chantier clôturé sur « ${contract.mission.titre} ». Aucun solde à restituer.`,
    },
    counterpart: {
      userId: contract.providerId,
      message: `Le client a clôturé le chantier « ${contract.mission.titre} ». Tous vos relevés constatés vous ont été versés.`,
    },
  });

  return { ok: true, refunded: refund?.amount ?? 0 };
}
