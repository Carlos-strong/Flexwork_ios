import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readStoredFile, displayFileName } from "@/lib/storage";

// Sert une photo de chantier ou un CV du portfolio d'un prestataire — visible par tout
// utilisateur authentifié (donnée déclarée, comme les documents de déclaration §5). URL
// STABLE (pas de token signé qui expire en 5 min : le portfolio doit rester affiché) : le
// relPath est généré par le serveur au moment de l'upload (« portfolio/<userId>/<uuid>-<nom> »),
// on valide strictement cette forme pour exclure tout path traversal.
const SAFE_REL_PATH = /^portfolio\/[^/]+\/[^/]+$/;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const relPath = new URL(req.url).searchParams.get("p");
  if (!relPath || !SAFE_REL_PATH.test(relPath)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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
    },
  });
}
