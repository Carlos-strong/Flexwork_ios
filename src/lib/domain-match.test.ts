import { describe, expect, it } from "vitest";
import { normalizeDomain, missionDomainFilter, profileDomainFilter } from "@/lib/domain-match";

describe("normalizeDomain", () => {
  it("retire les espaces de bord et la ponctuation finale", () => {
    // Le cas réel qui a motivé le correctif : un profil saisi « Digital. ».
    expect(normalizeDomain("  Digital. ")).toBe("Digital");
    expect(normalizeDomain("Plomberie,")).toBe("Plomberie");
    expect(normalizeDomain("BTP / ")).toBe("BTP");
  });

  it("laisse intact un libellé déjà propre", () => {
    expect(normalizeDomain("Développement web")).toBe("Développement web");
  });

  it("ne mange pas la ponctuation interne", () => {
    expect(normalizeDomain("Électricité B.T")).toBe("Électricité B.T");
  });
});

describe("missionDomainFilter", () => {
  it("compare partiellement, sans tenir compte de la casse", () => {
    expect(missionDomainFilter("Digital")).toEqual({
      domaine: { contains: "Digital", mode: "insensitive" },
    });
  });

  it("normalise avant de comparer — « Digital. » atteint « Digital »", () => {
    expect(missionDomainFilter("Digital.")).toEqual({
      domaine: { contains: "Digital", mode: "insensitive" },
    });
  });

  it("ne filtre rien quand le profil n'a pas de domaine", () => {
    // Un prestataire au profil incomplet voit TOUTES les missions ouvertes plutôt qu'aucune :
    // l'absence d'information ne doit pas se traduire par un résultat vide.
    expect(missionDomainFilter(null)).toEqual({});
    expect(missionDomainFilter("")).toEqual({});
    expect(missionDomainFilter("   ")).toEqual({});
    expect(missionDomainFilter(".")).toEqual({});
  });
});

describe("profileDomainFilter", () => {
  it("applique la même règle dans l'autre sens", () => {
    expect(profileDomainFilter("Développement web ")).toEqual({
      mainDomain: { contains: "Développement web", mode: "insensitive" },
    });
  });

  it("ne filtre rien sur un domaine de mission vide", () => {
    expect(profileDomainFilter(undefined)).toEqual({});
  });
});
