import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { kycBlockFor } from "@/lib/kyc-policy";
import { notifyRetained, retainProposal } from "@/lib/accept-proposal";

// Le client valide le devis d'une proposition en négociation → "devis_valide".
// Les autres propositions encore ouvertes sont refusées (même règle que l'acceptation
// classique) ; la génération de contrat (POST /api/missions/[id]/contract) accepte
// ensuite ce statut.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, proposalId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const proposal = await prisma.missionProposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.missionId !== missionId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Valider un devis retient le prestataire : identité vérifiée exigée (src/lib/kyc-policy.ts).
  // Après la propriété de la mission (2026-11-10) : celle d'un autre reste 404, pas 403 KYC.
  const kycBlock = await kycBlockFor(userId, "contractualiser");
  if (kycBlock) {
    return NextResponse.json(kycBlock, { status: 403 });
  }
  if (proposal.status !== "en_negociation") {
    return NextResponse.json({ error: "not_in_negotiation" }, { status: 409 });
  }
  if (!proposal.devisData) {
    return NextResponse.json({ error: "no_devis" }, { status: 409 });
  }

  // Valider le devis RETIENT le prestataire (2026-11-10) : son engagement est créé, dans la
  // limite des places recherchées — même logique que l'acceptation d'un prix
  // (src/lib/accept-proposal.ts). L'annonce reste ouverte jusqu'à sa date limite, et les autres
  // devis ne sont plus écartés sur-le-champ : ils le seront à l'échéance s'ils ne sont pas retenus.
  const result = await retainProposal({
    annonceId: missionId,
    proposalId,
    from: ["en_negociation"],
    to: "devis_valide",
    extra: { devisValideAt: new Date() },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "proposal_not_acceptable" ? "not_in_negotiation" : result.error }, { status: 409 });
  }
  await notifyRetained(result.engagementId, proposalId, "devis_valide", {
    provider: (t) => `Votre devis pour « ${t} » a été validé — le contrat va être généré pour signature.`,
    client: (t) => `Vous avez validé le devis retenu pour « ${t} ». Prochaine étape : la génération du contrat.`,
  });

  return NextResponse.json({ ok: true, engagementId: result.engagementId });
}
