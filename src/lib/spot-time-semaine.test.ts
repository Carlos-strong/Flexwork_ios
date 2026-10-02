/**
 * Unité de taux HEBDOMADAIRE (2026-09-23) — mode S2W.
 *
 * Arbitrage : semaine ISO, du lundi 00:00:00 au dimanche 23:59:59.999 UTC, indépendante de la
 * date de début du contrat. C'est ce qui rend un relevé identifiable sans connaître le
 * contrat — deux prestataires du même chantier pointent les mêmes semaines.
 *
 * Le piège que ces tests verrouillent : le dimanche appartient à la semaine qui a commencé SIX
 * jours plus tôt, pas à celle qui commence le lendemain. L'oublier décale tout d'un jour.
 */

import { describe, expect, it } from "vitest";
import { weekPeriod, RATE_UNIT_LABEL } from "./spot-time";
import { FINANCING_MODES } from "./financing-modes";

const iso = (d: Date) => d.toISOString();

describe("bornes de la semaine ISO", () => {
  it("cale un mercredi sur le lundi qui précède et le dimanche qui suit", () => {
    const { periodStart, periodEnd } = weekPeriod(new Date("2026-07-08T14:30:00.000Z")); // mercredi
    expect(iso(periodStart)).toBe("2026-07-06T00:00:00.000Z"); // lundi
    expect(iso(periodEnd)).toBe("2026-07-12T23:59:59.999Z"); // dimanche
  });

  it("rattache le DIMANCHE à la semaine qui s'achève, pas à la suivante", () => {
    const { periodStart } = weekPeriod(new Date("2026-07-12T10:00:00.000Z")); // dimanche
    expect(iso(periodStart)).toBe("2026-07-06T00:00:00.000Z");
  });

  it("laisse le lundi à sa propre semaine", () => {
    const { periodStart } = weekPeriod(new Date("2026-07-06T00:00:00.000Z"));
    expect(iso(periodStart)).toBe("2026-07-06T00:00:00.000Z");
  });

  it("donne les mêmes bornes pour tous les jours d'une même semaine", () => {
    const jours = ["06", "07", "08", "09", "10", "11", "12"].map((d) => weekPeriod(new Date(`2026-07-${d}T09:00:00.000Z`)));
    const attendu = iso(jours[0].periodStart);
    for (const j of jours) expect(iso(j.periodStart)).toBe(attendu);
  });

  it("couvre exactement sept jours, sans recouvrement d'une semaine à l'autre", () => {
    const s1 = weekPeriod(new Date("2026-07-08T00:00:00.000Z"));
    const s2 = weekPeriod(new Date("2026-07-15T00:00:00.000Z"));
    expect(s1.periodEnd.getTime() - s1.periodStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000 - 1);
    expect(s2.periodStart.getTime() - s1.periodEnd.getTime()).toBe(1);
  });

  it("franchit correctement un changement de mois et d'année", () => {
    // 1er janvier 2027 est un vendredi : sa semaine commence le lundi 28 décembre 2026.
    expect(iso(weekPeriod(new Date("2027-01-01T12:00:00.000Z")).periodStart)).toBe("2026-12-28T00:00:00.000Z");
  });
});

describe("catalogue", () => {
  it("expose un mode hebdomadaire disponible, de la famille temps", () => {
    const s2w = FINANCING_MODES.S2W;
    expect(s2w.family).toBe("temps");
    expect(s2w.rateUnit).toBe("week");
    expect(s2w.available).toBe(true);
  });

  it("associe une et une seule unité à chaque mode au temps", () => {
    const parUnite = Object.values(FINANCING_MODES)
      .filter((m) => m.family === "temps")
      .map((m) => m.rateUnit);
    expect(new Set(parUnite).size).toBe(parUnite.length);
    expect(parUnite).toContain("week");
  });

  it("nomme la semaine partout où une unité s'affiche", () => {
    expect(RATE_UNIT_LABEL.week).toEqual({ one: "semaine", many: "semaines", per: "semaine" });
  });
});
