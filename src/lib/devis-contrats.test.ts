import { describe, expect, it } from "vitest";
import { devisBucket, contratBucket, devisVisibleInList } from "./devis-contrats";

describe("devisBucket", () => {
  it("candidature envoyée sans devis chiffré -> brouillon", () => {
    expect(devisBucket("envoyee", false, "publiee")).toBe("brouillon");
    expect(devisBucket("preselectionnee", false, "publiee")).toBe("brouillon");
  });

  it("devis chiffré déjà soumis -> en négociation, même sur un statut envoyee/preselectionnee", () => {
    expect(devisBucket("envoyee", true, "publiee")).toBe("negociation");
    expect(devisBucket("en_negociation", true, "publiee")).toBe("negociation");
    expect(devisBucket("en_negociation", false, "publiee")).toBe("negociation");
  });

  it("devis validé ou candidature acceptée -> valide", () => {
    expect(devisBucket("devis_valide", true, "proposition_acceptee")).toBe("valide");
    expect(devisBucket("acceptee", true, "contrat_genere")).toBe("valide");
  });

  it("refusé ou négociation annulée -> rejete", () => {
    expect(devisBucket("refusee", true, "publiee")).toBe("rejete");
    expect(devisBucket("annulee_definitive", true, "publiee")).toBe("rejete");
  });

  // Symétrie voulue avec contratBucket : l'état TERMINAL de la mission prime sur celui de
  // la proposition. Une mission clôturée ferme TOUS ses devis, y compris ceux qu'aucune
  // décision explicite n'avait clos (propositions non retenues, restées en négociation).
  it("mission clôturée -> cloture, quel que soit le statut de la proposition", () => {
    expect(devisBucket("en_negociation", true, "cloturee")).toBe("cloture");
    expect(devisBucket("envoyee", false, "cloturee")).toBe("cloture");
    expect(devisBucket("devis_valide", true, "cloturee")).toBe("cloture");
    expect(devisBucket("refusee", true, "cloturee")).toBe("cloture");
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

describe("devisVisibleInList", () => {
  it("sans contrat -> toujours listé dans Mes Devis", () => {
    expect(devisVisibleInList({ hasContract: false, missionStatus: "en_cours" })).toBe(true);
    expect(devisVisibleInList({ hasContract: false, missionStatus: "cloturee" })).toBe(true);
  });

  it("avec contrat sur mission en cours -> masqué (vit dans Contrats Signés)", () => {
    expect(devisVisibleInList({ hasContract: true, missionStatus: "contrat_signe" })).toBe(false);
    expect(devisVisibleInList({ hasContract: true, missionStatus: "fonds_sous_sequestre" })).toBe(false);
    expect(devisVisibleInList({ hasContract: true, missionStatus: "en_cours" })).toBe(false);
    expect(devisVisibleInList({ hasContract: true, missionStatus: "validee" })).toBe(false);
  });

  // Exception voulue : la mission clôturée rouvre la rubrique « Clôturés » des devis ;
  // sans elle, les devis déjà clôturés (qui portent tous un contrat) resteraient invisibles.
  it("avec contrat sur mission clôturée -> listé sous Clôturés", () => {
    expect(devisVisibleInList({ hasContract: true, missionStatus: "cloturee" })).toBe(true);
  });
});
