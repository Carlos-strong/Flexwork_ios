import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { kycBlockFor } from "@/lib/kyc-policy";
import { gigInputSchema, missingVisual } from "@/lib/gig-rules";
import { serializeGig } from "@/lib/gig-serialize";
import { deleteStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/gigs/[id] — détail d'un Gig. Publié → visible par tout utilisateur connecté ;
// brouillon/cloture → visible uniquement par son propriétaire (le prestataire). Tout autre
// cas → 404 (indistinguable d'un Gig inexistant).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: gigId } = await params;

  const gig = await prisma.gig.findFirst({
    where: {
      id: gigId,
      OR: [{ status: "publie" }, { providerId: userId }],
    },
    include: {
      provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
      packages: true,
      _count: { select: { orders: true } },
    },
  });
  if (!gig) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const view = serializeGig(gig);
  return NextResponse.json({
    ...view,
    prix: view.prixDepart,
    isOwn: gig.providerId === userId,
    ordersCount: gig._count.orders,
    provider: {
      id: gig.provider.id,
      name: [gig.provider.firstname, gig.provider.lastname].filter(Boolean).join(" ").trim() || "Prestataire",
      avatarUrl: gig.provider.avatarPath ? `/api/users/${gig.provider.id}/avatar` : null,
    },
  });
}

const statusOnlySchema = z.object({ status: z.enum(["brouillon", "publie", "cloture"]) }).strict();

// PATCH /api/gigs/[id] (2026-11-08) — le TITULAIRE modifie son Gig ou change son statut.
//
//   - { status } seul : brouillon / clôturé toujours possibles ; publié exige un Gig complet
//     (trois formules + visuel) et l'identité vérifiée ;
//   - Gig complet (mêmes champs que la création) : remplace contenu et formules.
//
// Les commandes déjà passées ne bougent pas : chacune a figé le Gig et sa formule au moment
// de l'achat (GigOrder.termsSnapshot). Refus d'un non-titulaire = 404, comme un Gig absent.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: gigId } = await params;

  const gig = await prisma.gig.findFirst({ where: { id: gigId, providerId: userId }, include: { packages: true } });
  if (!gig) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const statusOnly = statusOnlySchema.safeParse(body);
  const full = statusOnly.success ? null : gigInputSchema.safeParse(body);
  if (!statusOnly.success && !full?.success) {
    const first = full?.error.issues[0];
    return NextResponse.json({ error: "invalid_payload", message: first?.message ?? "Gig incomplet." }, { status: 400 });
  }

  const nextStatus = statusOnly.success ? statusOnly.data.status : (full!.data!.status ?? gig.status);
  if (nextStatus === "publie") {
    const kycBlock = await kycBlockFor(userId, "publier_gig");
    if (kycBlock) return NextResponse.json(kycBlock, { status: 403 });
    const packagesCount = full?.success ? full.data.packages.length : gig.packages.length;
    if (packagesCount !== 3) {
      return NextResponse.json(
        { error: "packages_required", message: "Définissez les trois formules (Basique, Standard, Premium) avant de publier." },
        { status: 400 },
      );
    }
    const videoUrl = full?.success ? (full.data.videoUrl ?? null) : gig.videoUrl;
    if (missingVisual({ imagePaths: gig.imagePaths, videoUrl })) {
      return NextResponse.json(
        { error: "visual_required", message: "Ajoutez au moins une photo ou une vidéo avant de publier." },
        { status: 400 },
      );
    }
  }

  if (statusOnly.success) {
    await prisma.gig.update({ where: { id: gig.id }, data: { status: nextStatus } });
  } else {
    const g = full!.data!;
    const basique = g.packages.find((p) => p.tier === "basique")!;
    await prisma.$transaction([
      prisma.gigPackage.deleteMany({ where: { gigId: gig.id } }),
      prisma.gig.update({
        where: { id: gig.id },
        data: {
          titre: g.titre,
          description: g.description,
          domaine: g.domaine,
          prix: basique.prix,
          delaiJours: basique.delaiJours,
          tags: g.tags,
          videoUrl: g.videoUrl || null,
          status: nextStatus,
          packages: { create: g.packages },
        },
      }),
    ]);
  }

  const updated = await prisma.gig.findUniqueOrThrow({ where: { id: gig.id }, include: { packages: true } });
  return NextResponse.json(serializeGig(updated));
}

// DELETE /api/gigs/[id] (2026-11-08) — le TITULAIRE supprime un service.
//
// Seulement s'il n'a jamais été commandé : les commandes sont rattachées au Gig en cascade
// (GigOrder → Gig, onDelete: Cascade), et supprimer un Gig commandé effacerait contrats,
// signatures et historique de séquestre. Un service commandé se CLÔTURE (il sort du catalogue,
// ses commandes restent). Refus d'un non-titulaire = 404, comme un Gig absent.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: gigId } = await params;

  const gig = await prisma.gig.findFirst({
    where: { id: gigId, providerId: userId },
    select: { id: true, imagePaths: true, _count: { select: { orders: true } } },
  });
  if (!gig) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gig._count.orders > 0) {
    return NextResponse.json(
      {
        error: "gig_has_orders",
        message: "Ce service a déjà été commandé : clôturez-le plutôt. Il sortira du catalogue et ses commandes resteront consultables.",
      },
      { status: 409 },
    );
  }

  await prisma.gig.delete({ where: { id: gig.id } });
  await Promise.all(gig.imagePaths.map((p) => deleteStoredFile(p).catch(() => undefined)));
  return NextResponse.json({ ok: true });
}
