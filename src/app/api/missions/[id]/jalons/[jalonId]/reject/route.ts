import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canDecideJalon } from "@/lib/jalons";

const schema = z.object({ rejectionReason: z.string().min(1) });

// "Révision(N)" dans principeclient.md — le client rejette le livrable d'un jalon avec un
// motif obligatoire ; le jalon repasse à `fonds_sous_sequestre` (les fonds restent au
// séquestre, aucune instruction PSP n'est transmise ici) pour que le prestataire resoumette.
// `revisionCount` incrémenté à chaque rejet, affiché tel quel côté UI (pas de plafond
// codé en dur — aucune règle de ce type n'est documentée dans le catalogue de user stories).
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
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canDecideJalon(jalon.status)) {
    return NextResponse.json({ error: "no_deliverable_submitted" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "rejection_reason_required" }, { status: 400 });
  }

  const updated = await prisma.jalon.update({
    where: { id: jalonId },
    data: {
      status: "rejete",
      rejectionReason: parsed.data.rejectionReason,
      revisionCount: { increment: 1 },
    },
  });

  return NextResponse.json({ status: updated.status, revisionCount: updated.revisionCount });
}
