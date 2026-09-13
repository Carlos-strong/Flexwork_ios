import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { signPrivateFileToken, getStoredFileSize } from "@/lib/storage";
import { CONSTAT_CATEGORIES } from "@/lib/constat";

// Preuves d'UN jalon, groupées par catégorie (photo/video/document/geolocation/other) —
// alimente à la fois la vue prestataire (deliverable/page.tsx, avant soumission) et la vue
// client (escrow/page.tsx, après soumission) : même restriction d'accès que
// GET /api/missions/[id]/attachments (client ou prestataire du contrat).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Preuves de CONSTAT du client exclues — voir GET .../deliverable pour le rationale.
  const attachments = await prisma.missionAttachment.findMany({
    where: { jalonId, NOT: { category: { in: [...CONSTAT_CATEGORIES] } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: await Promise.all(attachments.map(async (a) => {
      // Préfixe posé par POST .../deliverable pour les preuves texte-seules (géolocalisation,
      // "autres preuves" sans fichier) — aucun fichier réel n'existe à ce chemin.
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
