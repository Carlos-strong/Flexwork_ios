import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { kycBlockFor } from "@/lib/kyc-policy";
import { GIG_TIERS, type GigTier } from "@/lib/gig-rules";

export const dynamic = "force-dynamic";

// POST /api/gigs/[id]/purchase — un CLIENT achète un Gig publié → création de la commande
// (GigOrder, statut `created`) avec snapshot immuable du Gig. Le client signe ensuite en
// premier (1/2) sur la page commande (flux inversé), ce qui déclenche la mise sous séquestre.
//
// Formules (2026-11-08) : `{ tier: "basique" | "standard" | "premium" }`. Le PRIX, le DÉLAI et
// les RÉVISIONS viennent de la formule enregistrée en base — jamais du navigateur. Formule
// absente : Basique. Un Gig antérieur aux formules se commande à son prix unique.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  // Acheter un Gig crée une commande ferme : identité vérifiée exigée (src/lib/kyc-policy.ts).
  const kycBlock = await kycBlockFor(userId, "contractualiser");
  if (kycBlock) {
    return NextResponse.json(kycBlock, { status: 403 });
  }

  const gig = await prisma.gig.findUnique({ where: { id: (await params).id }, include: { packages: true } });
  if (!gig || gig.status !== "publie") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Un client ne peut pas acheter son propre Gig (invariant famille 4, même principe que
  // self_dealing_forbidden côté Mission).
  if (gig.providerId === userId) {
    return NextResponse.json({ error: "self_dealing_forbidden", message: "Vous ne pouvez pas acheter votre propre Gig." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { tier?: unknown };
  let pkg: (typeof gig.packages)[number] | null = null;
  if (gig.packages.length) {
    const tier: GigTier = typeof body.tier === "string" && (GIG_TIERS as readonly string[]).includes(body.tier) ? (body.tier as GigTier) : "basique";
    pkg = gig.packages.find((p) => p.tier === tier) ?? null;
    if (!pkg) return NextResponse.json({ error: "package_not_found", message: "Cette formule n'existe pas." }, { status: 404 });
  }
  const prix = pkg?.prix ?? gig.prix;
  const delaiJours = pkg?.delaiJours ?? gig.delaiJours;

  const order = await prisma.gigOrder.create({
    data: {
      gigId: gig.id,
      clientId: userId,
      providerId: gig.providerId,
      montant: prix,
      currency: gig.currency,
      packageTier: pkg?.tier ?? null,
      termsSnapshot: {
        gig: { id: gig.id, titre: gig.titre, description: gig.description, domaine: gig.domaine },
        prix,
        currency: gig.currency,
        delaiJours,
        tags: gig.tags,
        // Formule achetée, figée : ce qui est inclus et le nombre de révisions font partie de
        // l'engagement au même titre que le prix.
        ...(pkg
          ? { formule: { tier: pkg.tier, titre: pkg.titre, description: pkg.description, revisions: pkg.revisions } }
          : {}),
        dateAchat: new Date().toISOString(),
      },
      status: "created",
    },
  });

  return NextResponse.json({ orderId: order.id }, { status: 201 });
}
