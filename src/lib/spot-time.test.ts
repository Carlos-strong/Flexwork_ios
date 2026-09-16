/**
 * Contrat au temps (§9 à §13, §19) — fonctions PURES.
 *
 * Tous les exemples chiffrés du cahier des charges sont rejoués ici au franc près : c'est le
 * moyen le plus direct de vérifier qu'on a implémenté ce qui était demandé, et pas une variante
 * plausible.
 */

import { describe, expect, it } from "vitest";
import {
  attendanceAmount,
  checkCaps,
  dayPeriod,
  expectedMaxAmount,
  fundingAlert,
  monthPeriod,
  periodsOverlap,
  resolveTimeTerms,
  type SpotTimeTerms,
} from "@/lib/spot-time";

// §10 — artisan journalier : 7 500 / jour, 20 jours maximum.
const JOURNALIER: SpotTimeTerms = {
  rateUnit: "day",
  rate: 7_500,
  maxQuantity: 20,
  maxAmount: 150_000,
  overtimeAllowed: false,
  overtimeRate: null,
};

// §12 — horaire : 1 500 / heure, 200 heures maximum.
const HORAIRE: SpotTimeTerms = {
  rateUnit: "hour",
  rate: 1_500,
  maxQuantity: 200,
  maxAmount: 300_000,
  overtimeAllowed: false,
  overtimeRate: null,
};

// §13 — mensuel : 250 000 / mois.
const MENSUEL: SpotTimeTerms = {
  rateUnit: "month",
  rate: 250_000,
  maxQuantity: 1,
  maxAmount: 250_000,
  overtimeAllowed: false,
  overtimeRate: null,
};

describe("plafond financier — §10", () => {
  it("20 jours × 7 500 = 150 000", () => {
    expect(expectedMaxAmount(JOURNALIER)).toBe(150_000);
  });

  it("200 heures × 1 500 = 300 000 — §12", () => {
    expect(expectedMaxAmount(HORAIRE)).toBe(300_000);
  });
});

describe("montant d'un relevé validé", () => {
  it("§11 — 4 jours validés valent 30 000", () => {
    expect(attendanceAmount(JOURNALIER, 4)).toBe(30_000);
  });

  it("§12 — 8 heures validées valent 12 000", () => {
    expect(attendanceAmount(HORAIRE, 8)).toBe(12_000);
  });

  it("§13 — un mois validé vaut 250 000", () => {
    expect(attendanceAmount(MENSUEL, 1)).toBe(250_000);
  });

  it("une quantité nulle ou négative ne vaut rien", () => {
    expect(attendanceAmount(JOURNALIER, 0)).toBe(0);
    expect(attendanceAmount(JOURNALIER, -3)).toBe(0);
  });

  it("une journée partielle est payée au prorata", () => {
    expect(attendanceAmount(JOURNALIER, 0.5)).toBe(3_750);
  });

  it("le montant est ENTIER — le PSP refuse les décimales", () => {
    expect(Number.isInteger(attendanceAmount(HORAIRE, 7.5))).toBe(true);
  });
});

describe("heures supplémentaires", () => {
  const AVEC_SUP: SpotTimeTerms = { ...HORAIRE, overtimeAllowed: true, overtimeRate: 2_250 };

  it("les heures majorées sont une PART des heures validées, pas un supplément", () => {
    // 9 h validées dont 1 supplémentaire = 8 × 1 500 + 1 × 2 250. Les compter en plus paierait
    // neuf heures et en facturerait dix.
    expect(attendanceAmount(AVEC_SUP, 9, 1)).toBe(8 * 1_500 + 2_250);
  });

  it("sans clause au contrat, les heures supplémentaires sont payées au tarif NORMAL", () => {
    // Jamais refusées : punir rétroactivement des heures réellement travaillées pour une clause
    // que le prestataire ne maîtrise pas serait injuste. C'est le tarif qui change, pas le droit.
    expect(attendanceAmount(HORAIRE, 9, 1)).toBe(9 * 1_500);
  });

  it("une part majorée supérieure au total validé est ramenée au total", () => {
    expect(attendanceAmount(AVEC_SUP, 2, 5)).toBe(2 * 2_250);
  });
});

describe("plafonds contractuels — deux refus distincts", () => {
  it("dans les limites, le montant est renvoyé", () => {
    expect(checkCaps(JOURNALIER, 4, 0, 0, 0)).toEqual({ ok: true, amount: 30_000 });
  });

  it("dépasser le plafond de QUANTITÉ est refusé pour cette raison-là", () => {
    // 18 jours déjà validés, on en demande 4 : il n'en reste que 2.
    expect(checkCaps(JOURNALIER, 4, 0, 18, 135_000)).toEqual({
      ok: false,
      reason: "quantity_cap_exceeded",
      allowed: 2,
    });
  });

  it("dépasser le plafond de MONTANT est refusé pour une raison différente", () => {
    // Le motif compte : « vous dépassez les 20 jours convenus » n'est pas « le plafond
    // financier est atteint », et confondre les deux enverrait chercher un financement là où
    // c'est la durée qui bloque.
    const majore: SpotTimeTerms = { ...JOURNALIER, maxAmount: 100_000 };
    expect(checkCaps(majore, 4, 0, 0, 90_000)).toEqual({
      ok: false,
      reason: "amount_cap_exceeded",
      allowed: 10_000,
    });
  });

  it("le plafond atteint exactement passe encore", () => {
    expect(checkCaps(JOURNALIER, 2, 0, 18, 135_000)).toEqual({ ok: true, amount: 15_000 });
  });
});

describe("seuil d'alerte — §19", () => {
  it("annonce combien d'unités le séquestre couvre encore", () => {
    // « Le séquestre disponible ne couvre plus que 4 jours de présence. »
    expect(fundingAlert(JOURNALIER, 30_000).remainingUnits).toBe(4);
  });

  it("arrondit vers le BAS — ne jamais promettre une journée qui sera refusée", () => {
    // 27 750 couvre 3,7 jours : annoncer 4 ferait déplacer une équipe pour rien.
    expect(fundingAlert(JOURNALIER, 27_750).remainingUnits).toBe(3);
  });

  it("alerte sous 20 % du plafond contractuel", () => {
    expect(fundingAlert(JOURNALIER, 40_000).low).toBe(false);
    expect(fundingAlert(JOURNALIER, 29_000).low).toBe(true);
  });

  it("un séquestre vide ne couvre rien", () => {
    expect(fundingAlert(JOURNALIER, 0)).toEqual({ remainingUnits: 0, low: true });
  });
});

describe("périodes — contre le double pointage", () => {
  it("une journée couvre bien un jour entier", () => {
    const p = dayPeriod(new Date("2026-09-03T14:32:00Z"));
    expect(p.periodStart.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(p.periodEnd.toISOString()).toBe("2026-09-03T23:59:59.999Z");
  });

  it("deux saisies du MÊME jour produisent les mêmes bornes — l'unicité en base peut jouer", () => {
    const matin = dayPeriod(new Date("2026-09-03T08:00:00Z"));
    const soir = dayPeriod(new Date("2026-09-03T19:00:00Z"));
    expect(matin).toEqual(soir);
  });

  it("un mois couvre le mois entier", () => {
    const p = monthPeriod(new Date("2026-09-14T10:00:00Z"));
    expect(p.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(p.periodEnd.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  it("détecte un chevauchement PARTIEL, qu'aucune contrainte d'unicité n'attraperait", () => {
    const a = { periodStart: new Date("2026-09-03T08:00:00Z"), periodEnd: new Date("2026-09-03T12:00:00Z") };
    const b = { periodStart: new Date("2026-09-03T10:00:00Z"), periodEnd: new Date("2026-09-03T14:00:00Z") };
    expect(periodsOverlap(a, b)).toBe(true);
  });

  it("deux plages qui se suivent ne se chevauchent pas", () => {
    const matin = { periodStart: new Date("2026-09-03T08:00:00Z"), periodEnd: new Date("2026-09-03T12:00:00Z") };
    const apresMidi = { periodStart: new Date("2026-09-03T13:00:00Z"), periodEnd: new Date("2026-09-03T17:00:00Z") };
    expect(periodsOverlap(matin, apresMidi)).toBe(false);
  });
});

// ── Conditions figées au contrat (2026-09-15) ─────────────────────────────────────────────────
describe("resolveTimeTerms — les conditions qu'un contrat au temps fige", () => {
  it("reprend le tarif proposé et fait du prix du contrat le plafond (§10 : 7 500 × 20)", () => {
    const res = resolveTimeTerms({ rateUnit: "day", maxQuantity: 20, unitRate: 7_500, contractPrice: 150_000 });
    expect(res).toEqual({
      ok: true,
      terms: { rateUnit: "day", rate: 7_500, maxQuantity: 20, maxAmount: 150_000, overtimeAllowed: false, overtimeRate: null },
    });
  });

  it("sans tarif proposé, le déduit du plafond négocié", () => {
    const res = resolveTimeTerms({ rateUnit: "hour", maxQuantity: 200, unitRate: null, contractPrice: 300_000 });
    expect(res.ok && res.terms.rate).toBe(1_500);
  });

  it("refuse une mission au temps sans quantité maximale — aucun plafond ne peut être figé", () => {
    expect(resolveTimeTerms({ rateUnit: "day", maxQuantity: null, unitRate: 7_500, contractPrice: 150_000 })).toEqual({
      ok: false,
      error: "time_terms_missing",
    });
  });
});

describe("checkCaps — le dernier relevé solde le plafond", () => {
  // Plafond négocié qui ne tombe pas juste : 149 999 sur 20 jours, soit 7 499,95 / jour. Chaque
  // journée s'arrondit à 7 500 : 20 journées feraient 150 000, un franc au-dessus du plafond.
  const ARRONDI: SpotTimeTerms = { ...JOURNALIER, rate: 149_999 / 20, maxAmount: 149_999 };

  it("la journée qui épuise la quantité convenue est payée au solde exact, pas refusée", () => {
    const res = checkCaps(ARRONDI, 1, 0, 19, 19 * 7_500);
    expect(res).toEqual({ ok: true, amount: 149_999 - 19 * 7_500 });
  });

  it("la même règle solde un reliquat dans l'autre sens — pas de centimes oubliés au séquestre", () => {
    const auDessus: SpotTimeTerms = { ...JOURNALIER, rate: 150_001 / 20, maxAmount: 150_001 };
    expect(checkCaps(auDessus, 1, 0, 19, 19 * 7_500)).toEqual({ ok: true, amount: 7_501 });
  });

  it("ne couvre qu'un écart d'arrondi : un vrai dépassement du plafond reste refusé", () => {
    const incoherent: SpotTimeTerms = { ...JOURNALIER, maxAmount: 100_000 };
    expect(checkCaps(incoherent, 1, 0, 19, 19 * 7_500)).toEqual({ ok: false, reason: "amount_cap_exceeded", allowed: 0 });
  });

  it("une journée qui n'épuise PAS la quantité est payée au tarif, sans absorption", () => {
    expect(checkCaps(ARRONDI, 1, 0, 10, 10 * 7_500)).toEqual({ ok: true, amount: 7_500 });
  });
});
