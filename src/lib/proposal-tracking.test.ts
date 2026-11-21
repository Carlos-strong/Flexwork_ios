import { describe, expect, it } from "vitest";
import { proposalBadge, proposalBaseStatus, summarizeProposals, trackProposal, TRACKING_STEPS } from "@/lib/proposal-tracking";

// État et suivi d'une candidature (2026-11-09) : une règle pour le tableau de bord et les
// rubriques « Mes candidatures » / « Propositions ».
const p = (status: string, missionStatus = "publiee", extra: { revisionRequestedAt?: string | null; roundActuel?: number } = {}) => ({
  status,
  mission: { status: missionStatus },
  ...extra,
});

describe("badge et statut de base", () => {
  it("« Envoyée » côté prestataire, « Reçue » côté client", () => {
    expect(proposalBadge(p("envoyee"), "provider")).toBe("Envoyée");
    expect(proposalBadge(p("envoyee"), "client")).toBe("Reçue");
    expect(proposalBaseStatus(p("envoyee"), "client")).toBe("Reçue");
  });

  it("une candidature retenue suit l'avancement réel de la mission", () => {
    expect(proposalBadge(p("acceptee", "proposition_acceptee"), "provider")).toBe("Acceptée");
    expect(proposalBadge(p("acceptee", "contrat_signe"), "provider")).toBe("Contrat signé");
    expect(proposalBadge(p("devis_valide", "fonds_sous_sequestre"), "client")).toBe("Fonds séquestrés");
    expect(proposalBadge(p("acceptee", "cloturee"), "client")).toBe("Terminée");
    // …mais reste « En négociation » / « Acceptée » dans les filtres (statut de base).
    expect(proposalBaseStatus(p("devis_valide"), "provider")).toBe("En négociation");
    expect(proposalBaseStatus(p("acceptee"), "provider")).toBe("Acceptée");
  });

  it("révision demandée : annoncée tant que la candidature n'est pas close", () => {
    const at = new Date().toISOString();
    expect(proposalBadge(p("en_negociation", "publiee", { revisionRequestedAt: at }), "provider")).toBe("Révision demandée");
    expect(proposalBadge(p("refusee", "publiee", { revisionRequestedAt: at }), "provider")).toBe("Refusée");
  });

  it("statut inconnu : repli identique à l'ancien comportement de chaque vue", () => {
    expect(proposalBaseStatus(p("inconnu"), "provider")).toBe("En négociation");
    expect(proposalBaseStatus(p("inconnu"), "client")).toBe("Reçue");
  });
});

describe("suivi : étape et prochaine action", () => {
  it("nouvelle candidature : le client doit l'examiner, le prestataire attend", () => {
    expect(trackProposal(p("envoyee"), "client")).toMatchObject({ step: 0, group: "en_attente", actionRequired: true });
    expect(trackProposal(p("envoyee"), "provider")).toMatchObject({ step: 0, group: "en_attente", actionRequired: false });
  });

  it("révision demandée : c'est au prestataire d'agir", () => {
    const r = p("en_negociation", "publiee", { revisionRequestedAt: new Date().toISOString() });
    expect(trackProposal(r, "provider")).toMatchObject({ step: 1, actionRequired: true });
    expect(trackProposal(r, "client")).toMatchObject({ step: 1, actionRequired: false });
  });

  it("négociation : la version en cours est indiquée", () => {
    expect(trackProposal(p("en_negociation", "publiee", { roundActuel: 2 }), "provider").next).toContain("version 3");
  });

  it("parcours d'une candidature retenue, avec qui doit agir à chaque étape", () => {
    expect(trackProposal(p("acceptee", "proposition_acceptee"), "provider")).toMatchObject({ step: 2, group: "retenue" });
    expect(trackProposal(p("acceptee", "contrat_genere"), "provider")).toMatchObject({ step: 3, actionRequired: true });
    expect(trackProposal(p("acceptee", "contrat_signe"), "client")).toMatchObject({ step: 3, actionRequired: true });
    expect(trackProposal(p("acceptee", "contrat_signe"), "provider")).toMatchObject({ step: 3, actionRequired: false });
    expect(trackProposal(p("acceptee", "fonds_sous_sequestre"), "provider")).toMatchObject({ step: 4, actionRequired: true });
    expect(trackProposal(p("acceptee", "livrable_soumis"), "client")).toMatchObject({ step: 4, actionRequired: true });
    expect(trackProposal(p("acceptee", "cloturee"), "provider")).toMatchObject({ step: TRACKING_STEPS.length - 1, actionRequired: false });
  });

  it("refusée ou annulée : close, hors parcours", () => {
    expect(trackProposal(p("refusee"), "provider")).toMatchObject({ step: -1, group: "close", next: "Non retenue pour cette mission." });
    expect(trackProposal(p("annulee_definitive"), "client")).toMatchObject({ step: -1, group: "close" });
  });
});

describe("répartition du tableau de bord", () => {
  it("compte chaque état et les actions attendues", () => {
    const list = [
      p("envoyee"),
      p("envoyee"),
      p("preselectionnee"),
      p("en_negociation", "publiee", { revisionRequestedAt: new Date().toISOString() }),
      p("acceptee", "contrat_genere"),
      p("refusee"),
    ];
    expect(summarizeProposals(list, "provider")).toEqual({
      total: 6,
      en_attente: 2,
      en_discussion: 2,
      retenue: 1,
      close: 1,
      actionRequired: 2, // révision demandée + contrat à signer
    });
    expect(summarizeProposals(list, "client").actionRequired).toBe(4); // 2 à examiner + présélection + contrat
  });
});
