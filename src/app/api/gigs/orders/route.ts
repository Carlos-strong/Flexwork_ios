import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/gigs/orders — commandes Gig de l'utilisateur connecté, des DEUX côtés :
//   - `?as=provider` (défaut) : commandes reçues sur SES Gigs → rubrique Offres du
//     dashboard prestataire (onglet « Commandes »).
//   - `?as=client`            : commandes qu'il a PASSÉES → rubrique Offres du dashboard
//     client (onglet « Mes commandes »).
// L'interlocuteur renvoyé s'inverse avec le côté demandé (`counterpart`) : côté prestataire
// c'est l'acheteur, côté client c'est le vendeur. Le détail d'une commande (signatures
// vérifiées, QR) reste sur GET /api/gigs/orders/[orderId] (réservé aux 2 parties).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const asClient = new URL(req.url).searchParams.get("as") === "client";

  const orders = await prisma.gigOrder.findMany({
    // Le filtre porte sur le côté demandé : un utilisateur ne voit jamais que les commandes
    // dont il est effectivement partie (famille 3 — propriété dans le where, jamais après).
    where: asClient ? { clientId: userId } : { providerId: userId },
    include: {
      gig: { select: { id: true, titre: true, domaine: true } },
      client: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
      provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    items: orders.map((o) => {
      const other = asClient ? o.provider : o.client;
      const counterpart = {
        id: other.id,
        name:
          [other.firstname, other.lastname].filter(Boolean).join(" ").trim() ||
          (asClient ? "Prestataire" : "Client"),
        avatarUrl: other.avatarPath ? `/api/users/${other.id}/avatar` : null,
      };
      return {
        id: o.id,
        gigId: o.gig.id,
        titre: o.gig.titre,
        domaine: o.gig.domaine,
        montant: o.montant,
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt,
        clientSignedAt: o.clientSignedAt,
        providerSignedAt: o.providerSignedAt,
        refundedAt: o.refundedAt,
        counterpart,
        // `client` conservé pour ne pas casser GigOrdersPanel (côté prestataire) qui le
        // consomme déjà ; identique à `counterpart` dans ce sens.
        client: asClient ? counterpart : counterpart,
      };
    }),
  });
}
