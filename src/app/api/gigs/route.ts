import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { kycBlockFor } from "@/lib/kyc-policy";
import { gigInputSchema, missingVisual } from "@/lib/gig-rules";
import { serializeGig } from "@/lib/gig-serialize";

export const dynamic = "force-dynamic";

const PROVIDER_SELECT = { id: true, firstname: true, lastname: true, avatarPath: true } as const;

// GET /api/gigs — catalogue des Gigs publiés (tout utilisateur connecté), ou « Mes Gigs » du
// prestataire connecté avec ?mine=true (tous statuts + nombre de commandes).
//
// Recherche (2026-11-08) : `?q=` cherche dans le titre, la description et les MOTS-CLÉS du
// Gig — c'est à cela que servent les mots-clés saisis par le prestataire. `?domaine=` filtre
// le domaine exact.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const domaine = searchParams.get("domaine");
  const mine = searchParams.get("mine") === "true";
  const q = searchParams.get("q")?.trim().slice(0, 80) || null;

  const where: Prisma.GigWhereInput = mine
    ? { providerId: userId }
    : {
        status: "publie",
        // Catalogue CLIENT (2026-11-09) : un compte à la fois client et prestataire n'y voit pas
        // ses propres services — il ne peut pas les commander (POST …/purchase, 409
        // self_dealing_forbidden). Il les gère depuis /profile?tab=services.
        providerId: { not: userId },
        ...(domaine ? { domaine } : {}),
        ...(q
          ? {
              OR: [
                { titre: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { tags: { has: q.toLowerCase() } },
              ],
            }
          : {}),
      };

  const gigs = await prisma.gig.findMany({
    where,
    include: { provider: { select: PROVIDER_SELECT }, packages: true, _count: { select: { orders: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    items: gigs.map((g) => ({
      ...serializeGig(g),
      // Champ historique, conservé pour les écrans qui le lisent encore.
      prix: g.packages.length ? serializeGig(g).prixDepart : g.prix,
      ordersCount: g._count.orders,
      provider: {
        id: g.provider.id,
        name: [g.provider.firstname, g.provider.lastname].filter(Boolean).join(" ").trim() || "Prestataire",
        avatarUrl: g.provider.avatarPath ? `/api/users/${g.provider.id}/avatar` : null,
      },
    })),
  });
}

// POST /api/gigs — un prestataire crée un Gig : titre « Je vais… », trois formules à prix
// progressifs, description, mots-clés, vidéo facultative (src/lib/gig-rules.ts).
//
// Les photos (3 au plus) se téléversent APRÈS la création (POST /api/gigs/[id]/images) : elles
// ont besoin de l'id du Gig. Un Gig ne peut donc être publié d'emblée que s'il a une vidéo ; sinon
// il naît en brouillon et se publie une fois la couverture ajoutée (PATCH /api/gigs/[id]).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  // Publier un Gig, c'est proposer une prestation ferme : identité vérifiée exigée (src/lib/kyc-policy.ts).
  const kycBlock = await kycBlockFor(userId, "publier_gig");
  if (kycBlock) {
    return NextResponse.json(kycBlock, { status: 403 });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role === "client") {
    return NextResponse.json({ error: "Seuls les prestataires peuvent publier un Gig" }, { status: 403 });
  }

  const parsed = gigInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: "invalid_payload", message: first?.message ?? "Gig incomplet.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const g = parsed.data;
  const wantsPublish = g.status === "publie";
  if (wantsPublish && missingVisual({ imagePaths: [], videoUrl: g.videoUrl ?? null })) {
    return NextResponse.json(
      { error: "visual_required", message: "Ajoutez au moins une photo ou une vidéo avant de publier." },
      { status: 400 },
    );
  }
  const basique = g.packages.find((p) => p.tier === "basique")!;

  const gig = await prisma.gig.create({
    data: {
      providerId: userId,
      titre: g.titre,
      description: g.description,
      domaine: g.domaine,
      // Prix et délai « à partir de » = formule Basique : les écrans et calculs qui lisent
      // encore Gig.prix / Gig.delaiJours restent justes.
      prix: basique.prix,
      delaiJours: basique.delaiJours,
      tags: g.tags,
      videoUrl: g.videoUrl || null,
      status: wantsPublish ? "publie" : "brouillon",
      packages: { create: g.packages },
    },
  });

  return NextResponse.json({ id: gig.id, status: gig.status }, { status: 201 });
}
