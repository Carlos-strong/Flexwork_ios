import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ACCEPTED_PROPOSAL_STATUSES } from "@/lib/review-rules";

const schema = z.object({ acknowledgementType: z.enum(["no_insurance", "unverified_qualification"]) });

// US-404 (Phase 4) : avertissement explicite avant de retenir un prestataire sans
// assurance déclarée (risque moyen/élevé). Le consentement est horodaté et conservé —
// il documente un choix éclairé, il ne rend jamais la plateforme garante.
// La proposition « retenue » couvre les DEUX statuts (acceptee prix fixe/taux, devis_valide
// mode devis) — avant ce correctif, l'accusé de réception échouait en 409
// no_accepted_proposal sur une mission à devis (même famille que le ciblage des avis).
const ACK_TEXT: Record<"no_insurance" | "unverified_qualification", string> = {
  no_insurance:
    "Ce prestataire n'a déclaré aucune assurance de responsabilité civile professionnelle. " +
    "En cas de dommage pendant les travaux, aucune indemnisation par une assurance ne sera " +
    "possible. Le recours éventuel serait à exercer directement contre le prestataire.",
  unverified_qualification:
    "Les qualifications de ce prestataire sont déclarées, non vérifiées par Flexwork.",
};

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

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { proposals: { where: { status: { in: [...ACCEPTED_PROPOSAL_STATUSES] } } } },
  });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const providerId = mission.proposals[0]?.providerId;
  if (!providerId) {
    return NextResponse.json({ error: "no_accepted_proposal" }, { status: 409 });
  }

  const ack = await prisma.clientAcknowledgement.create({
    data: {
      clientId: userId,
      missionId,
      acknowledgementType: parsed.data.acknowledgementType,
      textSnapshot: ACK_TEXT[parsed.data.acknowledgementType],
      ipAddress: req.headers.get("x-forwarded-for"),
    },
  });

  return NextResponse.json(ack);
}
