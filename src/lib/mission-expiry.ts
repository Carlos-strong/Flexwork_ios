import type { Prisma } from "@prisma/client";

// Annonce : période de candidature et places (2026-11-10).
//
// Règles :
//   - le client choisit une DURÉE de publication (PUBLICATION_DURATIONS) ; la date limite de
//     candidature est calculée à la publication EFFECTIVE (une mission retenue en brouillon
//     faute de KYC garde toute sa durée une fois publiée) ;
//   - seule cette date ferme l'annonce aux candidatures : retenir des prestataires ne la ferme
//     pas, et le nombre de candidatures reçues n'est plus plafonné ;
//   - le client retient jusqu'à `maxCandidatures` prestataires (le nombre RECHERCHÉ, 1 par
//     défaut) ; chacun obtient un engagement (src/lib/accept-proposal.ts) ;
//   - à l'échéance, l'annonce passe à `annonce_close` (closeExpiredAnnonces,
//     src/lib/scheduled-tasks.ts) : les candidatures non retenues sont refusées, SAUF celles
//     que le client a présélectionnées (« Shortlister ») — elles forment sa RÉSERVE ;
//   - réserve (2026-11-11) : pendant RESERVE_DAYS après la clôture, une place libérée par un
//     désistement (engagement `annulee`, src/lib/engagement-withdrawal.ts) peut être pourvue
//     par un candidat de la réserve, sans republier. Ensuite — ou dès que toutes les places ont
//     un contrat signé — la réserve est libérée (releaseReserves, src/lib/scheduled-tasks.ts).
// Logique pure, sauf les critères Prisma exportés.

export const PUBLICATION_DURATIONS = [7, 14, 21, 30] as const;
export type PublicationDuration = (typeof PUBLICATION_DURATIONS)[number];
export const DEFAULT_PUBLICATION_DURATION: PublicationDuration = 14;

const DAY_MS = 86_400_000;

export function isPublicationDuration(v: unknown): v is PublicationDuration {
  return typeof v === "number" && (PUBLICATION_DURATIONS as readonly number[]).includes(v);
}

/** Date limite de candidature d'une annonce publiée à `publishedAt`. */
export function publicationExpiry(publishedAt: Date, days: number | null | undefined): Date {
  const d = isPublicationDuration(days) ? days : DEFAULT_PUBLICATION_DURATION;
  return new Date(publishedAt.getTime() + d * DAY_MS);
}

/** L'annonce reçoit-elle encore des candidatures ? */
export function isOpenForApplications(
  m: { status: string; dateExpiration: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (m.status !== "publiee") return false;
  return !m.dateExpiration || new Date(m.dateExpiration).getTime() > now.getTime();
}

/** Critère Prisma : annonces ouvertes aux candidatures. */
export function openAnnonceWhere(now: Date = new Date()): Prisma.MissionWhereInput {
  return { status: "publiee", OR: [{ dateExpiration: null }, { dateExpiration: { gt: now } }] };
}

/** Nombre de prestataires recherchés (1 si le client n'a rien indiqué). */
export function placesRecherchees(m: { maxCandidatures: number | null }): number {
  return m.maxCandidatures && m.maxCandidatures > 0 ? m.maxCandidatures : 1;
}

/** « Candidatures jusqu'au 24 nov. · J-5 » — ou null sans date. */
export function applicationDeadlineLabel(dateExpiration: Date | string | null, now: Date = new Date()): string | null {
  if (!dateExpiration) return null;
  const d = new Date(dateExpiration);
  const days = Math.ceil((d.getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return "Candidatures closes";
  const date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const left = days === 1 ? "dernier jour" : `J-${days}`;
  return `Candidatures jusqu'au ${date} · ${left}`;
}

// ── Réserve (2026-11-11) ────────────────────────────────────────────────────────────────────

/** Durée de la réserve après la clôture de l'annonce. */
export const RESERVE_DAYS = 30;

/** Fin de la réserve d'une annonce close (null si l'annonce n'est pas close ou sans date). */
export function reserveUntil(m: { status: string; dateExpiration: Date | string | null }): Date | null {
  if (m.status !== "annonce_close" || !m.dateExpiration) return null;
  return new Date(new Date(m.dateExpiration).getTime() + RESERVE_DAYS * DAY_MS);
}

/** La réserve d'une annonce close est-elle encore mobilisable ? */
export function isReserveOpen(m: { status: string; dateExpiration: Date | string | null }, now: Date = new Date()): boolean {
  const until = reserveUntil(m);
  return !!until && until.getTime() > now.getTime();
}

/** Engagements qui occupent une place : tous, sauf ceux annulés par un désistement. */
export const PLACE_TAKING_ENGAGEMENT: Prisma.MissionWhereInput = { status: { not: "annulee" } };
