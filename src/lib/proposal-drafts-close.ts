import { prisma } from "@/lib/db";
import { notifyMissionUser } from "@/lib/mission-notify";

// Séparé de src/lib/proposal-drafts.ts (2026-11-10) : celui-ci importe `@/auth` (next-auth),
// que le worker (src/worker, hors de Next) ne peut pas charger. La clôture des annonces
// (closeExpiredAnnonces, src/lib/scheduled-tasks.ts) tourne dans le worker.

/**
 * Annonce close (échéance) ou attribuée (2026-11-10) : les candidatures encore en brouillon pour
 * elle ne partiront jamais. Elles restaient en place, présentées comme « à reprendre », et leur auteur n'apprenait
 * rien. On les retire et on prévient chacun que la mission est pourvue. Ne lève jamais :
 * l'attribution qui l'appelle ne doit pas échouer pour autant.
 */
export async function closeMissionDrafts(missionId: string, reason: "attributed" | "expired" = "expired"): Promise<void> {
  try {
    const drafts = await prisma.proposalDraft.findMany({
      where: { missionId },
      select: { providerId: true, mission: { select: { titre: true } } },
    });
    if (drafts.length === 0) return;
    await prisma.proposalDraft.deleteMany({ where: { missionId } });
    await Promise.allSettled(
      drafts.map((d) =>
        notifyMissionUser({
          missionId,
          userId: d.providerId,
          type: "candidature_refusee",
          message:
            reason === "expired"
              ? `La période de candidature de « ${d.mission.titre} » est terminée : votre candidature en attente a été retirée.`
              : `La mission « ${d.mission.titre} » a été attribuée à un autre prestataire : votre candidature en attente a été retirée.`,
          email: {
            subject: `${reason === "expired" ? "Candidatures closes" : "Mission pourvue"} — ${d.mission.titre}`,
            text: `${
              reason === "expired"
                ? `La période de candidature de la mission « ${d.mission.titre} » est terminée.`
                : `Le client a retenu un autre prestataire pour la mission « ${d.mission.titre} ».`
            } Votre candidature en attente a été retirée. D'autres missions de votre domaine vous attendent sur FlexWork.`,
          },
        })
      )
    );
  } catch (e) {
    console.error("[proposal-drafts] fermeture des brouillons échouée (non bloquant) :", e);
  }
}
