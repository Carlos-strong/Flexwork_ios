import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Trace que le CLIENT a ouvert/consulté le livrable soumis d'un jalon — règle de
// synchronisation prestataire/client (mission-history-table.tsx) : « Client ouvre la
// validation » fait passer le Statut du tableau "Validation" côté client de "En attente" à
// "En cours", sans rien changer côté tableau "Soumission" prestataire (qui reste "Envoyé").
// Idempotent : n'écrit qu'une fois par tour de soumission (reviewOpenedAt déjà posé, ou
// jalon pas dans l'état `livrable_soumis` → no-op silencieux, jamais d'erreur bloquante pour
// un simple appel de consultation). `reviewOpenedAt` est remis à null par POST .../submit à
// chaque nouveau tour (voir ce fichier).
export async function POST(
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
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (jalon.status !== "livrable_soumis" || jalon.reviewOpenedAt) {
    return NextResponse.json({ reviewOpenedAt: jalon.reviewOpenedAt });
  }

  const updated = await prisma.jalon.update({
    where: { id: jalonId },
    data: { reviewOpenedAt: new Date() },
  });

  return NextResponse.json({ reviewOpenedAt: updated.reviewOpenedAt });
}
