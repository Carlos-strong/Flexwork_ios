import { prisma } from "@/lib/db";
import { escrowBalance, type EscrowBalance } from "@/lib/escrow";

// ── LA RÈGLE D'OR DU SÉQUESTRE (§26 du cahier des charges — 2026-09-14) ────────────────────
//
// Deux règles gouvernent tout le moteur financier. Elles sont énoncées ici dans les termes du
// cahier des charges, et — surtout — rendues VÉRIFIABLES : une règle qu'on ne peut pas contrôler
// n'est pas une spécification, c'est une intention.
//
//   RÈGLE 1 — Aucune obligation de paiement ne peut être exécutée par la plateforme sans
//   disponibilité préalable des fonds correspondants dans le séquestre. Toute validation de
//   prestation, de sous-tâche, de jalon ou de temps travaillé crée AU MAXIMUM une créance
//   payable ; elle ne constitue pas à elle seule une autorisation de débit hors séquestre.
//
//   RÈGLE 2 — Tout montant litigieux, retenu ou non encore validé demeure dans le séquestre
//   jusqu'à une décision autorisant sa libération ou son remboursement.
//
// ── Pourquoi un contrôle et non un commentaire ─────────────────────────────────────────────
// Ces deux règles sont respectées aujourd'hui par une dizaine de chemins distincts — validation
// de jalon, point d'étape progressif, acceptation tacite, retenue de garantie, relevé de
// présence, résolution de médiation, remboursement de reliquat, commande Gig. Chacun les tient
// pour ses propres raisons, et rien ne garantissait qu'un onzième chemin les tiendrait aussi.
//
// `checkEscrowInvariants` les vérifie sur l'ÉTAT, pas sur le chemin : peu importe comment un
// contrat est arrivé là, son séquestre doit satisfaire ces égalités. C'est ce qui permet de les
// asserter après n'importe quelle opération, dans n'importe quel test, sans rien savoir du mode.

export const GOLDEN_RULES = {
  rule1:
    "Aucune obligation de paiement ne peut être exécutée sans disponibilité préalable des fonds " +
    "dans le séquestre. Une validation crée au maximum une créance payable.",
  rule2:
    "Tout montant litigieux, retenu ou non encore validé demeure dans le séquestre jusqu'à une " +
    "décision autorisant sa libération ou son remboursement.",
} as const;

export type InvariantViolation = {
  rule: "rule1" | "rule2" | "accounting";
  detail: string;
};

// Tolérance flottante, alignée sur MONTANT_EPSILON (src/lib/jalons.ts) : ces égalités portent sur
// des sommes de `Float`, et un écart de 0,001 est un artefact de représentation, pas une fuite.
const EPSILON = 0.01;

/**
 * Vérifie les deux règles d'or sur l'état courant d'un contrat.
 *
 * Retourne la liste des violations — vide quand tout est en règle. Ne lève jamais : un contrôle
 * d'invariant qui explose est inutilisable là où il sert le plus, c'est-à-dire après une
 * opération qui a peut-être mal tourné.
 */
export async function checkEscrowInvariants(contractId: string): Promise<InvariantViolation[]> {
  const [balance, payables] = await Promise.all([
    escrowBalance(contractId),
    prisma.payable.findMany({
      where: { contractId },
      select: { id: true, amount: true, status: true, escrowOperationId: true },
    }),
  ]);

  return checkBalanceInvariants(balance, payables);
}

/**
 * Cœur du contrôle — PUR, pour être testable sur des états construits à la main, y compris ceux
 * qu'aucun chemin du code ne sait produire aujourd'hui.
 */
export function checkBalanceInvariants(
  balance: EscrowBalance,
  payables: { id: string; amount: number; status: string; escrowOperationId: string | null }[]
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // ── Identité comptable ───────────────────────────────────────────────────────────────────
  // Tout ce qui est entré est soit sorti, soit encore là. Si cette égalité tombe, plus aucun
  // des deux autres contrôles ne veut rien dire — c'est le registre lui-même qui est faux.
  const sortiOuReste = balance.released + balance.refunded + balance.held;
  if (Math.abs(balance.funded - sortiOuReste) > EPSILON) {
    violations.push({
      rule: "accounting",
      detail: `financé ${balance.funded} ≠ libéré ${balance.released} + remboursé ${balance.refunded} + détenu ${balance.held}`,
    });
  }

  // ── RÈGLE 1 ──────────────────────────────────────────────────────────────────────────────
  // Rien n'est sorti au-delà de ce qui est entré. C'est la forme la plus forte de « pas de débit
  // hors séquestre » : elle ne suppose aucune confiance dans les gardes en amont.
  if (balance.released + balance.refunded > balance.funded + EPSILON) {
    violations.push({
      rule: "rule1",
      detail: `sorties ${balance.released + balance.refunded} > financement ${balance.funded}`,
    });
  }

  // Le disponible ne peut pas être négatif : il borne toutes les instructions, et une borne
  // négative autoriserait tout.
  if (balance.available < -EPSILON) {
    violations.push({ rule: "rule1", detail: `disponible négatif : ${balance.available}` });
  }

  // « Une validation crée AU MAXIMUM une créance payable » : une créance validée mais non encore
  // instruite ne doit porter AUCUNE instruction. Si elle en porte une, un débit a eu lieu sans
  // que la créance soit passée par `instructed` — donc sans contrôle de solde.
  for (const p of payables.filter((p) => p.status === "validated" && p.escrowOperationId)) {
    violations.push({
      rule: "rule1",
      detail: `créance ${p.id} encore « validated » mais déjà rattachée à une instruction`,
    });
  }

  // Symétrique : une créance PAYÉE sans instruction signifierait un paiement hors registre.
  for (const p of payables.filter((p) => p.status === "paid" && !p.escrowOperationId)) {
    violations.push({
      rule: "rule1",
      detail: `créance ${p.id} marquée payée sans instruction correspondante`,
    });
  }

  // ── RÈGLE 2 ──────────────────────────────────────────────────────────────────────────────
  // Litigieux et retenu SONT au séquestre — ils ne peuvent donc pas excéder ce qu'il contient.
  // Une violation ici signifierait qu'on a compté comme immobilisé de l'argent déjà sorti.
  if (balance.blocked + balance.retained > balance.held + EPSILON) {
    violations.push({
      rule: "rule2",
      detail: `bloqué ${balance.blocked} + retenu ${balance.retained} > détenu ${balance.held}`,
    });
  }

  // …et ils ne sont JAMAIS disponibles : le disponible est ce qui reste une fois ces deux-là
  // retranchés. C'est la traduction directe de « demeure dans le séquestre jusqu'à une décision ».
  const attendu = Math.max(0, balance.held - balance.blocked - balance.retained);
  if (Math.abs(balance.available - attendu) > EPSILON) {
    violations.push({
      rule: "rule2",
      detail: `disponible ${balance.available} ≠ détenu ${balance.held} − bloqué ${balance.blocked} − retenu ${balance.retained}`,
    });
  }

  return violations;
}
