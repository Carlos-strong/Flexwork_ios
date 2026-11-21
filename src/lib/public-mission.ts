import { prisma } from "@/lib/db";
import { publishedAgo } from "@/lib/latest-missions";
import { contractPrice } from "@/lib/escrow";

// Fiche PUBLIQUE d'une mission (2026-11-09) — ce qu'un visiteur non connecté peut lire avant de
// décider de candidater, comme sur les places de marché de freelances.
//
// Seule une mission PUBLIÉE est visible : brouillon, mission engagée, clôturée ou annulée → null
// (404). Et seulement ce qui décrit le BESOIN :
//   - titre, métier, compétences, type de professionnel et niveau requis ;
//   - description (coordonnées masquées, voir maskContacts) ;
//   - ville et pays, mode, date de début, délai, budget (ou fourchette pour un devis) ;
//   - état de vérification du client et son pays — jamais son nom ni son identifiant ;
//   - nombre de candidatures, prestataires recherchés et déjà retenus, date limite.
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
  /** Prestataires RECHERCHÉS (champ « Prestataires recherchés » de la publication) — pas un
   *  plafond de candidatures : le serveur n'en impose aucun (voir src/lib/accept-proposal.ts). */
  maxCandidatures: number | null;
  /** Prestataires déjà retenus (engagements de l'annonce). */
  prestatairesRetenus: number;
  /** Date limite de candidature (annonce), si le client en a fixé une. */
  dateExpiration: string | null;
  /**
   * Vue PROPRIÉTAIRE uniquement (getPublicMission(id, { ownerId })) — jamais renvoyé par l'API
   * publique : statut réel et, une fois le contrat créé, ce qui a été convenu.
   */
  status?: string;
  contract?: {
    price: number;
    delaiJours: number | null;
    providerName: string | null;
    jalons: { ordre: number; titre: string; montant: number; status: string }[];
  } | null;
  /** Annonce dont cette mission est l'engagement (vue propriétaire). */
  parent?: { id: string; titre: string } | null;
  /** Engagements de l'annonce — prestataires retenus (vue propriétaire). */
  engagements?: { id: string; status: string; providerName: string | null }[];
  /** Candidatures reçues sur l'annonce ET déplacées sur ses engagements (vue propriétaire). */
  candidaturesTotal?: number;
  /** Prestataire retenu sur cette mission, avant même que son contrat existe (vue propriétaire). */
  retainedProviderName?: string | null;
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

// `ownerId` (2026-11-11) : le CLIENT PROPRIÉTAIRE voit la fiche de SA mission quel que soit son
// statut (engagée, clôturée…), sans masquage de ses propres coordonnées, avec le contrat. Sans
// `ownerId` — l'API publique, les visiteurs, les autres membres —, rien ne change : mission
// publiée seulement, champs filtrés.
export async function getPublicMission(id: string, opts: { ownerId?: string } = {}): Promise<PublicMission | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const owner = opts.ownerId ?? null;
  const m = await prisma.mission.findFirst({
    where: owner ? { id, clientId: owner } : { id, status: "publiee", client: { status: "active" } },
    select: {
      status: true,
      // Lu toujours (typage Prisma), mais exposé seulement en vue propriétaire (ownerExtras).
      parentMission: { select: { id: true, titre: true } },
      proposals: {
        where: { status: { in: ["acceptee", "devis_valide"] } },
        select: { provider: { select: { firstname: true, lastname: true } } },
        take: 1,
      },
      engagements: {
        // Un engagement annulé (désistement, 2026-11-11) ne compte plus parmi les retenus.
        where: { status: { not: "annulee" } },
        select: {
          id: true,
          status: true,
          _count: { select: { proposals: true } },
          proposals: {
            where: { status: { in: ["acceptee", "devis_valide"] } },
            select: { provider: { select: { firstname: true, lastname: true } } },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },
      contract: {
        select: {
          termsSnapshot: true,
          provider: { select: { firstname: true, lastname: true } },
          jalons: { select: { ordre: true, titre: true, montant: true, status: true }, orderBy: { ordre: "asc" } },
        },
      },
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
      dateExpiration: true,
      metier: { select: { libelle: true } },
      categorie: { select: { libelle: true, icon: true } },
      client: { select: { kycStatus: true, country: true } },
      // Même décompte que l'accueil (src/lib/latest-missions.ts) : candidatures encore en jeu.
      _count: { select: { proposals: { where: { status: { notIn: ["refusee", "annulee_definitive"] } } }, engagements: { where: { status: { not: "annulee" } } } } },
    },
  });
  if (!m) return null;
  const c = owner ? m.contract : null;
  const ownerExtras: Pick<PublicMission, "status" | "contract" | "parent" | "engagements" | "candidaturesTotal" | "retainedProviderName"> = owner
    ? {
        status: m.status,
        retainedProviderName: [m.proposals[0]?.provider.firstname, m.proposals[0]?.provider.lastname].filter(Boolean).join(" ") || null,
        parent: m.parentMission ?? null,
        engagements: m.engagements.map((e) => ({
          id: e.id,
          status: e.status,
          providerName: [e.proposals[0]?.provider.firstname, e.proposals[0]?.provider.lastname].filter(Boolean).join(" ") || null,
        })),
        candidaturesTotal: m._count.proposals + m.engagements.reduce((s, e) => s + e._count.proposals, 0),
        contract: c
          ? {
              price: contractPrice({ mission: { budget: m.budget }, termsSnapshot: c.termsSnapshot }),
              delaiJours: (c.termsSnapshot as { delaiJours?: number } | null)?.delaiJours ?? null,
              providerName: [c.provider?.firstname, c.provider?.lastname].filter(Boolean).join(" ") || null,
              jalons: c.jalons,
            }
          : null,
      }
    : {};
  return {
    ...ownerExtras,
    id: m.id,
    titre: m.titre,
    description: owner ? m.description : maskContacts(m.description),
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
    prestatairesRetenus: m._count.engagements,
    dateExpiration: m.dateExpiration?.toISOString() ?? null,
  };
}
