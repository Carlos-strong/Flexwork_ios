import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { deleteStoredFile, readStoredFile } from "@/lib/storage";
import { gigImageUrl } from "@/lib/gig-serialize";
import { gigImagesVisibility, ownGigForImages } from "@/lib/gig-images";

export const dynamic = "force-dynamic";

const CONTENT_TYPE_BY_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function parseIndex(raw: string): number | null {
  return /^[0-2]$/.test(raw) ? Number(raw) : null;
}

// GET : une photo d'un service. Publique si le service l'est (publié, prestataire listé) ;
// sinon réservée au titulaire. Refus = 404, comme une photo absente.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; index: string }> }): Promise<NextResponse> {
  const { id, index: raw } = await params;
  const index = parseIndex(raw);
  const vis = index === null ? null : await gigImagesVisibility(id);
  const relPath = vis && index !== null ? vis.imagePaths[index] : undefined;
  if (!vis || !relPath) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!vis.isPublic) {
    const session = await auth();
    if ((session?.user as { id?: string } | undefined)?.id !== vis.providerId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }
  const buffer = await readStoredFile(relPath).catch(() => null);
  if (!buffer) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": CONTENT_TYPE_BY_EXT[path.extname(relPath).toLowerCase()] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      // Publique : réutilisable (l'URL porte `?v=` et change à chaque modification). Sinon privée.
      "Cache-Control": vis.isPublic ? "public, max-age=86400" : "private, no-store",
    },
  });
}

// DELETE : le titulaire retire une photo. Un service PUBLIÉ sans vidéo garde au moins une photo.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; index: string }> }): Promise<NextResponse> {
  const { id, index: raw } = await params;
  const owned = await ownGigForImages(id);
  if ("error" in owned) return owned.error;
  const index = parseIndex(raw);
  const relPath = index === null ? undefined : owned.gig.imagePaths[index];
  if (index === null || !relPath) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (owned.gig.status === "publie" && !owned.gig.videoUrl && owned.gig.imagePaths.length === 1) {
    return NextResponse.json(
      { error: "visual_required", message: "Un service en ligne garde au moins une photo : ajoutez-en une autre ou une vidéo d'abord." },
      { status: 409 },
    );
  }
  const updated = await prisma.gig.update({
    where: { id: owned.gig.id },
    data: { imagePaths: owned.gig.imagePaths.filter((_, i) => i !== index) },
  });
  await deleteStoredFile(relPath).catch(() => undefined);
  return NextResponse.json({ images: updated.imagePaths.map((_, i) => gigImageUrl(updated.id, i, updated.updatedAt)) });
}
