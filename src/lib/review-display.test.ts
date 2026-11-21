import { describe, expect, it } from "vitest";
import { durationLabel, parseReviewQuery, priceBucket, rankReviews, subRatingAverages } from "./review-display";

describe("priceBucket — fourchette, jamais le montant exact", () => {
  it("place un montant FCFA dans son palier", () => {
    expect(priceBucket(75_000, "XOF")).toBe("50 000 – 100 000 FCFA");
    expect(priceBucket(10_000, "XOF")).toBe("Moins de 25 000 FCFA");
    expect(priceBucket(9_000_000, "XOF")).toBe("Plus de 5 000 000 FCFA");
  });
  it("borne basse incluse dans le palier supérieur", () => {
    expect(priceBucket(100_000, "XOF")).toBe("100 000 – 250 000 FCFA");
  });
  it("aucun montant → null", () => {
    expect(priceBucket(0)).toBeNull();
    expect(priceBucket(null)).toBeNull();
  });
  it("affiche dans la devise d'origine", () => {
    expect(priceBucket(500, "EUR")).toMatch(/€$/);
  });
});

describe("durationLabel", () => {
  it("jours, semaines, mois", () => {
    expect(durationLabel(1)).toBe("1 jour");
    expect(durationLabel(10)).toBe("10 jours");
    expect(durationLabel(28)).toBe("4 semaines");
    expect(durationLabel(90)).toBe("3 mois");
    expect(durationLabel(null)).toBeNull();
  });
});

describe("subRatingAverages — seuls les avis qui renseignent la sous-note comptent", () => {
  it("ignore les null", () => {
    const avg = subRatingAverages([{ noteCommunication: 5, noteQualite: null }, { noteCommunication: 3 }, {}]);
    expect(avg.noteCommunication).toBe(4);
    expect(avg.noteQualite).toBeNull();
  });
});

describe("parseReviewQuery", () => {
  it("valeurs par défaut et bornes", () => {
    expect(parseReviewQuery(new URLSearchParams())).toEqual({ sort: "pertinents", note: null, avecCommentaire: false, recurrents: false, offset: 0, take: 5 });
    const q = parseReviewQuery(new URLSearchParams("sort=hack&note=9&take=500&offset=-3"));
    expect(q.sort).toBe("pertinents");
    expect(q.note).toBeNull();
    expect(q.take).toBe(20);
    expect(q.offset).toBe(0);
  });
});

describe("rankReviews", () => {
  const d = (n: number) => new Date(2026, 0, n);
  const items = [
    { id: "a", note: 5, createdAt: d(1), hasComment: false, utileCount: 9, recurrent: false },
    { id: "b", note: 3, createdAt: d(5), hasComment: true, utileCount: 0, recurrent: true },
    { id: "c", note: 4, createdAt: d(3), hasComment: true, utileCount: 2, recurrent: false },
  ];
  const base = { note: null, avecCommentaire: false, recurrents: false };
  it("pertinents : commentés, puis utiles, puis récents", () => {
    expect(rankReviews(items, { ...base, sort: "pertinents" }).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("tris par date et par note", () => {
    expect(rankReviews(items, { ...base, sort: "recents" }).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(rankReviews(items, { ...base, sort: "meilleurs" }).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(rankReviews(items, { ...base, sort: "moins_bons" }).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("filtres", () => {
    expect(rankReviews(items, { ...base, sort: "recents", note: 4 }).map((r) => r.id)).toEqual(["c"]);
    expect(rankReviews(items, { ...base, sort: "recents", recurrents: true }).map((r) => r.id)).toEqual(["b"]);
    expect(rankReviews(items, { ...base, sort: "recents", avecCommentaire: true }).map((r) => r.id)).toEqual(["b", "c"]);
  });
});
