import { prisma } from "@/lib/db";

// Politique KYC par étape (2026-11-02) — remplace « le KYC conditionne la publication ».
//
// La vérification d'identité ne garde plus l'ENTRÉE sur la plateforme, mais les étapes qui
// engagent quelqu'un ou déplacent de l'argent :
//
//   Client
//     - publier une mission : permis KYC en attente, sous contrôles antifraude (ci-dessous) ;
//     - contractualiser (accepter une candidature, valider un devis, générer / signer le
//       contrat, acheter un Gig) et financer le séquestre : KYC vérifié exigé.
//   Prestataire
//     - consulter les missions, préparer son profil et sa candidature : libre ;
//     - candidater (proposition, devis, offre acceptée), publier un Gig, signer : KYC vérifié.
//
// Contrôles antifraude d'une publication non vérifiée :
//   - KYC rejeté → aucune publication : la mission est gardée en brouillon (publication
//     demandée), comme avant, jusqu'à une nouvelle vérification ;
//   - au plus UNVERIFIED_PUBLISHED_LIMIT missions en ligne tant que l'identité n'est pas
//     vérifiée — au-delà, même mise en attente ;
//   - les prestataires voient que l'identité du client n'est pas vérifiée (badge absent sur la
//     fiche mission) et aucun contrat ne peut naître avant la vérification.

export const UNVERIFIED_PUBLISHED_LIMIT = 3;

export type KycBlock = { error: string; message: string };

export type PublicationRight = { ok: true; verified: boolean } | ({ ok: false } & KycBlock);

/**
 * Le client peut-il mettre une mission en ligne maintenant ? `ok: false` ne refuse pas la
 * mission : l'appelant la garde en brouillon marqué « publication demandée ».
 */
export async function clientPublicationRight(userId: string): Promise<PublicationRight> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (user?.kycStatus === "verifie") return { ok: true, verified: true };
  if (!user || user.kycStatus === "rejete") {
    return {
      ok: false,
      error: "kyc_rejected",
      message: "Votre vérification d'identité a été refusée : renvoyez vos justificatifs pour publier une mission.",
    };
  }
  const published = await prisma.mission.count({ where: { clientId: userId, status: "publiee" } });
  if (published >= UNVERIFIED_PUBLISHED_LIMIT) {
    return {
      ok: false,
      error: "unverified_publication_limit",
      message: `Tant que votre identité n'est pas vérifiée, vous pouvez avoir au plus ${UNVERIFIED_PUBLISHED_LIMIT} missions en ligne.`,
    };
  }
  return { ok: true, verified: false };
}

export type SensitiveStep = "contractualiser" | "financer" | "candidater" | "publier_gig" | "signer";

const STEP_MESSAGES: Record<SensitiveStep, string> = {
  contractualiser: "Votre identité doit être vérifiée avant de retenir un prestataire et de conclure un contrat.",
  financer: "Votre identité doit être vérifiée avant tout paiement sous séquestre.",
  candidater: "Votre identité doit être vérifiée avant de candidater.",
  publier_gig: "Votre identité doit être vérifiée avant de publier un Gig.",
  signer: "Votre identité doit être vérifiée avant de signer.",
};

/**
 * Étape sensible : `null` si le compte est vérifié, sinon le refus à renvoyer en 403. Le code
 * d'erreur reste `kyc_not_verified`, déjà traduit par les écrans.
 */
export async function kycBlockFor(userId: string, step: SensitiveStep): Promise<KycBlock | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (user?.kycStatus === "verifie") return null;
  return { error: "kyc_not_verified", message: STEP_MESSAGES[step] };
}
