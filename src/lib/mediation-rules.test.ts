import { describe, expect, it } from "vitest";
import { canOpenMediationAtStatus } from "./mediation-rules";

describe("canOpenMediationAtStatus — une médiation porte sur des fonds engagés, mission non terminée", () => {
  it("autorise les statuts où des fonds sont sous séquestre", () => {
    for (const s of ["fonds_sous_sequestre", "en_cours", "livrable_soumis", "validee"]) {
      expect(canOpenMediationAtStatus(s)).toBe(true);
    }
  });

  it("refuse avant le financement, une fois terminée, et pendant une médiation déjà ouverte", () => {
    for (const s of ["brouillon", "publiee", "proposition_acceptee", "contrat_genere", "contrat_signe", "cloturee", "remboursee", "mediation_ouverte", "annonce_close"]) {
      expect(canOpenMediationAtStatus(s)).toBe(false);
    }
  });
});
