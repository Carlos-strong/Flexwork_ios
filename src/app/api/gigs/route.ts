import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/gigs — catalogue des Gigs publiés (tout utilisateur connecté), ou "Mes Gigs" du
// prestataire connecté avec ?mine=true (rubrique Offres du dashboard : tous statuts, y
// compris brouillons/clôturés, + nombre de commandes par Gig).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const domaine = searchParams.get("domaine");
  const mine = searchParams.get("mine") === "true";

  const gigs = await prisma.gig.findMany({
    where: mine
      ? { providerId: userId }
      : { status: "publie", ...(domaine ? { domaine } : {}) },
    include: {
      provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    items: gigs.map((g) => ({
      id: g.id,
      titre: g.titre,
      description: g.description,
      domaine: g.domaine,
      prix: g.prix,
      currency: g.currency,
      delaiJours: g.delaiJours,
      tags: g.tags,
      status: g.status,
      ordersCount: g._count.orders,
      createdAt: g.createdAt,
      provider: {
        id: g.provider.id,
        name: [g.provider.firstname, g.provider.lastname].filter(Boolean).join(" ").trim() || "Prestataire",
        avatarUrl: g.provider.avatarPath ? `/api/users/${g.provider.id}/avatar` : null,
      },
    })),
  });
}

// POST /api/gigs — un prestataire crée (et publie) un Gig à prix fixe.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  // Un prestataire = tout rôle non-client (expert_digital, expert_btp_autres, artisan,
  // manoeuvre) — même convention que les routes missions.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role === "client") {
    return NextResponse.json({ error: "Seuls les prestataires peuvent publier un Gig" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const titre = typeof body.titre === "string" ? body.titre.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const domaine = typeof body.domaine === "string" ? body.domaine.trim() : "";
  const prix = typeof body.prix === "number" ? body.prix : Number(body.prix);
  const delaiJours = typeof body.delaiJours === "number" ? body.delaiJours : Number(body.delaiJours);
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  const status = body.status === "publie" ? "publie" : "brouillon";

  if (!titre || !description || !domaine || !Number.isFinite(prix) || prix <= 0 || !Number.isInteger(delaiJours) || delaiJours <= 0) {
    return NextResponse.json({ error: "titre, description, domaine, prix (>0) et delaiJours (>0) sont requis" }, { status: 400 });
  }

  const gig = await prisma.gig.create({
    data: {
      providerId: userId,
      titre,
      description,
      domaine,
      prix,
      delaiJours,
      tags,
      status,
    },
  });

  return NextResponse.json({ id: gig.id, status: gig.status }, { status: 201 });
}
