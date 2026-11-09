import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { deleteStoredFile, saveGigImage } from "@/lib/storage";
import { GIG_IMAGES_MAX, GIG_IMAGE_MAX_BYTES, GIG_IMAGE_TYPES } from "@/lib/gig-rules";
import { gigImageUrl } from "@/lib/gig-serialize";
import { ownGigForImages } from "@/lib/gig-images";

export const dynamic = "force-dynamic";

// Photos d'un service (2026-11-08) — 3 au plus, la première sert de couverture et toutes
// défilent en carrousel sur les cartes. Réservé au TITULAIRE (404 sinon, comme un Gig absent).

const urls = (g: { id: string; imagePaths: string[]; updatedAt: Date }) => g.imagePaths.map((_, i) => gigImageUrl(g.id, i, g.updatedAt));

// POST : ajoute une photo en fin de série — JPG, PNG ou WEBP, 5 Mo maximum.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const owned = await ownGigForImages((await params).id);
  if ("error" in owned) return owned.error;
  if (owned.gig.imagePaths.length >= GIG_IMAGES_MAX) {
    return NextResponse.json(
      { error: "too_many_images", message: `${GIG_IMAGES_MAX} photos maximum par service : retirez-en une d'abord.` },
      { status: 409 },
    );
  }

  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const ext = GIG_IMAGE_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "unsupported_file_type", message: "Photo JPG, PNG ou WEBP uniquement." }, { status: 400 });
  if (file.size > GIG_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", message: "Photo de 5 Mo maximum." }, { status: 413 });
  }

  const relPath = await saveGigImage({ gigId: owned.gig.id, fileName: `photo${ext}`, buffer: Buffer.from(await file.arrayBuffer()) });
  // Ajout CONDITIONNEL, en une instruction : deux envois simultanés ne peuvent pas dépasser la
  // limite (la vérification plus haut n'est qu'un refus rapide).
  const added = await prisma.$executeRaw`
    UPDATE "Gig" SET "imagePaths" = array_append("imagePaths", ${relPath}), "updatedAt" = NOW()
    WHERE "id" = ${owned.gig.id} AND cardinality("imagePaths") < ${GIG_IMAGES_MAX}`;
  if (added === 0) {
    await deleteStoredFile(relPath).catch(() => undefined);
    return NextResponse.json({ error: "too_many_images", message: `${GIG_IMAGES_MAX} photos maximum par service.` }, { status: 409 });
  }
  const fresh = await prisma.gig.findUniqueOrThrow({ where: { id: owned.gig.id }, select: { id: true, imagePaths: true, updatedAt: true } });
  return NextResponse.json({ images: urls(fresh) }, { status: 201 });
}

const orderSchema = z.object({ order: z.array(z.number().int().min(0)).min(1).max(GIG_IMAGES_MAX) }).strict();

// PATCH { order: [2, 0, 1] } : réordonne les photos (la première devient la couverture).
// L'ordre doit être une permutation exacte des photos existantes.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const owned = await ownGigForImages((await params).id);
  if ("error" in owned) return owned.error;
  const parsed = orderSchema.safeParse(await req.json().catch(() => null));
  const n = owned.gig.imagePaths.length;
  const order = parsed.success ? parsed.data.order : [];
  const isPermutation = order.length === n && new Set(order).size === n && order.every((i) => i < n);
  if (!isPermutation) return NextResponse.json({ error: "invalid_order" }, { status: 400 });

  const updated = await prisma.gig.update({
    where: { id: owned.gig.id },
    data: { imagePaths: order.map((i) => owned.gig.imagePaths[i]) },
  });
  return NextResponse.json({ images: urls(updated) });
}
