import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionAttachment, signPrivateFileToken, getStoredFileSize } from "@/lib/storage";
import { canSubmitDeliverable } from "@/lib/attachments";
import { CONSTAT_CATEGORIES } from "@/lib/constat";

const VALID_CATEGORIES = ["photo", "video", "document", "geolocation", "other"];

// Preuves du livrable de la mission ENTIÈRE (jalonId: null) — pendant, au niveau mission, de
// POST/GET /api/missions/[id]/jalons/[jalonId]/deliverable pour un contrat SANS jalon. Même
// vue "Gestion des livrables — Mode Freelance" (5 catégories), même triptyque
// accumulation → liste → soumission explicite (voir .../deliverable/submit) : plusieurs
// preuves de catégories différentes s'accumulent ici avant l'envoi définitif, l'upload seul
// ne bascule plus le statut de la mission (comportement historique, avant 2026-09-02, où un
// seul fichier suffisait et passait directement `livrable_soumis` — repris par la vue
// catégorisée, déjà en place pour le cas jalons, pour que les deux modes se comportent et se
// présentent de façon identique).
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
    include: { mission: true, jalons: { select: { id: true } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (contract.providerId !== userId) {
    // Partie au contrat mais pas le prestataire : action réservée au prestataire.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Paiement fractionné (2026-08-06) : le livrable se soumet jalon par jalon via
  // POST /api/missions/[id]/jalons/[jalonId]/deliverable.
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_deliverable" }, { status: 409 });
  }
  // canSubmitDeliverable et non canAttachLivrable (A-2) : la soumission du livrable final
  // exige les fonds sous séquestre — pas seulement un contrat signé.
  if (!canSubmitDeliverable(contract.mission.status)) {
    return NextResponse.json({ error: "mission_not_ready" }, { status: 409 });
  }
  // "livrable_soumis" reste soumettable (validation PARTIELLE en cours, voir POST
  // .../checkpoint) tant que la barre des 100% constatés n'est pas atteinte — au-delà, place
  // à la clôture (validation finale ou rejet), pas à de nouvelles preuves (signalé 2026-09-04).
  if (contract.mission.status === "livrable_soumis" && contract.mission.observedProgress >= 100) {
    return NextResponse.json({ error: "review_complete" }, { status: 409 });
  }

  const formData = await req.formData();
  const rawCategory = formData.get("category");
  const category = typeof rawCategory === "string" && VALID_CATEGORIES.includes(rawCategory) ? rawCategory : "document";
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim() ? rawNote.trim() : null;
  const file = formData.get("file");

  // Géolocalisation (coordonnées réelles via navigator.geolocation côté client) et "Autres
  // preuves" (note libre) sont des catégories texte : pas de fichier requis, l'information
  // vit dans `note`. Les 3 autres catégories exigent un vrai fichier — même règle que
  // jalons/[jalonId]/deliverable.
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
    // Ligne texte sans fichier réel — préfixe reconnu par GET ci-dessous pour ne jamais
    // proposer de lien de téléchargement vers un fichier qui n'existe pas.
    filePath = `__no_file__/${Date.now()}`;
  }

  const attachment = await prisma.missionAttachment.create({
    data: { missionId, jalonId: null, uploaderId: userId, filePath, category, note, mimeType: file instanceof File ? file.type || null : null },
  });

  return NextResponse.json({ id: attachment.id, category: attachment.category });
}

// Preuves accumulées pour le livrable de la mission entière (jalonId: null) — alimente la
// vue prestataire avant soumission. Même restriction d'accès que
// GET /api/missions/[id]/jalons/[jalonId]/attachments (client ou prestataire du contrat).
export async function GET(
  _req: Request,
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

  // Les preuves de CONSTAT du client (catégories `constat_*`, voir src/lib/constat.ts)
  // partagent cette table mais n'appartiennent PAS au livrable du prestataire : elles sont
  // exclues ici, sans quoi elles apparaîtraient dans son lot courant et fausseraient le
  // décompte « N preuves » comme la garde `no_proof_attached` de la soumission.
  const attachments = await prisma.missionAttachment.findMany({
    where: { missionId, jalonId: null, NOT: { category: { in: [...CONSTAT_CATEGORIES] } } },
    orderBy: { createdAt: "asc" },
  });

  // Dernier motif de rejet (contrat sans jalon) — symétrique à Jalon.rejectionReason, mais
  // stocké en MissionNotification faute de champ dédié sur Mission (voir
  // POST .../escrow/reject). N'a de sens à afficher que si la mission a été rejetée après
  // ce point — un rejet plus ancien qu'une resoumission entre-temps ne doit pas induire en
  // erreur, d'où la comparaison de date ci-dessous.
  const lastRejection = await prisma.missionNotification.findFirst({
    where: { missionId, type: "deliverable_rejected" },
    orderBy: { createdAt: "desc" },
  });
  const lastRejectionIsStale =
    !!lastRejection && attachments.some((a) => a.createdAt > lastRejection.createdAt);

  return NextResponse.json({
    lastRejectionReason: lastRejection && !lastRejectionIsStale ? lastRejection.message : null,
    items: await Promise.all(attachments.map(async (a) => {
      const hasRealFile = !a.filePath.startsWith("__no_file__/");
      return {
        id: a.id,
        category: a.category ?? "document",
        note: a.note,
        fileName: hasRealFile ? a.filePath.split("/").pop() : null,
        mimeType: a.mimeType,
        createdAt: a.createdAt,
        // Taille réelle du fichier stocké — affichée sur la vignette de chaque preuve
        // (maquettes de soumission/validation 2026-09-08). null pour les preuves
        // texte-seules (géolocalisation, "autres preuves" sans fichier).
        size: hasRealFile ? await getStoredFileSize(a.filePath) : null,
        url: hasRealFile ? `/api/files/${signPrivateFileToken("mission_attachment", a.id)}` : null,
        // Appréciation du client par preuve (2026-09-05) — consommée par ValidationClientView.
        appreciation: a.appreciation,
        rejectionReason: a.rejectionReason,
        rejectionMotif: a.rejectionMotif,
        requestNewProof: a.requestNewProof,
        appreciatedAt: a.appreciatedAt,
      };
    })),
  });
}
