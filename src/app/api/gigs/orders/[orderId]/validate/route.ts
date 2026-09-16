import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { completeGigOrder } from "@/lib/gig-completion";
import { notifyBoth } from "@/lib/notify";

// POST /api/gigs/orders/[orderId]/validate — le CLIENT valide la livraison : les fonds sont
// libérés au prestataire et la commande est clôturée (2026-09-14).
//
// Cette route manquait purement et simplement. Le domaine Gig savait encaisser et rembourser,
// jamais payer (voir src/lib/gig-completion.ts) : la promesse faite au prestataire à la
// signature — « les fonds sont sous séquestre jusqu'à la livraison » — n'avait aucune suite.
//
// Réservée au CLIENT, jamais au prestataire : c'est la symétrie exacte de la validation d'un
// livrable de mission (POST /api/missions/[id]/jalons/[jalonId]/validate). Un prestataire
// capable de déclencher son propre paiement viderait le séquestre de sa fonction.
//
// Un tiers reçoit 404, indistinguable d'une commande inexistante — règle R02, même convention
// que GET /api/gigs/orders/[orderId].
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { orderId } = await params;

  const order = await prisma.gigOrder.findFirst({
    where: { id: orderId, clientId: userId },
    select: {
      id: true,
      clientId: true,
      providerId: true,
      gig: { select: { titre: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await completeGigOrder(orderId);
  if (!result.ok) {
    // `order_not_active` couvre aussi bien la commande pas encore engagée que celle DÉJÀ
    // validée : dans les deux cas l'action demandée n'a pas lieu d'être, et distinguer les deux
    // apprendrait au client l'état exact d'une commande qu'il peut de toute façon consulter.
    //
    // `escrow_insufficient` (2026-09-14) : la créance est enregistrée et reste due, mais le
    // séquestre ne la couvre pas — aucun versement partiel implicite (§13). Le cas ne devrait
    // pas se présenter sur une commande Gig, dont le séquestre porte le montant entier dès la
    // signature ; il est renvoyé explicitement plutôt que confondu avec « rien à libérer ».
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  const montant = result.amount.toLocaleString("fr-FR");
  await notifyBoth({
    type: "gig_order_completed",
    counterpart: {
      userId: order.providerId,
      message: `Livraison validée — ${montant} ${result.currency} libérés pour « ${order.gig.titre} ».`,
      email: {
        subject: `Paiement libéré — ${order.gig.titre}`,
        text: `Le client a validé votre livraison pour le Gig « ${order.gig.titre} ». Les fonds sous séquestre, soit ${montant} ${result.currency}, vous ont été libérés et la commande est clôturée.`,
        html: `<p>Le client a validé votre livraison pour le Gig <strong>${order.gig.titre}</strong>.</p><p>Les fonds sous séquestre, soit <strong>${montant} ${result.currency}</strong>, vous ont été libérés et la commande est clôturée.</p>`,
      },
    },
    actor: {
      userId: order.clientId,
      message: `Vous avez validé la livraison de « ${order.gig.titre} » — ${montant} ${result.currency} libérés au prestataire.`,
      email: {
        subject: `Livraison validée — ${order.gig.titre}`,
        text: `Votre validation de la livraison du Gig « ${order.gig.titre} » a été enregistrée. Les fonds sous séquestre, soit ${montant} ${result.currency}, ont été libérés au prestataire et la commande est clôturée.`,
      },
    },
  });

  return NextResponse.json({ amount: result.amount, currency: result.currency, status: "completed" });
}
