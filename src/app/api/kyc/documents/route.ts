import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayFileName, getStoredFileSize } from "@/lib/storage";

// Documents KYC déjà déposés par l'utilisateur connecté — utilisé par /kyc pour reprendre
// la bonne étape et afficher les vrais fichiers déjà envoyés au lieu de repartir de zéro à
// chaque rechargement de page (l'état précédent n'était que côté client, perdu au refresh).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const docs = await prisma.kycDocument.findMany({
    where: { userId },
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
