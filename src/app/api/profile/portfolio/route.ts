import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePortfolioFile } from "@/lib/storage";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 Mo
const MAX_CV_BYTES = 10 * 1024 * 1024; // 10 Mo
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Upload d'un élément de portfolio (photo de chantier) ou d'un CV — formulaire /profile.
// Chaque fichier est sauvegardé dans le bucket "portfolio" et référencé par son relPath
// dans Profile.portfolioUrls (photos) ou Profile.cvUrl (CV), servi ensuite via
// /api/files/[token] (kind "portfolio", visible par tout utilisateur authentifié).
// L'association au profil (portfolioUrls/cvUrl) est faite par le client au moment de
// l'enregistrement du profil (POST /api/profile) — cette route ne fait que stocker le
// fichier et retourner son relPath.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const kind = formData.get("kind");
  const file = formData.get("file");
  if ((kind !== "photo" && kind !== "cv") || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (kind === "photo") {
    if (!PHOTO_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
  } else {
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
    }
    if (file.size > MAX_CV_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const relPath = await savePortfolioFile({ userId, fileName: file.name, buffer });

  return NextResponse.json({ relPath, kind });
}
