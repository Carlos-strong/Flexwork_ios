import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionDraftAttachment, deleteStoredFile, signPrivateFileToken } from "@/lib/storage";

// Pièces jointes déposées AVANT la création de la mission (2026-09-23) — cahier des charges,
// plans, photos, joints dès la première étape du tunnel.
//
// Pourquoi une route de plus : POST /api/missions/[id]/attachments exige une mission
// existante ET un statut postérieur à l'acceptation d'un devis (`canAttachLivrable`, règle
// anti-travail-test gratuit US-1302). Elle ne peut donc pas recevoir un cahier des charges,
// qui est justement ce qu'on montre AVANT que quiconque candidate.
//
// ⚠️ `draftId` vient du navigateur : il n'authentifie personne et n'est jamais utilisé seul.
// Toute requête est filtrée sur `uploaderId` tiré de la session — un identifiant de brouillon
// deviné ne donne accès à rien.

export const dynamic = "force-dynamic";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo, aligné sur l'annonce faite à l'utilisateur
const MAX_FILES_PER_DRAFT = 10;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

function serialize(a: { id: string; fileName: string; mimeType: string; size: number }) {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    size: a.size,
    // Même mécanique que les autres fichiers privés : URL signée à durée limitée, jamais un
    // chemin de stockage exposé au client.
    url: `/api/files/${signPrivateFileToken("mission_draft_attachment", a.id)}`,
  };
}

/** GET /api/missions/attachments/draft?draftId=xxx — les pièces jointes de CE brouillon. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;

  const draftId = req.nextUrl.searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const items = await prisma.missionDraftAttachment.findMany({
    where: { draftId, uploaderId: userId },
    select: { id: true, fileName: true, mimeType: true, size: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ items: items.map(serialize) });
}

/** POST /api/missions/attachments/draft — multipart { draftId, file }. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const draftId = formData?.get("draftId");
  if (!(file instanceof File) || typeof draftId !== "string" || !draftId) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  // Plafond par brouillon : sans lui, un dépôt en boucle remplirait le disque avant même
  // qu'une mission existe, et donc sans qu'aucune modération ne puisse s'en saisir.
  const existing = await prisma.missionDraftAttachment.count({ where: { draftId, uploaderId: userId } });
  if (existing >= MAX_FILES_PER_DRAFT) {
    return NextResponse.json({ error: "too_many_files" }, { status: 409 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveMissionDraftAttachment({ userId, fileName: file.name, buffer });

  const created = await prisma.missionDraftAttachment.create({
    data: { draftId, uploaderId: userId, filePath, fileName: file.name, mimeType: file.type, size: file.size },
    select: { id: true, fileName: true, mimeType: true, size: true },
  });
  return NextResponse.json(serialize(created), { status: 201 });
}

/** DELETE /api/missions/attachments/draft — { id }. */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // `deleteMany` filtré sur l'uploader : une pièce jointe appartenant à quelqu'un d'autre ne
  // correspond à rien et donne 404, sans révéler qu'elle existe.
  const attachment = await prisma.missionDraftAttachment.findFirst({ where: { id, uploaderId: userId } });
  if (!attachment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.missionDraftAttachment.delete({ where: { id: attachment.id } });
  // Le fichier part avec la ligne : un brouillon abandonné ne doit pas laisser d'orphelin.
  await deleteStoredFile(attachment.filePath).catch(() => {});

  return NextResponse.json({ ok: true });
}
