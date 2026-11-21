import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveAvatar, deleteStoredFile } from "@/lib/storage";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 Mo — une photo de profil, pas un document HD
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Photo de profil — formulaire /profile. Diffusée ensuite via GET /api/users/[id]/avatar
// (bucket "avatars", public aux utilisateurs connectés, contrairement à KYC_BUCKET). Un
// nouvel envoi remplace l'ancienne photo : l'ancien fichier est supprimé du disque après
// écriture du nouveau pour ne pas accumuler les photos abandonnées.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const previous = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });

  const buffer = Buffer.from(await file.arrayBuffer());
  const avatarPath = await saveAvatar({ userId, fileName: file.name, buffer });

  await prisma.user.update({ where: { id: userId }, data: { avatarPath } });

  if (previous?.avatarPath) {
    await deleteStoredFile(previous.avatarPath);
  }

  return NextResponse.json({ avatarUrl: `/api/users/${userId}/avatar` });
}

// Retire la photo de profil (repli sur les initiales).
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const previous = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });
  await prisma.user.update({ where: { id: userId }, data: { avatarPath: null } });
  if (previous?.avatarPath) {
    await deleteStoredFile(previous.avatarPath);
  }

  return NextResponse.json({ ok: true });
}
