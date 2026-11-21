import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireContractByMission } from "@/lib/resource-guard";
import { heldBalance } from "@/lib/escrow";
import { afterInstructionCommitted } from "@/lib/psp/dispatch";
import { randomUUID } from "crypto";
import { canOpenMediationAtStatus } from "@/lib/mediation-rules";

const schema = z.object({ reason: z.string().min(5) });

// US-601 (Phase 6) : ouvre une médiation — gèle les fonds chez le PSP, ne tranche rien.
// Remplace intégralement l'ancien Litige à arbitrage opposable.
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

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const contract = await prisma.prestationContract.findUnique({ where: { missionId }, include: { mission: true } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Une médiation n'a de sens que sur une mission ENGAGÉE et encore en cours : il faut des fonds
  // à geler et un différend à trancher. Avant cette garde, elle était ouvrable sur une mission
  // simplement publiée (rien à geler) comme sur une mission déjà clôturée (tout est payé) — et
  // dans les deux cas elle écrasait le statut sans retour possible.
  // Statuts recevables : src/lib/mediation-rules.ts, partagés avec le bandeau de suivi qui
  // propose d'ouvrir la médiation.
  if (!canOpenMediationAtStatus(contract.mission.status)) {
    return NextResponse.json({ error: "mission_not_mediable" }, { status: 409 });
  }
  // Une seule médiation ouverte à la fois : deux en parallèle mémoriseraient deux statuts
  // « précédents » et se marcheraient dessus à la clôture.
  const alreadyOpen = await prisma.mediation.findFirst({
    where: { contractId: contract.id, outcome: "en_cours" },
    select: { id: true },
  });
  if (alreadyOpen) {
    return NextResponse.json({ error: "mediation_already_open" }, { status: 409 });
  }

  // Geler ce qui est RÉELLEMENT séquestré, pas le budget publié : le prix contracté peut en
  // différer (contre-proposition acceptée), et une partie a pu être libérée au fil des jalons.
  const held = await heldBalance(contract.id);

  const mediation = await prisma.$transaction(async (tx) => {
    const created = await tx.mediation.create({
      data: {
        contractId: contract.id,
        openedById: userId,
        reason: parsed.data.reason,
        previousStatus: contract.mission.status,
      },
    });
    await tx.mission.update({ where: { id: missionId }, data: { status: "mediation_ouverte" } });
    // Rien sous séquestre : aucune instruction de gel à transmettre (0 n'est pas une
    // instruction valide). La médiation reste ouverte — le différend peut être non financier.
    const freeze =
      held > 0
        ? await tx.pspEscrowOperation.create({
            data: {
              contractId: contract.id,
              pspName: process.env.PSP_NAME ?? "fedapay",
              pspReference: `freeze_${randomUUID()}`,
              amount: held,
              currency: contract.mission.currency,
              instructionType: "freeze",
            },
          })
        : null;
    return { created, freeze };
  });
  // Transmission au PSP hors transaction (outbox) — jusqu'ici ce gel était écrit sans jamais être
  // transmis : en développement il restait `pending` faute d'autoconfirmation.
  if (mediation.freeze) await afterInstructionCommitted(mediation.freeze);

  return NextResponse.json(mediation.created);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: missionId } = await params;

  // F-01 étendu : les médiations d'une mission ne sont lisibles que par ses deux parties.
  const guard = await requireContractByMission(missionId, userId);
  if (!guard.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mediations = await prisma.mediation.findMany({
    where: { contractId: guard.contract.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items: mediations });
}
