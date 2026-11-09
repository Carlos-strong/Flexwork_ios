import { prisma } from "@/lib/db";

// Dernières missions publiées, pour la page d'accueil (2026-11-03).
//
// Page PUBLIQUE : on n'en sort que ce qui aide un prestataire à décider d'ouvrir la mission —
// métier, titre, lieu, budget, ancienneté, nombre de candidatures — et l'état de vérification du
// client, comme sur la fiche (F-08). Jamais le nom du client. La description se lit sur la fiche
// publique de la mission (2026-11-09, src/lib/public-mission.ts), coordonnées masquées.
//
// Ordre : date de création. `Mission` ne date pas sa publication ; un brouillon publié des jours
// plus tard se range donc à sa date de rédaction.

export type LatestMission = {
  id: string;
  titre: string;
  metier: string;
  icon: string | null;
  mode: "presentiel" | "distance" | "hybride";
  ville: string | null;
  budgetLabel: string;
  createdAt: Date;
  urgent: boolean;
  clientVerified: boolean;
  /** Pays du client (ISO alpha-2) — son drapeau seul, jamais son nom. */
  clientCountry: string | null;
  candidatures: number;
};

/** NE LÈVE JAMAIS : une base indisponible masque la section, pas la page d'accueil. */
export async function getLatestMissions(limit = 6): Promise<LatestMission[]> {
  try {
    const missions = await prisma.mission.findMany({
      where: { status: "publiee" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        titre: true,
        domaine: true,
        mode: true,
        ville: true,
        budget: true,
        budgetType: true,
        currency: true,
        createdAt: true,
        urgent: true,
        metier: { select: { libelle: true } },
        categorie: { select: { icon: true } },
        client: { select: { kycStatus: true, country: true } },
        // Même décompte que la liste prestataire (GET /api/missions) : candidatures encore en jeu.
        _count: { select: { proposals: { where: { status: { notIn: ["refusee", "annulee_definitive"] } } } } },
      },
    });
    return missions.map((m) => ({
      id: m.id,
      titre: m.titre,
      metier: m.metier?.libelle ?? m.domaine,
      icon: m.categorie?.icon ?? null,
      mode: m.mode,
      ville: m.ville,
      budgetLabel: m.budgetType === "QUOTE" ? "Sur devis" : `${m.budget.toLocaleString("fr-FR")} ${m.currency}`,
      createdAt: m.createdAt,
      urgent: m.urgent,
      clientVerified: m.client.kycStatus === "verifie",
      clientCountry: m.client.country ?? null,
      candidatures: m._count.proposals,
    }));
  } catch {
    return [];
  }
}

const RELATIVE = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

/** « il y a 3 heures », « hier », « il y a 2 semaines ». */
export function publishedAgo(date: Date, now = new Date()): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes > -1) return "à l'instant";
  if (minutes > -60) return RELATIVE.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return RELATIVE.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (days > -7) return RELATIVE.format(days, "day");
  const weeks = Math.round(days / 7);
  if (weeks > -5) return RELATIVE.format(weeks, "week");
  return RELATIVE.format(Math.round(days / 30), "month");
}
