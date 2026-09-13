import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { notifyMissionUser } from "@/lib/mission-notify";

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
  if (proposal.status !== "en_negociation") {
    return NextResponse.json({ error: "not_in_negotiation" }, { status: 409 });
  }
  if (!proposal.devisData) {
    return NextResponse.json({ error: "no_devis" }, { status: 409 });
  }

  // Capturé avant la transaction : après coup, les candidatures écartées ne se distinguent
  // plus de celles refusées précédemment.
  const ecartees = await prisma.missionProposal.findMany({
    where: { missionId, id: { not: proposalId }, status: { in: ["envoyee", "preselectionnee", "en_negociation"] } },
    select: { providerId: true },
  });

  await prisma.$transaction([
    prisma.missionProposal.update({
      where: { id: proposalId },
      // revisionRequestedAt remis à null : la négociation est close, plus aucune version
      // n'est attendue. Sans ce nettoyage, la candidature retenue restait affichée
      // « Révision demandée » (voir src/lib/proposal-status.ts). (2026-09-09)
      data: { status: "devis_valide", devisValideAt: new Date(), revisionRequestedAt: null, revisionRequestMessage: null },
    }),
    prisma.missionProposal.updateMany({
      where: {
        missionId,
        id: { not: proposalId },
        status: { in: ["envoyee", "preselectionnee", "en_negociation"] },
      },
      data: { status: "refusee", revisionRequestedAt: null, revisionRequestMessage: null },
    }),
    // Même transition que l'acceptation classique : la validation du devis vaut sélection
    // du prestataire, ce qui déclenche le parcours de génération de contrat existant.
    prisma.mission.update({
      where: { id: missionId },
      data: { status: "proposition_acceptee" },
    }),
  ]);

  // Cloche + e-mail : le prestataire retenu, le client, et les candidats écartés.
  const results = await Promise.allSettled([
    notifyMissionUser({
      missionId,
      userId: proposal.providerId,
      type: "devis_valide",
      message: `Votre devis pour « ${mission.titre} » a été validé — le contrat va être généré pour signature.`,
      email: {
        subject: `Devis validé — ${mission.titre}`,
        text: `Le client a validé votre devis pour la mission « ${mission.titre} ». Le contrat va être généré : vous le signerez en premier, puis le client contre-signera.`,
      },
    }),
    notifyMissionUser({
      missionId,
      userId,
      type: "devis_valide",
      message: `Vous avez validé le devis pour « ${mission.titre} »${ecartees.length ? ` — ${ecartees.length} autre(s) candidature(s) écartée(s)` : ""}. Prochaine étape : la génération du contrat.`,
      email: {
        subject: `Devis validé — ${mission.titre}`,
        text: `Vous avez validé le devis retenu pour la mission « ${mission.titre} ». Prochaine étape : la génération du contrat.`,
      },
    }),
    ...ecartees.map((e) =>
      notifyMissionUser({
        missionId,
        userId: e.providerId,
        type: "candidature_refusee",
        message: `Votre candidature à « ${mission.titre} » n'a pas été retenue — le client a validé le devis d'un autre prestataire.`,
        email: {
          subject: `Candidature non retenue — ${mission.titre}`,
          text: `Le client a retenu le devis d'un autre prestataire pour la mission « ${mission.titre} ».`,
        },
      })
    ),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("[devis/validate] Échec notification :", r.reason);
  }

  return NextResponse.json({ ok: true });
}
