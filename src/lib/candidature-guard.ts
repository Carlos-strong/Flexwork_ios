import { prisma } from "@/lib/db";
import { hasRequiredGarants } from "@/lib/garant-rules";
import { isChantierPrestataireAgeOk } from "@/lib/chantier-age";
import { GARANT_ROLES } from "@/lib/role-dashboard";
import type { Mission } from "@prisma/client";

// Gardes de candidature partagés — une seule source de vérité réutilisée par
// POST /api/missions/[id]/proposals (candidature à prix) et POST /api/missions/[id]/devis
// (candidature en mode QUOTE). Le KYC est géré séparément (requireVerifiedKyc).
//   - mission ouverte (publiee)
//   - mode présentiel/hybride : garant obligatoire requis UNIQUEMENT si l'Admin KYC a activé
//     « garant requis » pour ce prestataire (User.garantRequired, désactivé par défaut ;
//     l'option reste disponible pour artisan/manœuvre/expert_btp_autres)
//   - risque HIGH : assurance RC Pro déclarée requise
export type CandidatureGuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 409; error: string; message?: string };

export async function checkCandidatureEligibility(
  mission: Mission,
  providerId: string
): Promise<CandidatureGuardResult> {
  // A13 — le contrôle d'âge porte sur la FILIÈRE PRESTATAIRE, jamais sur le compte
  // (décision dual-role, point 03). Défense en profondeur : un mineur ne peut pas candidater
  // à une mission de chantier, même en contournant l'activation de profil (POST /api/profile).
  const provider = await prisma.user.findUnique({
    where: { id: providerId },
    select: { role: true, dateNaissance: true, country: true, garantRequired: true },
  });
  if (!provider) {
    return { ok: false, status: 403, error: "provider_not_found" };
  }
  const ageOk = await isChantierPrestataireAgeOk({
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
          ? "Votre identité (KYC) doit être vérifiée pour candidater à une mission de chantier."
          : "Vous devez avoir l'âge minimum requis pour candidater à cette mission de chantier.",
    };
  }

  if (mission.status !== "publiee") {
    return { ok: false, status: 409, error: "mission_not_open" };
  }

  if (mission.mode !== "distance") {
    // Garants : exigés UNIQUEMENT quand l'Admin KYC a activé « garant requis » pour CE
    // prestataire (User.garantRequired — désactivé par défaut pour toutes les filières).
    // L'option reste disponible pour les filières chantier (GARANT_ROLES : artisan,
    // manœuvre, expert_btp_autres) mais n'engage rien sans cette activation : l'expert BTP
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

  return { ok: true };
}
