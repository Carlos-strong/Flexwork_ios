// Avis du profil public (2026-11-10) — logique pure : contexte affiché sous chaque avis, détail
// des notes, tri et filtres. Testable sans Prisma (même convention que review-rules.ts).
//
// Le contexte situe l'avis SANS identifier le client : une fourchette de prix plutôt que le
// montant exact du contrat (qui, recoupé avec la date et le métier, désignerait la mission),
// une durée prévue arrondie, jamais le nom de l'auteur.

export const SUB_RATING_KEYS = ["noteCommunication", "noteQualite", "noteValeur"] as const;
export type SubRatingKey = (typeof SUB_RATING_KEYS)[number];

export type SubRatings = Partial<Record<SubRatingKey, number | null>>;

/** Moyenne de chaque sous-note sur les seuls avis qui la renseignent ; null si aucun. */
export function subRatingAverages(reviews: SubRatings[]): Record<SubRatingKey, number | null> {
  const out = {} as Record<SubRatingKey, number | null>;
  for (const k of SUB_RATING_KEYS) {
    const vals = reviews.map((r) => r[k]).filter((v): v is number => typeof v === "number");
    out[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }
  return out;
}

// Paliers en FCFA (XOF) ; les autres devises sont converties à la louche pour choisir le palier,
// l'affichage reste dans la devise de la mission.
const XOF_BOUNDS = [25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000];
const APPROX_XOF: Record<string, number> = { XOF: 1, XAF: 1, EUR: 656, USD: 600, NGN: 0.4 };
const CURRENCY_SHORT: Record<string, string> = { XOF: "FCFA", XAF: "FCFA", EUR: "€", USD: "$", NGN: "NGN" };

function fmt(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ | /g, " ");
}

/** Fourchette de prix affichable (« 50 000 – 100 000 FCFA »), ou null sans montant. */
export function priceBucket(amount: number | null | undefined, currency = "XOF"): string | null {
  if (!amount || amount <= 0 || !Number.isFinite(amount)) return null;
  const rate = APPROX_XOF[currency] ?? 1;
  const unit = CURRENCY_SHORT[currency] ?? currency;
  const xof = amount * rate;
  const toCur = (b: number) => {
    const v = b / rate;
    // Arrondi lisible dans la devise d'origine.
    const step = v >= 1000 ? 100 : v >= 100 ? 10 : 1;
    return Math.round(v / step) * step;
  };
  const upperIdx = XOF_BOUNDS.findIndex((b) => xof < b);
  if (upperIdx === 0) return `Moins de ${fmt(toCur(XOF_BOUNDS[0]))} ${unit}`;
  if (upperIdx === -1) return `Plus de ${fmt(toCur(XOF_BOUNDS[XOF_BOUNDS.length - 1]))} ${unit}`;
  return `${fmt(toCur(XOF_BOUNDS[upperIdx - 1]))} – ${fmt(toCur(XOF_BOUNDS[upperIdx]))} ${unit}`;
}

/** Durée prévue lisible : jours sous deux semaines, puis semaines, puis mois. */
export function durationLabel(days: number | null | undefined): string | null {
  if (!days || days <= 0) return null;
  if (days < 14) return `${days} jour${days > 1 ? "s" : ""}`;
  if (days < 60) {
    const w = Math.round(days / 7);
    return `${w} semaine${w > 1 ? "s" : ""}`;
  }
  return `${Math.round(days / 30)} mois`;
}

export const REVIEW_SORTS = ["pertinents", "recents", "meilleurs", "moins_bons"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export type ReviewQuery = {
  sort: ReviewSort;
  note: number | null;
  avecCommentaire: boolean;
  recurrents: boolean;
  offset: number;
  take: number;
};

export function parseReviewQuery(sp: URLSearchParams): ReviewQuery {
  const sort = sp.get("sort");
  const note = Number(sp.get("note"));
  const offset = Number(sp.get("offset"));
  const take = Number(sp.get("take"));
  return {
    sort: (REVIEW_SORTS as readonly string[]).includes(sort ?? "") ? (sort as ReviewSort) : "pertinents",
    note: Number.isInteger(note) && note >= 1 && note <= 5 ? note : null,
    avecCommentaire: sp.get("avecCommentaire") === "1",
    recurrents: sp.get("recurrents") === "1",
    offset: Number.isInteger(offset) && offset > 0 ? Math.min(offset, 10_000) : 0,
    take: Number.isInteger(take) && take > 0 ? Math.min(take, 20) : 5,
  };
}

export type RankableReview = {
  id: string;
  note: number;
  createdAt: Date;
  hasComment: boolean;
  utileCount: number;
  recurrent: boolean;
};

/** Filtre puis trie. « Pertinents » : commentés d'abord, puis les plus jugés utiles, puis récents. */
export function rankReviews<T extends RankableReview>(items: T[], q: Pick<ReviewQuery, "sort" | "note" | "avecCommentaire" | "recurrents">): T[] {
  const filtered = items.filter(
    (r) => (q.note == null || r.note === q.note) && (!q.avecCommentaire || r.hasComment) && (!q.recurrents || r.recurrent),
  );
  const recent = (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
  const cmp: Record<ReviewSort, (a: T, b: T) => number> = {
    recents: recent,
    meilleurs: (a, b) => b.note - a.note || recent(a, b),
    moins_bons: (a, b) => a.note - b.note || recent(a, b),
    pertinents: (a, b) => Number(b.hasComment) - Number(a.hasComment) || b.utileCount - a.utileCount || recent(a, b),
  };
  return [...filtered].sort(cmp[q.sort]);
}
