import type { ProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notifyMissionUser } from "@/lib/mission-notify";
import { closeMissionDrafts } from "@/lib/proposal-drafts-close";
import { cancelExpiredContract, COUNTER_SIGN_DEADLINE_MS } from "@/lib/contract-expiry";
import { refundExpiredOrder, PROVIDER_SIGN_DEADLINE_MS } from "@/lib/gig-expiry";
import { deleteStoredFile } from "@/lib/storage";
import { PLACE_TAKING_ENGAGEMENT, placesRecherchees, RESERVE_DAYS, reserveUntil } from "@/lib/mission-expiry";

// ---------------------------------------------------------------------------
// Tâches d'expiration et de purge (2026-10-01) — extraites des routes /api/cron/* pour être
// exécutées indifféremment par le cron système (route HTTP, Bearer CRON_SECRET) ou par le worker
// (planification pg-boss, src/worker/index.ts). Le corps est celui des routes, inchangé.
// ---------------------------------------------------------------------------

/** Contrats signés par le prestataire (1/2) que le client n'a pas contre-signés dans les 48 h. */
export async function expireUnsignedContracts(): Promise<{ cancelled: number }> {
  const cutoff = new Date(Date.now() - COUNTER_SIGN_DEADLINE_MS);
  const expired = await prisma.prestationContract.findMany({
    where: { providerSignedAt: { not: null, lt: cutoff }, clientSignedAt: null },
    select: { id: true },
  });
  let cancelled = 0;
  for (const c of expired) {
    if (await cancelExpiredContract(c.id)) cancelled++;
  }
  return { cancelled };
}

// Clôture des annonces échues (2026-11-10) — remplace l'annulation des seules négociations de
// devis expirées. À la date limite de candidature d'une annonce (src/lib/mission-expiry.ts) :
//   - les candidatures NON RETENUES encore ouvertes (envoyée, en négociation) sont refusées, et
//     leurs auteurs prévenus — le prestataire est ainsi libéré de l'exclusivité des négociations ;
//   - les candidatures PRÉSÉLECTIONNÉES (« Shortlister ») ne le sont pas (2026-11-11) : elles
//     forment la RÉSERVE du client, mobilisable pendant RESERVE_DAYS en cas de désistement d'un
//     prestataire retenu (src/lib/engagement-withdrawal.ts). Leurs auteurs sont prévenus ; une
//     présélection ne bloque pas les autres candidatures du prestataire (ACTIVE_NEGOCIATION_STATUSES).
//     La réserve est libérée par releaseReserves ci-dessous ;
//   - les candidatures encore en brouillon (KYC en attente) sont retirées ;
//   - l'annonce passe à `annonce_close`.
// Les prestataires retenus ne sont pas concernés : leur candidature a rejoint leur engagement
// (mission enfant, sans date limite). Basé sur la date seule, jamais sur le nombre de rounds ni
// sur le nombre de prestataires retenus.
export async function closeExpiredAnnonces(now: Date = new Date()): Promise<{ closed: number; refused: number }> {
  const annonces = await prisma.mission.findMany({
    where: { status: "publiee", parentMissionId: null, dateExpiration: { lt: now } },
    select: { id: true, titre: true },
  });
  let closed = 0;
  let refused = 0;
  for (const a of annonces) {
    const open = { missionId: a.id, status: { in: ["envoyee", "en_negociation"] as ProposalStatus[] } };
    const losers = await prisma.missionProposal.findMany({ where: open, select: { providerId: true } });
    const reserve = await prisma.missionProposal.findMany({ where: { missionId: a.id, status: "preselectionnee" }, select: { providerId: true } });
    const res = await prisma.$transaction(async (tx) => {
      const m = await tx.mission.updateMany({ where: { id: a.id, status: "publiee" }, data: { status: "annonce_close" } });
      if (m.count === 0) return null; // déjà close par un passage concurrent
      const r = await tx.missionProposal.updateMany({
        where: open,
        data: { status: "refusee", revisionRequestedAt: null, revisionRequestMessage: null },
      });
      return r.count;
    });
    if (res === null) continue;
    closed += 1;
    refused += res;
    await Promise.allSettled([
      ...losers.map((l) =>
        notifyMissionUser({
          missionId: a.id,
          userId: l.providerId,
          type: "candidature_refusee",
          message: `La période de candidature de « ${a.titre} » est terminée : votre candidature n'a pas été retenue.`,
          email: {
            subject: `Candidature non retenue — ${a.titre}`,
            text: `La période de candidature de la mission « ${a.titre} » est terminée et votre candidature n'a pas été retenue. D'autres missions de votre domaine vous attendent sur FlexWork.`,
          },
        })
      ),
      ...reserve.map((r) =>
        notifyMissionUser({
          missionId: a.id,
          userId: r.providerId,
          type: "candidature_reserve",
          message: `« ${a.titre} » : votre candidature est placée en liste de réserve pendant ${RESERVE_DAYS} jours. Le client pourra vous retenir si une place se libère.`,
          email: {
            subject: `En liste de réserve — ${a.titre}`,
            text: `La période de candidature de « ${a.titre} » est terminée. Le client vous a présélectionné : votre candidature reste en réserve pendant ${RESERVE_DAYS} jours et pourra être retenue si un prestataire se désiste. Vous restez libre de candidater à d'autres missions.`,
          },
        })
      ),
    ]);
    await closeMissionDrafts(a.id, "expired");
  }
  return { closed, refused };
}

// Libération des réserves (2026-11-11) : sur une annonce close, les candidatures présélectionnées
// en réserve sont refusées — et leurs auteurs prévenus — quand :
//   - la réserve a expiré (RESERVE_DAYS après la date limite, reserveUntil) ;
//   - ou toutes les places sont pourvues par des engagements dont le contrat est signé des deux
//     parties : plus aucun désistement n'est possible (src/lib/engagement-withdrawal.ts).
export async function releaseReserves(now: Date = new Date()): Promise<{ released: number }> {
  const annonces = await prisma.mission.findMany({
    where: { status: "annonce_close", parentMissionId: null, proposals: { some: { status: "preselectionnee" } } },
    select: {
      id: true,
      titre: true,
      status: true,
      dateExpiration: true,
      maxCandidatures: true,
      engagements: { where: PLACE_TAKING_ENGAGEMENT, select: { contract: { select: { clientSignedAt: true, providerSignedAt: true } } } },
    },
  });
  let released = 0;
  for (const a of annonces) {
    const until = reserveUntil(a);
    const expired = !until || until.getTime() <= now.getTime();
    const allSigned =
      a.engagements.length >= placesRecherchees(a) &&
      a.engagements.every((e) => !!e.contract?.clientSignedAt && !!e.contract?.providerSignedAt);
    if (!expired && !allSigned) continue;
    const reserve = await prisma.missionProposal.findMany({ where: { missionId: a.id, status: "preselectionnee" }, select: { providerId: true } });
    const r = await prisma.missionProposal.updateMany({
      where: { missionId: a.id, status: "preselectionnee" },
      data: { status: "refusee", revisionRequestedAt: null, revisionRequestMessage: null },
    });
    released += r.count;
    await Promise.allSettled(
      reserve.map((p) =>
        notifyMissionUser({
          missionId: a.id,
          userId: p.providerId,
          type: "candidature_refusee",
          message: `« ${a.titre} » : la liste de réserve est close, votre candidature n'a pas été retenue.`,
          email: {
            subject: `Réserve close — ${a.titre}`,
            text: `Le client de la mission « ${a.titre} » a pourvu toutes ses places : la liste de réserve est close et votre candidature n'a pas été retenue. Merci pour votre disponibilité.`,
          },
        })
      )
    );
  }
  return { released };
}

/** Ancien nom de la tâche (`devis-expirations`, route /api/cron/devis-expirations). */
export async function expireDevisNegotiations(): Promise<{ cancelled: number; closed: number; released: number }> {
  const { closed, refused } = await closeExpiredAnnonces();
  // La libération des réserves partage ce passage : même rythme, même route cron, même worker.
  const { released } = await releaseReserves();
  return { cancelled: refused, closed, released };
}

/** Commandes Gig que le prestataire n'a pas signées sous 24 h : annulées et remboursées. */
export async function expireGigOrders(): Promise<{ refunded: number }> {
  const cutoff = new Date(Date.now() - PROVIDER_SIGN_DEADLINE_MS);
  const expired = await prisma.gigOrder.findMany({
    where: { clientSignedAt: { not: null, lt: cutoff }, providerSignedAt: null, status: "client_signed" },
    select: { id: true },
  });
  let refunded = 0;
  for (const o of expired) {
    if (await refundExpiredOrder(o.id)) refunded++;
  }
  return { refunded };
}

// Purge des pièces jointes de brouillons abandonnés (2026-09-23). Trente jours, volontairement
// plus que les sept du brouillon local (`mission-draft.ts`) : purger au même rythme risquerait
// d'effacer les fichiers d'un brouillon encore restaurable.
const DRAFT_ATTACHMENT_MAX_AGE_DAYS = 30;

export async function cleanupDraftAttachments(): Promise<{ deleted: number; filesRemoved: number }> {
  const cutoff = new Date(Date.now() - DRAFT_ATTACHMENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.missionDraftAttachment.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, filePath: true },
  });
  if (stale.length === 0) return { deleted: 0, filesRemoved: 0 };

  // Les LIGNES d'abord : ce sont elles qui rendent un fichier atteignable. Un échec disque
  // ensuite laisse un fichier orphelin inerte, plutôt qu'une ligne pointant vers le vide.
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
  return { deleted: stale.length, filesRemoved };
}
