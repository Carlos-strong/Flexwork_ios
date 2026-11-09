import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayFileName, getStoredFileSize } from "@/lib/storage";
import { KYC_DOC_TYPES } from "@/lib/kyc-status";

// Documents KYC déjà déposés par l'utilisateur connecté — utilisé par /kyc pour reprendre
// la bonne étape et afficher les vrais fichiers déjà envoyés au lieu de repartir de zéro à
// chaque rechargement de page (l'état précédent n'était que côté client, perdu au refresh).
//
// ⚠️ Filtré sur les 4 types d'IDENTITÉ (2026-09-23) : cet endpoint sert le parcours
// d'identité, et depuis l'ajout du dossier financier, `KycDocument` porte aussi le
// justificatif de domicile. Le renvoyer ici ferait apparaître une pièce hors parcours dans
// l'assistant — et le remonterait à la première étape si elle était rejetée.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const docs = await prisma.kycDocument.findMany({
    where: { userId, type: { in: [...KYC_DOC_TYPES] } },
    orderBy: { createdAt: "desc" },
  });

  // Un type peut avoir plusieurs lignes après un rejet + renvoi — on ne garde que la plus
  // récente par type (déjà trié desc ci-dessus, donc le premier rencontré par type gagne).
  const latestByType = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    if (!latestByType.has(doc.type)) latestByType.set(doc.type, doc);
  }

  const documents = await Promise.all(
    [...latestByType.values()].map(async (doc) => ({
      type: doc.type,
      fileName: displayFileName(doc.filePath),
      size: await getStoredFileSize(doc.filePath),
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      createdAt: doc.createdAt,
    }))
  );

  return NextResponse.json({ documents });
}
