import { prisma } from "@/lib/db";
import { hasRequiredGarants } from "@/lib/garant-rules";
import type { Mission } from "@prisma/client";

// Gardes de candidature partagés — une seule source de vérité réutilisée par
// POST /api/missions/[id]/proposals (candidature à prix) et POST /api/missions/[id]/devis
// (candidature en mode QUOTE). Le KYC est géré séparément (requireVerifiedKyc).
//   - mission ouverte (publiee)
//   - mode présentiel/hybride : garant obligatoire requis
//   - risque HIGH : assurance RC Pro déclarée requise
export type CandidatureGuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 409; error: string; message?: string };

export async function checkCandidatureEligibility(
  mission: Mission,
  providerId: string
): Promise<CandidatureGuardResult> {
  if (mission.status !== "publiee") {
    return { ok: false, status: 409, error: "mission_not_open" };
  }

  if (mission.mode !== "distance") {
    const garants = await prisma.garant.findMany({
      where: { profile: { userId: providerId } },
    });
    if (!hasRequiredGarants(garants)) {
      return {
        ok: false,
        status: 403,
        error: "garant_required",
        message: "Un garant obligatoire est requis pour candidater à une mission en présentiel ou hybride.",
      };
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
