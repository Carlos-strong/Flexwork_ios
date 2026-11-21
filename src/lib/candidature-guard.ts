import { prisma } from "@/lib/db";
import { hasRequiredGarants } from "@/lib/garant-rules";
import { isCategorieAgeOk } from "@/lib/age-categorie";
import { GARANT_ROLES } from "@/lib/role-dashboard";
import type { Mission } from "@prisma/client";
import { isOpenForApplications } from "@/lib/mission-expiry";

// Gardes de candidature partagés — une seule source de vérité réutilisée par
// POST /api/missions/[id]/proposals (candidature à prix) et POST /api/missions/[id]/devis
// (candidature en mode QUOTE). Le KYC est géré séparément (holdCandidatureForKyc, src/lib/proposal-drafts.ts).
//   - mission ouverte (publiee)
//   - mode présentiel/hybride : garant obligatoire requis UNIQUEMENT si l'Admin KYC a activé
//     « garant requis » pour ce prestataire (User.garantRequired, désactivé par défaut ;
//     l'option reste disponible pour artisan/manœuvre/expert_btp_autres)
//   - risque HIGH : assurance RC Pro déclarée requise
//   - catégorie de mission marquée par l'admin : âge minimum établi requis (A13, 2026-09-24)
//   - date limite de candidature non échue (2026-11-10)
export type CandidatureGuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 409; error: string; message?: string };

export async function checkCandidatureEligibility(
  mission: Mission,
  providerId: string
): Promise<CandidatureGuardResult> {
  // A13 — le contrôle d'âge porte sur la CATÉGORIE de la mission, jamais sur le rôle du compte
  // (2026-09-24 ; il portait auparavant sur la filière prestataire, décision dual-role point
  // 03). C'est l'axe du travail : quel que soit le type d'activité déclaré, on ne candidate pas
  // à un travail dangereux sans un âge établi. Défense en profondeur : la barrière s'est déjà
  // dressée à la déclaration du métier (POST /api/profile), mais une candidature peut viser
  // une mission d'une autre catégorie que la sienne.
  const provider = await prisma.user.findUnique({
    where: { id: providerId },
    select: { role: true, dateNaissance: true, country: true, garantRequired: true },
  });
  if (!provider) {
    return { ok: false, status: 403, error: "provider_not_found" };
  }
  const ageOk = await isCategorieAgeOk({
    categorieId: mission.categorieId,
    role: provider.role,
    country: provider.country,
    dateNaissance: provider.dateNaissance,
  });
  if (!ageOk.ok) {
    return {
      ok: false,
      status: 403,
      error: ageOk.reason === "no_birth_date" ? "kyc_required_for_age" : "age_under_minimum",
      message:
        ageOk.reason === "no_birth_date"
          ? "Votre identité (KYC) doit être vérifiée : la date de naissance est requise pour cette mission."
          : "Vous devez avoir l'âge minimum requis pour candidater à cette mission.",
    };
  }

  if (mission.status !== "publiee") {
    return { ok: false, status: 409, error: "mission_not_open" };
  }
  // Seule la date limite ferme l'annonce aux candidatures (2026-11-10, src/lib/mission-expiry.ts).
  // Elle n'était vérifiée que pour un devis : une candidature à prix fixe passait après l'échéance.
  if (!isOpenForApplications(mission)) {
    return { ok: false, status: 409, error: "mission_expired", message: "La période de candidature de cette mission est terminée." };
  }

  if (mission.mode !== "distance") {
    // Garants : exigés UNIQUEMENT quand l'Admin KYC a activé « garant requis » pour CE
    // prestataire (User.garantRequired — désactivé par défaut pour toutes les filières).
    // L'option reste disponible pour les filières chantier (GARANT_ROLES : artisan,
    // manœuvre, expert_btp_autres) mais n'engage rien sans cette activation : l'entreprise
    // (ou tout autre rôle) n'est donc plus bloqué par défaut sur une mission en présentiel.
    // (2026-09-09)
    if (provider.garantRequired && (GARANT_ROLES as readonly string[]).includes(provider.role)) {
      const garants = await prisma.garant.findMany({
        where: { profile: { userId: providerId } },
      });
      if (!hasRequiredGarants(garants)) {
        return {
          ok: false,
          status: 403,
          error: "garant_required",
          message: "Un garant obligatoire est requis pour candidater à cette mission (exigence activée pour votre profil).",
        };
      }
    }

    if (mission.riskLevel === "high") {
      const insuranceCount = await prisma.professionalDeclaration.count({
        where: {
          profile: { userId: providerId },
          declarationType: "insurance",
          removedAt: null,
        },
      });
      if (insuranceCount === 0) {
        return {
          ok: false,
          status: 403,
          error: "insurance_required",
          message: "Cette mission à risque élevé exige une assurance RC Pro déclarée. Veuillez en ajouter une dans votre profil avant de candidater.",
        };
      }
    }
  }

  // Déjà retenu sur cette annonce (2026-11-10) : sa candidature a rejoint son engagement (mission
  // enfant), elle n'est plus visible sur l'annonce — sans ce contrôle, il pouvait recandidater
  // et se voir retenir une seconde fois.
  const dejaRetenu = await prisma.missionProposal.count({
    where: { providerId, mission: { parentMissionId: mission.id } },
  });
  if (dejaRetenu > 0) {
    return { ok: false, status: 409, error: "already_applied", message: "Vous avez déjà été retenu sur cette mission." };
  }

  // Plus de plafond de candidatures (2026-11-10) : `maxCandidatures` est désormais le nombre de
  // prestataires que le client RETIENDRA (places, vérifiées à l'acceptation — accept-proposal.ts),
  // pas une limite des candidatures reçues. Seule la date limite ferme l'annonce.
  return { ok: true };
}
