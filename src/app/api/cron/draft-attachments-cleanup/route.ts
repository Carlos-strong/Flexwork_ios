import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

// Purge des pièces jointes de brouillons abandonnés (2026-09-23).
//
// Un tunnel de création commencé puis abandonné laisse des fichiers sur disque ET des lignes
// en base que plus rien ne référencera jamais : le brouillon local du navigateur, lui, expire
// au bout de sept jours (`mission-draft.ts`), et avec lui le `draftId` qui seul permettait de
// les retrouver. Sans cette purge, la fuite est définitive et croît avec l'usage.
//
// Le délai retenu ici est VOLONTAIREMENT plus long que celui du brouillon local : sept jours
// pour le navigateur, trente ici. Purger au même rythme risquerait d'effacer les fichiers
// d'un brouillon encore restaurable ; laisser une marge ne coûte que du disque.
//
// Les pièces jointes converties à la création d'une mission ne sont pas concernées : elles
// ont changé de table (MissionAttachment) et leur ligne de brouillon a été supprimée dans la
// même transaction.
const MAX_AGE_DAYS = 30;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.missionDraftAttachment.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, filePath: true },
  });

  if (stale.length === 0) return NextResponse.json({ deleted: 0, filesRemoved: 0 });

  // Les LIGNES d'abord, en un seul appel : c'est elles qui rendent un fichier atteignable.
  // Si la suppression disque échoue ensuite, il reste un fichier orphelin — inerte, que plus
  // aucune requête ne peut servir — plutôt qu'une ligne pointant vers un fichier disparu, qui
  // ferait échouer toute lecture.
  await prisma.missionDraftAttachment.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });

  let filesRemoved = 0;
  for (const item of stale) {
    try {
      await deleteStoredFile(item.filePath);
      filesRemoved += 1;
    } catch {
      // Fichier déjà absent ou illisible : la ligne est partie, on continue la purge.
    }
  }

  return NextResponse.json({ deleted: stale.length, filesRemoved });
}
