import { prisma } from "@/lib/db";
import { getFinancingMode } from "@/lib/financing-modes";
import { notifyMatchingProviders, notifyMissionUser } from "@/lib/mission-notify";

// Publication d'une mission — règles et effets PARTAGÉS (2026-10-06).
//
// Deux chemins publient une mission : la création directe (POST /api/missions, statut
// « publiee ») et la publication d'un brouillon existant (POST /api/missions/[id]/publish),
// notamment celui enregistré quand le client a voulu publier avant que son identité soit
// vérifiée. Les deux doivent appliquer EXACTEMENT les mêmes conditions et produire les mêmes
// effets — d'où ce module, plutôt qu'une seconde copie qui divergerait à la première retouche.

export type PublishBlocker = { error: string; reason?: string | null };

/**
 * Conditions de publication propres à la mission (le KYC est vérifié à part, par l'appelant).
 * `null` = publiable.
 *
 *  - Contrat au TEMPS : tarif et quantité maximale obligatoires.
 *  - Budget obligatoire, sauf « Demande de devis », qui annonce justement l'absence de montant.
 *  - Mode de financement décrit mais pas encore implémenté : comparable au brouillon, jamais
 *    publiable — il engagerait un prestataire à chiffrer selon un mode que la plateforme ne
 *    sait pas encore exécuter.
 */
export function publishBlocker(m: {
  budgetType: string | null | undefined;
  budget: number | null | undefined;
  financingModeKey: string | null | undefined;
  timeRate: number | null | undefined;
  timeMaxQuantity: number | null | undefined;
}): PublishBlocker | null {
  const mode = m.financingModeKey ? getFinancingMode(m.financingModeKey) : null;
  if (mode?.family === "temps" && !(m.timeRate && m.timeMaxQuantity)) {
    return { error: "time_terms_required_to_publish" };
  }
  // Un brouillon sans montant porte 0 en espace réservé (voir la création) : 0 = pas de budget.
  if (!m.budget && m.budgetType !== "QUOTE") {
    return { error: "budget_required_to_publish" };
  }
  if (m.financingModeKey && !mode?.available) {
    return { error: "financing_mode_unavailable", reason: mode?.unavailableReason ?? null };
  }
  return null;
}

/**
 * Effets de la publication : prestataires du domaine notifiés, client prévenu (cloche +
 * e-mail). Non bloquant : la mission est déjà publiée et committée — échouer ici ferait
 * retenter le client et créerait des doublons.
 */
export async function announcePublication(mission: { id: string; titre: string; domaine: string }, clientId: string) {
  try {
    const notifiés = await notifyMatchingProviders(mission.id, mission.domaine);
    await notifyMissionUser({
      missionId: mission.id,
      userId: clientId,
      type: "mission_publiee",
      message: `Votre mission « ${mission.titre} » est publiée — ${notifiés.length} prestataire(s) du domaine « ${mission.domaine} » ont été notifiés.`,
      email: {
        subject: `Mission publiée — ${mission.titre}`,
        text: `Votre mission « ${mission.titre} » est en ligne. ${notifiés.length} prestataire(s) du domaine « ${mission.domaine} » ont été notifiés et peuvent désormais candidater.`,
      },
    });
  } catch (e) {
    console.error("[mission-publish] notification de publication échouée (non bloquant) :", e);
  }
}

/**
 * Identité vérifiée : prévient le client de chaque mission dont il avait demandé la
 * publication avant la vérification. Appelé par les deux routes qui peuvent faire passer un
 * compte à « verifie » (décision globale et décision par document). Non bloquant.
 *
 * On PRÉVIENT, on ne publie pas d'office : la publication notifie des prestataires et engage
 * le client, et entre la demande et la vérification ses dates ou son budget ont pu vieillir.
 * Il publie en un clic depuis son tableau de bord, où les conditions sont revérifiées.
 */
export async function notifyPendingPublications(userId: string) {
  try {
    const pending = await prisma.mission.findMany({
      where: { clientId: userId, status: "brouillon", publicationRequestedAt: { not: null } },
      select: { id: true, titre: true },
    });
    for (const m of pending) {
      await notifyMissionUser({
        missionId: m.id,
        userId,
        type: "mission_prete_a_publier",
        message: `Votre identité est vérifiée : votre mission « ${m.titre} » est prête à être publiée depuis votre tableau de bord.`,
        email: {
          subject: `Votre mission est prête à être publiée — ${m.titre}`,
          text: `Votre identité a été vérifiée. Votre mission « ${m.titre} », enregistrée en brouillon, peut maintenant être publiée en un clic depuis votre tableau de bord FlexWork.`,
        },
      });
    }
  } catch (e) {
    console.error("[mission-publish] notification des publications en attente échouée (non bloquant) :", e);
  }
}
