import { describe, expect, it } from "vitest";
import { canReviewAtStatus, legitimateReviewTarget, retainedProviderIds } from "./review-rules";

describe("canReviewAtStatus — l'avis conclut une mission terminée", () => {
  it("autorise validee et cloturee", () => {
    expect(canReviewAtStatus("validee")).toBe(true);
    expect(canReviewAtStatus("cloturee")).toBe(true);
  });

  it("refuse tout le reste du cycle", () => {
    for (const s of ["brouillon", "publiee", "proposition_acceptee", "contrat_genere", "contrat_signe", "fonds_sous_sequestre", "en_cours", "livrable_soumis", "mediation_ouverte", ""]) {
      expect(canReviewAtStatus(s)).toBe(false);
    }
  });
});

describe("retainedProviderIds — les deux statuts de proposition retenue", () => {
  it("reconnaît acceptee (prix fixe/taux) et devis_valide (mode devis), ignore le reste", () => {
    const proposals = [
      { status: "envoyee", providerId: "a" },
      { status: "acceptee", providerId: "b" },
      { status: "devis_valide", providerId: "c" },
      { status: "refusee", providerId: "d" },
    ];
    expect(retainedProviderIds(proposals)).toEqual(["b", "c"]);
  });

  it("une mission sans proposition retenue ne produit aucune cible", () => {
    const proposals = [{ status: "envoyee", providerId: "a" }];
    expect(retainedProviderIds(proposals)).toEqual([]);
  });
});

describe("legitimateReviewTarget — seule l'autre partie de la relation acceptée", () => {
  const base = { clientId: "cli", acceptedProviderIds: ["pro"] };

  it("le client note le prestataire retenu", () => {
    expect(legitimateReviewTarget({ ...base, authorId: "cli" })).toEqual(["pro"]);
  });

  it("le prestataire retenu note le client", () => {
    expect(legitimateReviewTarget({ ...base, authorId: "pro" })).toEqual(["cli"]);
  });

  it("un candidat refusé n'a aucune cible", () => {
    expect(legitimateReviewTarget({ ...base, authorId: "refuse" })).toEqual([]);
  });

  it("sans proposition retenue, le client n'a aucune cible", () => {
    expect(legitimateReviewTarget({ authorId: "cli", clientId: "cli", acceptedProviderIds: [] })).toEqual([]);
  });
});

describe("legitimateReviewTarget — parcours devis (QUOTE), devis_valide = partie retenue", () => {
  const base = { clientId: "cli", acceptedProviderIds: ["proDevis"] };

  it("le client peut noter le prestataire retenu par devis validé", () => {
    expect(legitimateReviewTarget({ ...base, authorId: "cli" })).toEqual(["proDevis"]);
  });

  it("le prestataire retenu par devis validé peut noter le client", () => {
    expect(legitimateReviewTarget({ ...base, authorId: "proDevis" })).toEqual(["cli"]);
  });

  it("un candidat refusé sur une mission à devis n'a toujours aucune cible", () => {
    expect(legitimateReviewTarget({ ...base, authorId: "refuse" })).toEqual([]);
  });
});
