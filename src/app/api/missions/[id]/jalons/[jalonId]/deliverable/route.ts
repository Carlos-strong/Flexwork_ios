import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionAttachment } from "@/lib/storage";
import { canSubmitJalonDeliverable } from "@/lib/jalons";

const VALID_CATEGORIES = ["photo", "video", "document", "geolocation", "other"];

// Version scopée-jalon de POST /api/missions/[id]/deliverable (US-504 côté soumission) —
// le prestataire ajoute une preuve pour UN jalon financé. Plusieurs preuves de catégories
// différentes (photo/vidéo/document/géolocalisation/autre) peuvent s'accumuler ici avant
// l'envoi définitif — POST .../submit fait ensuite passer le jalon (pas la mission entière)
// en `livrable_soumis` explicitement (l'upload seul ne bascule plus le statut, contrairement
// au comportement historique — voir plan « Livrables »).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || contract.providerId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 403 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canSubmitJalonDeliverable(jalon.status, jalon.observedProgress)) {
    return NextResponse.json({ error: "jalon_not_ready" }, { status: 409 });
  }

  const formData = await req.formData();
  const rawCategory = formData.get("category");
  const category = typeof rawCategory === "string" && VALID_CATEGORIES.includes(rawCategory) ? rawCategory : "document";
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim() ? rawNote.trim() : null;
  const file = formData.get("file");

  // Géolocalisation (coordonnées réelles via navigator.geolocation côté client) et "Autres
  // preuves" (note libre, comme la maquette) sont des catégories texte : pas de fichier
  // requis, l'information vit dans `note`. Les 3 autres catégories exigent un vrai fichier.
  const isTextOnly = category === "geolocation" || category === "other";
  if (isTextOnly) {
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
    // Ligne texte sans fichier réel — préfixe reconnu par GET .../attachments pour ne jamais
    // proposer de lien de téléchargement vers un fichier qui n'existe pas.
    filePath = `__no_file__/${Date.now()}`;
  }

  const attachment = await prisma.missionAttachment.create({
    data: { missionId, jalonId: jalon.id, uploaderId: userId, filePath, category, note, mimeType: file instanceof File ? file.type || null : null },
  });

  return NextResponse.json({ id: attachment.id, category: attachment.category });
}
