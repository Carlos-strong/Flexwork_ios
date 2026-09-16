import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { IN_FLIGHT_STATUSES, netHeldAmount, outstandingFreeze } from "@/lib/escrow-instructions";
import { GigSignatureService } from "@/lib/gig-signature";

// Clôture et PAIEMENT d'une commande Gig (2026-09-14).
//
// Ce que ce fichier corrige : le domaine Gig savait faire ENTRER l'argent (`hold`, à la
// signature du client) et le faire REVENIR au client (`refund`, annulation des 24h), mais
// n'avait aucun chemin pour le faire PARTIR vers le prestataire. Aucune instruction `release`
// n'existait dans tout le domaine, et `GigOrderStatus.completed` — pourtant déclaré
// « livraison validée / clôturée » — n'était écrit par aucune ligne de code.
//
// Conséquence concrète, en production : un Gig payé, signé par les deux parties et livré
// laissait les fonds au séquestre indéfiniment. La seule sortie câblée les rendait au client.
// Le prestataire livrait sans jamais pouvoir être payé.
//
// ── Pourquoi ce module reste distinct de src/lib/escrow.ts ─────────────────────────────────
// Depuis l'unification des registres (2026-09-14), les deux domaines écrivent dans la MÊME table
// (`PspEscrowOperation`, portée `gig_order`) et partagent la règle de solde (`netHeldAmount`).
// Ce qui reste ici est ce qui n'a pas d'équivalent côté mission et ne doit pas s'y mélanger : une
// commande Gig n'a ni jalon, ni retenue de garantie, ni financement progressif, ni médiation.
// L'unification porte sur la façon de COMPTER l'argent, pas sur la façon de conduire une mission.

// Solde réellement séquestré sur une commande. Même forme et même règle que `heldBalance`
// (src/lib/escrow.ts) : un `groupBy` par type, puis la règle partagée.
export async function gigHeldBalance(
  orderId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<number> {
  const rows = await client.pspEscrowOperation.groupBy({
    by: ["instructionType", "status"],
    where: { orderId, status: { in: IN_FLIGHT_STATUSES } },
    _sum: { amount: true },
  });
  return netHeldAmount(
    rows.map((row) => ({
      instructionType: row.instructionType,
      status: row.status,
      amount: row._sum.amount ?? 0,
    }))
  );
}

/**
 * Solde DISPONIBLE d'une commande : ce qui peut réellement sortir maintenant.
 *
 * Distinct de `gigHeldBalance` (ce qui reste détenu) exactement comme `available` l'est de
 * `held` côté mission. Aujourd'hui les deux coïncident — une commande Gig n'a ni gel ni retenue
 * de garantie — et c'est précisément pourquoi il fallait les séparer AVANT que ce ne soit plus
 * vrai : le jour où un litige touchera une commande, le gel devra la rendre indisponible sans
 * qu'on ait à se souvenir de corriger ce calcul.
 */
export async function gigAvailableBalance(
  orderId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<number> {
  const rows = await client.pspEscrowOperation.groupBy({
    by: ["instructionType", "status"],
    where: { orderId, status: { in: IN_FLIGHT_STATUSES } },
    _sum: { amount: true },
  });
  const flat = rows.map((row) => ({
    instructionType: row.instructionType as string,
    status: row.status as string,
    amount: row._sum.amount ?? 0,
  }));
  const held = netHeldAmount(flat);
  return Math.max(0, held - Math.min(outstandingFreeze(flat), Math.max(0, held)));
}

export type CompleteGigResult =
  | { ok: true; amount: number; currency: string }
  | { ok: false; error: "not_found" | "order_not_active" | "nothing_to_release" | "escrow_insufficient" };

/**
 * Valide la livraison d'une commande Gig : libère les fonds au prestataire et clôt la commande.
 *
 * Idempotent par le statut, comme `refundExpiredOrder` : la garde `status === "active"` est
 * posée DANS la transaction, sous le verrou de la ligne — un double clic ou deux onglets voient
 * le second appel trouver la commande déjà `completed` et ne rien instruire. Sans ce verrou, la
 * lecture du statut et l'écriture de l'instruction seraient deux requêtes non atomiques : c'est
 * exactement la race condition que `emitScopedRelease` corrige côté missions, et il n'y avait
 * aucune raison de la réintroduire ici.
 *
 * Le montant libéré est le solde RÉELLEMENT séquestré, jamais `order.montant` : c'est la seule
 * borne qui vaille (cahier des charges §1, invariant 4 — « payableAmount <= availableEscrowAmount »),
 * et elle protège du cas où un mouvement antérieur aurait déjà fait sortir une partie des fonds.
 */
export async function completeGigOrder(orderId: string): Promise<CompleteGigResult> {
  const outcome = await prisma.$transaction(
    async (tx): Promise<CompleteGigResult> => {
      await tx.$queryRaw`SELECT id FROM "GigOrder" WHERE id = ${orderId} FOR UPDATE`;

      const order = await tx.gigOrder.findUnique({
        where: { id: orderId },
        select: { status: true, currency: true, montant: true },
      });
      if (!order) return { ok: false, error: "not_found" };
      // Seule une commande engagée (les deux signatures) peut être validée. `created` n'est pas
      // financée, `client_signed` attend encore le prestataire, `completed`/`cancelled`/
      // `refunded` sont terminales.
      if (order.status !== "active") return { ok: false, error: "order_not_active" };

      // ── Obligation de paiement (Phase 1, étendue au domaine Gig — 2026-09-14) ─────────
      // La validation crée d'abord une CRÉANCE, et seulement ensuite l'instruction qui la
      // règle. Jusqu'ici ce chemin émettait directement l'instruction : le registre était
      // unifié (0.1), mais la couche obligation ne l'était pas — « validé ≠ payé » n'était
      // matérialisé que du côté mission, et l'invariant n°4 n'était pas vérifié ici.
      //
      // `contractId` reste nul : une commande Gig n'a pas de contrat de prestation. C'est
      // précisément le cas pour lequel l'identité d'un payable a été fondée sur sa SOURCE, et
      // la clé étrangère laissée nullable, plutôt que de devoir migrer la table aujourd'hui.
      const montantDu = order.montant;
      const idempotencyKey = `gig:${orderId}:final`;
      const existing = await tx.payable.findUnique({ where: { idempotencyKey } });
      const payable = existing
        ? await tx.payable.update({
            where: { id: existing.id },
            data: { amount: montantDu, status: "validated", escrowOperationId: null },
          })
        : await tx.payable.create({
            data: {
              sourceType: "gig_order",
              sourceId: orderId,
              amount: montantDu,
              currency: order.currency,
              status: "validated",
              idempotencyKey,
            },
          });

      // Invariant n°4 : jamais plus que ce dont le séquestre dispose. La borne est le solde
      // DISPONIBLE, pas le montant de la commande — un mouvement antérieur (remboursement
      // partiel, gel à venir) a pu en faire sortir une partie.
      const available = await gigAvailableBalance(orderId, tx);
      if (available <= 0) return { ok: false, error: "nothing_to_release" };
      if (montantDu > available) {
        // Aucun versement partiel implicite (§13) : la créance reste due, en `validated`.
        return { ok: false, error: "escrow_insufficient" };
      }

      const operation = await tx.pspEscrowOperation.create({
        data: {
          sourceType: "gig_order",
          orderId,
          pspName: "gig-release",
          amount: montantDu,
          currency: order.currency,
          instructionType: "release",
          // Confirmée d'emblée, convention du domaine Gig : il n'y a pas de webhook PSP dans ce
          // périmètre (voir refundExpiredOrder, src/lib/gig-expiry.ts). Les missions, elles,
          // attendent la confirmation signée du PSP — deux périmètres, deux conventions, et
          // s'aligner sur celle du domaine qu'on répare vaut mieux que d'en importer une autre.
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      });

      // Le payable traverse ses trois états dans la même transaction, parce que ce domaine
      // règle de façon SYNCHRONE : l'instruction naît confirmée, il n'y a pas de webhook à
      // attendre. Les états restent vrais — la créance a bien existé avant d'être réglée — et
      // le laisser en `instructed` le ferait compter indéfiniment comme dû.
      await tx.payable.update({
        where: { id: payable.id },
        data: { status: "paid", escrowOperationId: operation.id, paidAt: new Date() },
      });
      await tx.gigOrder.update({ where: { id: orderId }, data: { status: "completed" } });

      return { ok: true, amount: montantDu, currency: order.currency };
    },
    // Même budget que les transactions verrouillées du domaine mission (LOCKED_TX_OPTIONS,
    // src/lib/escrow.ts) : l'attente du verrou est comptée dedans, et 5 s (défaut Prisma) est
    // court pour un chemin monétaire sous contention.
    { maxWait: 10_000, timeout: 20_000 }
  );

  // Audit HORS transaction : `addAuditEntry` chaîne les entrées par hash (lecture de la
  // précédente puis écriture) — l'appeler dedans allongerait la section critique d'une
  // opération qui n'a pas besoin d'être atomique avec le mouvement financier.
  if (outcome.ok) {
    await GigSignatureService.addAuditEntry(
      orderId,
      "GIG_RELEASE_CONFIRMED",
      `Livraison validée par le client — ${outcome.amount} ${outcome.currency} libérés au prestataire, commande clôturée`
    );
  }

  return outcome;
}
