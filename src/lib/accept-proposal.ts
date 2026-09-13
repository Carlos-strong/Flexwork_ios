import { prisma } from "@/lib/db";
import { notifyMissionUser } from "@/lib/mission-notify";

// Logique partagée d'acceptation d'une candidature — utilisée par
// POST /api/missions/[id]/proposals/[proposalId]/accept (acceptation directe par le client)
// et POST /api/offers/[id]/accept (le prestataire accepte une offre formelle qui référence
// cette même candidature, model Offer.proposalId) : les deux chemins doivent produire
// exactement le même état (candidature acceptée, les autres refusées, mission passée en
// "proposition_acceptee") plutôt que deux implémentations qui pourraient diverger.
export async function acceptProposal(missionId: string, proposalId: string): Promise<void> {
  // Capturé AVANT la transaction : une fois les autres candidatures passées à "refusee",
  // on ne peut plus distinguer celles que cette acceptation vient de refuser.
  const refusees = await prisma.missionProposal.findMany({
    where: { missionId, id: { not: proposalId }, status: "envoyee" },
    select: { providerId: true },
  });

  await prisma.$transaction([
    // revisionRequestedAt remis à null de part et d'autre : la négociation est close, plus
    // aucune version n'est attendue. Sans ce nettoyage, une candidature acceptée (ou écartée)
    // alors qu'une révision avait été demandée restait affichée « Révision demandée »
    // (voir src/lib/proposal-status.ts). (2026-09-09)
    prisma.missionProposal.update({
      where: { id: proposalId },
      data: { status: "acceptee", revisionRequestedAt: null, revisionRequestMessage: null },
    }),
    prisma.missionProposal.updateMany({
      where: { missionId, id: { not: proposalId }, status: "envoyee" },
      data: { status: "refusee", revisionRequestedAt: null, revisionRequestMessage: null },
    }),
    prisma.mission.update({ where: { id: missionId }, data: { status: "proposition_acceptee" } }),
  ]);

  // Notification (cloche + e-mail) de TOUTES les parties concernées par l'acceptation,
  // depuis la logique partagée pour que les deux chemins d'acceptation la déclenchent
  // (2026-09-09) : le candidat retenu, le client, et les candidats écartés.
  const [mission, accepted] = await Promise.all([
    prisma.mission.findUnique({ where: { id: missionId }, select: { titre: true, clientId: true } }),
    prisma.missionProposal.findUnique({ where: { id: proposalId }, select: { providerId: true } }),
  ]);
  if (!mission || !accepted) return;
  const titre = mission.titre;

  const tasks = [
    notifyMissionUser({
      missionId,
      userId: accepted.providerId,
      type: "candidature_acceptee",
      message: `Votre candidature à « ${titre} » a été acceptée — le contrat va être généré pour signature.`,
      email: {
        subject: `Candidature acceptée — ${titre}`,
        text: `Votre candidature à la mission « ${titre} » a été acceptée. Le contrat va être généré : vous le signerez en premier, puis le client contre-signera.`,
      },
    }),
    notifyMissionUser({
      missionId,
      userId: mission.clientId,
      type: "candidature_acceptee",
      message: `Vous avez accepté une candidature pour « ${titre} »${refusees.length ? ` — ${refusees.length} autre(s) candidature(s) automatiquement refusée(s)` : ""}.`,
      email: {
        subject: `Candidature acceptée — ${titre}`,
        text: `Vous avez accepté une candidature pour la mission « ${titre} ». Prochaine étape : la génération du contrat.`,
      },
    }),
    ...refusees.map((r) =>
      notifyMissionUser({
        missionId,
        userId: r.providerId,
        type: "candidature_refusee",
        message: `Votre candidature à « ${titre} » n'a pas été retenue — le client a sélectionné un autre prestataire.`,
        email: {
          subject: `Candidature non retenue — ${titre}`,
          text: `Le client a sélectionné un autre prestataire pour la mission « ${titre} ». D'autres missions de votre domaine vous seront proposées.`,
        },
      })
    ),
  ];

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") console.error("[accept-proposal] Échec notification :", r.reason);
  }
}
