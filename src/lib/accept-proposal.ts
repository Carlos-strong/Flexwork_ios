import { Prisma, type ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notifyMissionUser } from "@/lib/mission-notify";
import { isOpenForApplications, isReserveOpen, PLACE_TAKING_ENGAGEMENT, placesRecherchees } from "@/lib/mission-expiry";

// Retenir un prestataire sur une annonce (2026-11-10) — logique partagée par :
//   - POST /api/missions/[id]/proposals/[proposalId]/accept (prix fixe / au temps) ;
//   - POST /api/offers/[id]/accept (le prestataire accepte une offre formelle) ;
//   - POST /api/missions/[id]/proposals/[proposalId]/devis/validate (mode devis).
//
// ── Annonce et engagements ──────────────────────────────────────────────────────────────
// Une mission publiée est une ANNONCE : le client y retient jusqu'à `maxCandidatures`
// prestataires (1 par défaut). Retenir un prestataire crée son ENGAGEMENT : une mission enfant
// (`parentMissionId`), copie des conditions de l'annonce, qui reçoit la candidature retenue et
// suit le parcours de toujours — contrat, signature, séquestre, livrable, avis — avec ce seul
// prestataire. Le contrat, le séquestre et les avis restent donc « un par mission », inchangés.
//
// L'annonce, elle, n'est PAS fermée par ce choix : elle reçoit des candidatures jusqu'à sa date
// limite, et les candidatures non retenues ne sont refusées qu'à l'échéance
// (closeExpiredAnnonces, src/lib/scheduled-tasks.ts). Avant (jusqu'au 2026-11-10), accepter
// une candidature passait la mission elle-même dans le parcours contrat et refusait toutes les
// autres sur-le-champ.

// Statuts d'une candidature encore OUVERTE sur l'annonce.
export const ACCEPTABLE_PROPOSAL_STATUSES = ["envoyee", "preselectionnee", "en_negociation"] as const;

export type RetainError = "mission_not_open" | "proposal_not_acceptable" | "places_full";
export type AcceptResult = { ok: true; engagementId: string } | { ok: false; error: RetainError };

class RetainRefused extends Error {
  constructor(readonly code: RetainError) {
    super(code);
  }
}

// Champs de l'annonce que l'engagement NE reprend PAS : identité, cycle de vie propre, et tout
// ce qui ne concerne que la période de candidature.
const NOT_COPIED = new Set<string>([
  "id",
  "createdAt",
  "updatedAt",
  "status",
  "parentMissionId",
  "dateExpiration",
  "dureePublicationJours",
  "publicationRequestedAt",
  "maxCandidatures",
  "clientValidatedAt",
]);

/** Données de l'engagement : copie des conditions de l'annonce. */
function engagementData(annonce: Record<string, unknown>): Prisma.MissionUncheckedCreateInput {
  const data: Record<string, unknown> = {};
  for (const key of Object.values(Prisma.MissionScalarFieldEnum)) {
    if (NOT_COPIED.has(key)) continue;
    const v = annonce[key];
    // Les colonnes JSON nulles doivent être explicitement `Prisma.DbNull` à l'écriture.
    data[key] = v === null && isJsonColumn(key) ? Prisma.DbNull : v;
  }
  return {
    ...(data as Prisma.MissionUncheckedCreateInput),
    status: "proposition_acceptee",
    parentMissionId: annonce.id as string,
    maxCandidatures: null,
  };
}

const JSON_COLUMNS = new Set<string>(
  (Prisma.dmmf.datamodel.models.find((m) => m.name === "Mission")?.fields ?? [])
    .filter((f) => f.type === "Json")
    .map((f) => f.name),
);
function isJsonColumn(key: string): boolean {
  return JSON_COLUMNS.has(key);
}

/**
 * Retient la candidature `proposalId` de l'annonce `annonceId` et crée son engagement.
 * `from` : statuts depuis lesquels la candidature peut être retenue ; `to` : son statut
 * final (`acceptee` pour un prix, `devis_valide` pour un devis).
 */
export async function retainProposal(opts: {
  annonceId: string;
  proposalId: string;
  from?: readonly ProposalStatus[];
  to?: ProposalStatus;
  extra?: Prisma.MissionProposalUncheckedUpdateInput;
}): Promise<AcceptResult> {
  const { annonceId, proposalId } = opts;
  const from = opts.from ?? ACCEPTABLE_PROPOSAL_STATUSES;
  const to = opts.to ?? "acceptee";

  let engagementId: string;
  try {
    engagementId = await prisma.$transaction(async (tx) => {
      // Verrou sur l'annonce : deux sélections simultanées ne dépassent pas les places.
      await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${annonceId} FOR UPDATE`;
      const annonce = await tx.mission.findUnique({ where: { id: annonceId } });
      const proposal = await tx.missionProposal.findFirst({
        where: { id: proposalId, missionId: annonceId, status: { in: [...from] } },
        select: { id: true, status: true },
      });
      // Annonce ouverte, ou — RÉSERVE (2026-11-11) — annonce close dont la réserve court encore,
      // pour un candidat présélectionné : il remplace un prestataire qui s'est désisté.
      const fromReserve = !!annonce && !!proposal && proposal.status === "preselectionnee" && isReserveOpen(annonce);
      if (!annonce || annonce.parentMissionId !== null || !(isOpenForApplications(annonce) || fromReserve)) {
        throw new RetainRefused("mission_not_open");
      }
      // Un engagement annulé (désistement) libère sa place.
      const retained = await tx.mission.count({ where: { parentMissionId: annonceId, ...PLACE_TAKING_ENGAGEMENT } });
      if (retained >= placesRecherchees(annonce)) throw new RetainRefused("places_full");
      if (!proposal) throw new RetainRefused("proposal_not_acceptable");

      const engagement = await tx.mission.create({ data: engagementData(annonce as unknown as Record<string, unknown>), select: { id: true } });
      // La candidature retenue (et son historique de rounds, attaché à elle) passe sur
      // l'engagement : c'est là que la route contrat la trouvera.
      await tx.missionProposal.update({
        where: { id: proposalId },
        data: { ...opts.extra, missionId: engagement.id, status: to, revisionRequestedAt: null, revisionRequestMessage: null },
      });
      // Une offre formelle qui la référence la suit.
      await tx.offer.updateMany({ where: { proposalId }, data: { missionId: engagement.id } });
      // Pièces jointes génériques de l'annonce (cahier des charges) : reprises sur l'engagement.
      // Le fichier n'est pas recopié, seule la ligne (même convention que la conversion des
      // pièces de brouillon, POST /api/missions).
      const attachments = await tx.missionAttachment.findMany({ where: { missionId: annonceId, jalonId: null } });
      if (attachments.length > 0) {
        await tx.missionAttachment.createMany({
          data: attachments.map(({ id: _id, createdAt: _c, missionId: _m, ...a }) => ({ ...a, missionId: engagement.id })),
        });
      }
      return engagement.id;
    });
  } catch (e) {
    if (e instanceof RetainRefused) return { ok: false, error: e.code };
    throw e;
  }
  return { ok: true, engagementId };
}

/** Prix fixe / au temps, ou offre acceptée : retenir + notifier. */
export async function acceptProposal(annonceId: string, proposalId: string): Promise<AcceptResult> {
  const result = await retainProposal({ annonceId, proposalId });
  if (!result.ok) return result;
  await notifyRetained(result.engagementId, proposalId, "candidature_acceptee", {
    provider: (t) => `Votre candidature à « ${t} » a été acceptée — le contrat va être généré pour signature.`,
    client: (t) => `Vous avez retenu un prestataire pour « ${t} ». Prochaine étape : la génération du contrat.`,
  });
  return result;
}

/** Notifie le prestataire retenu et le client, sur l'ENGAGEMENT. */
export async function notifyRetained(
  engagementId: string,
  proposalId: string,
  type: string,
  messages: { provider: (titre: string) => string; client: (titre: string) => string },
): Promise<void> {
  const [mission, accepted] = await Promise.all([
    prisma.mission.findUnique({ where: { id: engagementId }, select: { titre: true, clientId: true } }),
    prisma.missionProposal.findUnique({ where: { id: proposalId }, select: { providerId: true } }),
  ]);
  if (!mission || !accepted) return;
  const titre = mission.titre;
  const results = await Promise.allSettled([
    notifyMissionUser({
      missionId: engagementId,
      userId: accepted.providerId,
      type,
      message: messages.provider(titre),
      email: {
        subject: `Vous êtes retenu — ${titre}`,
        text: `${messages.provider(titre)} Vous signerez le contrat en premier, puis le client contre-signera.`,
      },
    }),
    notifyMissionUser({
      missionId: engagementId,
      userId: mission.clientId,
      type,
      message: messages.client(titre),
      email: { subject: `Prestataire retenu — ${titre}`, text: messages.client(titre) },
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("[accept-proposal] Échec notification :", r.reason);
  }
}
