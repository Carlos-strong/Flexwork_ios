import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionAttachment, signPrivateFileToken, getStoredFileSize } from "@/lib/storage";
import { CONSTAT_CATEGORIES, isConstatCategory, isConstatTextOnly } from "@/lib/constat";

// Preuves de CONSTAT du CLIENT (maquette Flexwork-Modal-Client-Validation-Preuve.html,
// « Vos preuves de constat ») — pendant CLIENT de POST/GET .../deliverable : mêmes 4
// catégories (photo/vidéo/document/géoloc), même stockage signé, mais préfixées `constat_`
// pour ne jamais se mélanger aux preuves du prestataire (voir src/lib/constat.ts).
//
// Écriture réservée au CLIENT du contrat (c'est SON constat) ; lecture ouverte aux deux
// parties — le prestataire doit pouvoir voir sur quoi le client s'est appuyé pour constater
// un taux, sinon un constat contradictoire reste invérifiable de son côté.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, OR: [{ clientId: userId }, { providerId: userId }] },
    include: { jalons: { select: { id: true } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (contract.clientId !== userId) {
    // Partie au contrat mais pas le client : le constat est une observation du client.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const rawCategory = formData.get("category");
  if (typeof rawCategory !== "string" || !isConstatCategory(rawCategory)) {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }
  const category = rawCategory;
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim() ? rawNote.trim() : null;
  // Constat scopé à un jalon précis (contrat fractionné) ou à la mission entière (null) —
  // même découpage que les preuves du prestataire.
  const rawJalonId = formData.get("jalonId");
  const jalonId = typeof rawJalonId === "string" && rawJalonId.trim() ? rawJalonId.trim() : null;
  if (jalonId && !contract.jalons.some((j) => j.id === jalonId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const file = formData.get("file");
  if (isConstatTextOnly(category)) {
    if (!note) {
      return NextResponse.json({ error: "note_required" }, { status: 400 });
    }
  } else if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  let filePath = "";
  if (file instanceof File) {
    const buffer = Buffer.from(await file.arrayBuffer());
    filePath = await saveMissionAttachment({ missionId, fileName: file.name, buffer });
  } else {
    // Ligne texte sans fichier réel — même convention que POST .../deliverable.
    filePath = `__no_file__/${Date.now()}`;
  }

  const attachment = await prisma.missionAttachment.create({
    data: {
      missionId,
      jalonId,
      uploaderId: userId,
      filePath,
      category,
      note,
      mimeType: file instanceof File ? file.type || null : null,
    },
  });

  return NextResponse.json({ id: attachment.id, category: attachment.category });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, OR: [{ clientId: userId }, { providerId: userId }] },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ?jalonId=<id> pour le constat d'un jalon précis ; absent = constat de la mission entière.
  const rawJalonId = new URL(req.url).searchParams.get("jalonId");
  const jalonId = rawJalonId && rawJalonId.trim() ? rawJalonId.trim() : null;

  const attachments = await prisma.missionAttachment.findMany({
    where: { missionId, jalonId, category: { in: [...CONSTAT_CATEGORIES] } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: await Promise.all(attachments.map(async (a) => {
      const hasFile = !a.filePath.startsWith("__no_file__/");
      return {
        id: a.id,
        category: a.category,
        note: a.note,
        fileName: hasFile ? a.filePath.split("/").pop() : null,
        mimeType: a.mimeType,
        createdAt: a.createdAt,
        size: hasFile ? await getStoredFileSize(a.filePath) : null,
        url: hasFile ? `/api/files/${signPrivateFileToken("mission_attachment", a.id)}` : null,
      };
    })),
  });
}
