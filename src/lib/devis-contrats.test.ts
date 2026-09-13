import { describe, expect, it } from "vitest";
import { devisBucket, contratBucket } from "./devis-contrats";

describe("devisBucket", () => {
  it("candidature envoyée sans devis chiffré -> brouillon", () => {
    expect(devisBucket("envoyee", false)).toBe("brouillon");
    expect(devisBucket("preselectionnee", false)).toBe("brouillon");
  });

  it("devis chiffré déjà soumis -> en négociation, même sur un statut envoyee/preselectionnee", () => {
    expect(devisBucket("envoyee", true)).toBe("negociation");
    expect(devisBucket("en_negociation", true)).toBe("negociation");
    expect(devisBucket("en_negociation", false)).toBe("negociation");
  });

  it("devis validé ou candidature acceptée -> valide", () => {
    expect(devisBucket("devis_valide", true)).toBe("valide");
    expect(devisBucket("acceptee", true)).toBe("valide");
  });

  it("refusé ou négociation annulée -> rejete", () => {
    expect(devisBucket("refusee", true)).toBe("rejete");
    expect(devisBucket("annulee_definitive", true)).toBe("rejete");
  });
});

describe("contratBucket", () => {
  it("cloturee -> cloture", () => {
    expect(contratBucket("cloturee")).toBe("cloture");
  });

  it("tout autre statut de mission -> en_cours", () => {
    expect(contratBucket("contrat_signe")).toBe("en_cours");
    expect(contratBucket("fonds_sous_sequestre")).toBe("en_cours");
    expect(contratBucket("en_cours")).toBe("en_cours");
    expect(contratBucket("mediation_ouverte")).toBe("en_cours");
  });
});
