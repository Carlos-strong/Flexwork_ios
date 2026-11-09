import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readStoredFile, displayFileName } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { canViewProfile, loadVisibilityTarget } from "@/lib/profile-visibility";

// Sert une photo de chantier ou un CV du portfolio d'un prestataire — visible par tout
// utilisateur authentifié (donnée déclarée, comme les documents de déclaration §5). URL
// STABLE (pas de token signé qui expire en 5 min : le portfolio doit rester affiché) : le
// relPath est généré par le serveur au moment de l'upload (« portfolio/<userId>/<uuid>-<nom> »),
// on valide strictement cette forme pour exclure tout path traversal.
//
// Contrôle d'accès (2026-11-08) — un chemin valide ne suffit plus :
//   - le titulaire voit ses propres fichiers ;
//   - les autres, seulement un fichier ENCORE publié sur le profil (portfolioUrls ou cvUrl) —
//     un fichier retiré par son auteur cesse d'être servi —, et seulement si le profil leur
//     est visible (src/lib/profile-visibility.ts).
// Refus = 404, comme un fichier absent : la route ne dit pas ce qui existe.
const SAFE_REL_PATH = /^portfolio\/([^/]+)\/[^/]+$/;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const relPath = new URL(req.url).searchParams.get("p");
  const match = relPath ? SAFE_REL_PATH.exec(relPath) : null;
  if (!relPath || !match) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ownerId = match[1];
  const viewer = {
    id: (session.user as { id: string }).id,
    isAdmin: (session.user as { isAdmin?: boolean }).isAdmin === true,
  };
  if (viewer.id !== ownerId) {
    const published = await prisma.profile.findFirst({
      where: { userId: ownerId, OR: [{ portfolioUrls: { has: relPath } }, { cvUrl: relPath }] },
      select: { id: true },
    });
    if (!published || !(await canViewProfile(viewer, await loadVisibilityTarget(ownerId)))) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  let buffer: Buffer;
  try {
    buffer = await readStoredFile(relPath);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ext = path.extname(relPath).toLowerCase();
  const imageTypes = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const contentType = imageTypes.includes(ext)
    ? `image/${ext.slice(1) === "jpg" ? "jpeg" : ext.slice(1)}`
    : ext === ".pdf"
    ? "application/pdf"
    : "application/octet-stream";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(displayFileName(relPath))}"`,
      // Le type déclaré fait foi : le navigateur ne doit pas « deviner » un HTML dans un fichier
      // téléversé. Réponse liée à la session : jamais en cache partagé.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
