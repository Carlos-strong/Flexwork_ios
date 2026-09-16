import { randomUUID } from "crypto";
import type { PspEscrowOperation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertFundingPreconditions, escrowBalance } from "@/lib/escrow";
import { virtualPspName, isVirtualPspEnabled, shouldAutoConfirmStub, autoConfirmPending } from "@/lib/psp-virtual";

// Recharge du séquestre (§13 du cahier des charges, Phase 3 — 2026-09-14).
//
// Depuis la Phase 1, une validation métier dont le séquestre ne couvre pas le montant ne
// transmet AUCUNE instruction : le payable reste `validated`, et la somme reste due. C'est la
// règle par défaut du §13 — « aucune instruction PSP tant que le payable complet n'est couvert
// par le séquestre », jamais de paiement partiel implicite. Il manquait la suite : le geste qui
// permet au client de compléter, et donc de débloquer ce paiement.
//
// ── Pourquoi une route dédiée plutôt qu'un assouplissement de `hasInFlightHold` ─────────────
// La garde anti-doublon des deux chemins de financement (contrat et jalon) existe pour une
// raison précise et constatée : un double-clic transmettait DEUX débits Mobile Money pour la
// même portée, sans aucune route pour annuler le second. La desserrer pour permettre la
// recharge aurait rouvert ce défaut sur le chemin le plus emprunté, afin de servir un cas rare.
//
// Un chemin séparé permet en outre que le MONTANT soit dérivé et non saisi : on recharge
// exactement ce qui manque, ni plus ni moins. Le client ne choisit pas combien il remet au
// séquestre — le système sait déjà ce qui est dû.

export type RechargeNeed = {
  /** Σ des payables reconnus dus mais pas encore instruits (statut `validated`). */
  due: number;
  /** Solde réellement disponible au séquestre. */
  available: number;
  /** Ce qu'il faut ajouter pour couvrir `due`. 0 = rien à recharger. */
  missing: number;
  currency: string;
  /** Un financement est déjà en vol : rien à demander tant qu'il n'est pas tranché. */
  pendingHold: boolean;
};

/**
 * Ce qui manque au séquestre pour honorer les obligations déjà reconnues.
 *
 * Fondé sur les PAYABLES et non sur le prix du contrat : seule une somme déjà validée par le
 * client (ou acceptée tacitement) est due. Réclamer un complément sur la base du prix
 * contractuel demanderait au client de financer par avance des jalons qu'il n'a pas encore
 * approuvés — l'inverse de ce que le séquestre protège.
 */
export async function rechargeNeed(contractId: string): Promise<RechargeNeed | null> {
  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    select: { mission: { select: { currency: true } } },
  });
  if (!contract) return null;

  const [pending, balance] = await Promise.all([
    // Un HOLD `pending` est un débit en vol : le client a peut-être déjà payé, le webhook n'est
    // pas encore arrivé. Demander un complément maintenant lui ferait payer deux fois.
    prisma.pspEscrowOperation.findFirst({
      where: { contractId, instructionType: "hold", status: "pending" },
      select: { id: true },
    }),
    escrowBalance(contractId),
  ]);

  // `releasable` est le montant reconnu dû et pas encore instruit — ce module en faisait son
  // propre agrégat avant que le compte financier ne le porte (2026-09-14). Une seule définition.
  const due = balance.releasable;
  return {
    due,
    available: balance.available,
    missing: Math.max(0, due - balance.available),
    currency: contract.mission.currency,
    pendingHold: pending !== null,
  };
}

export type RechargeResult =
  | { ok: true; operation: PspEscrowOperation; amount: number }
  | { ok: false; error: string; status: number };

/**
 * Transmet une instruction HOLD complémentaire, du montant exact qui manque.
 *
 * Les préconditions de financement sont celles du financement initial — mêmes règles de
 * conformité (`assertFundingPreconditions`), parce que ce qui autorise à débiter un client ne
 * dépend pas de ce qui motive le débit.
 */
export async function requestRecharge(contractId: string): Promise<RechargeResult> {
  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    include: { client: true, mission: true },
  });
  if (!contract) return { ok: false, error: "not_found", status: 404 };
  if (!contract.clientSignedAt || !contract.providerSignedAt) {
    return { ok: false, error: "contract_not_signed", status: 409 };
  }

  const precondition = await assertFundingPreconditions(contract);
  if (precondition) return precondition;

  const need = await rechargeNeed(contractId);
  if (!need) return { ok: false, error: "not_found", status: 404 };
  // Garde anti-doublon propre à la recharge : pas « un HOLD existe-t-il ? » (il en existe
  // forcément un, celui du financement initial), mais « un HOLD est-il encore en vol ? ».
  if (need.pendingHold) {
    return { ok: false, error: "hold_already_requested", status: 409 };
  }
  if (need.missing <= 0) {
    return { ok: false, error: "nothing_to_recharge", status: 409 };
  }

  const operation = await prisma.pspEscrowOperation.create({
    data: {
      contractId,
      pspName: virtualPspName(),
      pspReference: `hold_recharge_${randomUUID()}`,
      amount: need.missing,
      currency: need.currency,
      instructionType: "hold",
    },
  });

  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }

  return { ok: true, operation, amount: need.missing };
}
