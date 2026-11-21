/**
 * Référentiel de villes (2026-09-23) — constante, faute de table en base.
 *
 * Le seul risque réel ici est la divergence avec `COUNTRIES` : un pays ouvert à l'inscription
 * dont la cascade Pays → Ville n'aurait rien à proposer.
 */

import { describe, expect, it } from "vitest";
import { COUNTRIES } from "./countries";
import { CITIES_BY_COUNTRY, citiesFor } from "./cities";

describe("couverture", () => {
  it("couvre chacun des pays ouverts à l'inscription", () => {
    for (const country of COUNTRIES) {
      expect(citiesFor(country.code), country.name).not.toHaveLength(0);
    }
  });

  it("ne référence aucun pays absent de COUNTRIES", () => {
    const known = new Set(COUNTRIES.map((c) => c.code));
    for (const code of Object.keys(CITIES_BY_COUNTRY)) expect(known.has(code), code).toBe(true);
  });

  it("ne contient ni doublon ni libellé vide", () => {
    for (const [code, villes] of Object.entries(CITIES_BY_COUNTRY)) {
      expect(new Set(villes).size, code).toBe(villes.length);
      expect(villes.every((v) => v.trim().length > 0), code).toBe(true);
    }
  });
});

describe("citiesFor", () => {
  it("renvoie une liste vide plutôt que de lever sur un code inconnu", () => {
    expect(citiesFor("ZZ")).toEqual([]);
    expect(citiesFor(null)).toEqual([]);
    expect(citiesFor(undefined)).toEqual([]);
    expect(citiesFor("")).toEqual([]);
  });

  it("sert les villes du pays demandé", () => {
    expect(citiesFor("BJ")).toContain("Cotonou");
    expect(citiesFor("SN")).toContain("Dakar");
    expect(citiesFor("BJ")).not.toContain("Dakar");
  });
});
