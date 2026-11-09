import { prisma } from "@/lib/db";
import { publishedAgo } from "@/lib/latest-missions";

// Fiche PUBLIQUE d'une mission (2026-11-09) — ce qu'un visiteur non connecté peut lire avant de
// décider de candidater, comme sur les places de marché de freelances.
//
// Seule une mission PUBLIÉE est visible : brouillon, mission engagée, clôturée ou annulée → null
// (404). Et seulement ce qui décrit le BESOIN :
//   - titre, métier, compétences, type de professionnel et niveau requis ;
//   - description (coordonnées masquées, voir maskContacts) ;
//   - ville et pays, mode, date de début, délai, budget (ou fourchette pour un devis) ;
//   - état de vérification du client et son pays — jamais son nom ni son identifiant ;
//   - nombre de candidatures et plafond.
// Exclus : le client, le quartier, le cahier des charges, les pièces jointes, les candidatures,
// le responsable chantier, tout ce qui touche au contrat et au paiement.

export type PublicMission = {
  id: string;
  titre: string;
  description: string;
  metier: string;
  categorie: string | null;
  icon: string | null;
  competences: string[];
  professionalType: string | null;
  requiredLevel: string | null;
  mode: "presentiel" | "distance" | "hybride";
  ville: string | null;
  pays: string | null;
  dateDebut: string | null;
  delaiJours: number;
  urgent: boolean;
  isQuote: boolean;
  budget: number;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  createdAt: string;
  /** « il y a 3 heures » — calculé côté serveur. */
  publishedAgo: string;
  clientVerified: boolean;
  clientCountry: string | null;
  candidatures: number;
  maxCandidatures: number | null;
};

// Coordonnées laissées dans la description : un visiteur anonyme ne doit pas pouvoir contacter
// le client hors de la plateforme (paiement sous séquestre contourné). Email, numéro de 8
// chiffres ou plus (espaces, points, tirets, indicatif tolérés), lien WhatsApp.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+|00)?\d(?:[\s.-]?\d){7,}/g;
const WHATSAPP = /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/\S*/gi;
export const MASKED = "[coordonnées masquées]";

export function maskContacts(text: string): string {
  return text.replace(WHATSAPP, MASKED).replace(EMAIL, MASKED).replace(PHONE, MASKED);
}

export async function getPublicMission(id: string): Promise<PublicMission | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const m = await prisma.mission.findFirst({
    where: { id, status: "publiee", client: { status: "active" } },
    select: {
      id: true,
      titre: true,
      description: true,
      domaine: true,
      tags: true,
      professionalType: true,
      requiredLevel: true,
      mode: true,
      ville: true,
      pays: true,
      dateDebut: true,
      delaiJours: true,
      urgent: true,
      budgetType: true,
      budget: true,
      budgetMin: true,
      budgetMax: true,
      currency: true,
      createdAt: true,
      maxCandidatures: true,
      metier: { select: { libelle: true } },
      categorie: { select: { libelle: true, icon: true } },
      client: { select: { kycStatus: true, country: true } },
      // Même décompte que l'accueil (src/lib/latest-missions.ts) : candidatures encore en jeu.
      _count: { select: { proposals: { where: { status: { notIn: ["refusee", "annulee_definitive"] } } } } },
    },
  });
  if (!m) return null;
  return {
    id: m.id,
    titre: m.titre,
    description: maskContacts(m.description),
    metier: m.metier?.libelle ?? m.domaine,
    categorie: m.categorie?.libelle ?? null,
    icon: m.categorie?.icon ?? null,
    competences: m.tags,
    professionalType: m.professionalType,
    requiredLevel: m.requiredLevel,
    mode: m.mode,
    ville: m.ville,
    pays: m.pays ?? m.client.country ?? null,
    dateDebut: m.dateDebut?.toISOString() ?? null,
    delaiJours: m.delaiJours,
    urgent: m.urgent,
    isQuote: m.budgetType === "QUOTE",
    budget: m.budget,
    budgetMin: m.budgetMin,
    budgetMax: m.budgetMax,
    currency: m.currency,
    createdAt: m.createdAt.toISOString(),
    publishedAgo: publishedAgo(m.createdAt),
    clientVerified: m.client.kycStatus === "verifie",
    clientCountry: m.client.country ?? null,
    candidatures: m._count.proposals,
    maxCandidatures: m.maxCandidatures,
  };
}
