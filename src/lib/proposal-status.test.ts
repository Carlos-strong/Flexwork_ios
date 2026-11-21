import { describe, expect, it } from "vitest";
import { isRevisionPending, isTerminalProposalStatus, REVISION_REQUESTED_LABEL } from "./proposal-status";

describe("isRevisionPending — drapeau de révision vs statut de la candidature", () => {
  it("une révision demandée sur une candidature encore en négociation est en attente", () => {
    expect(isRevisionPending({ status: "en_negociation", revisionRequestedAt: "2026-09-09T10:00:00Z" })).toBe(true);
    expect(isRevisionPending({ status: "envoyee", revisionRequestedAt: new Date() })).toBe(true);
    expect(isRevisionPending({ status: "preselectionnee", revisionRequestedAt: new Date() })).toBe(true);
  });

  it("sans demande de révision, rien n'est en attente", () => {
    expect(isRevisionPending({ status: "en_negociation", revisionRequestedAt: null })).toBe(false);
    expect(isRevisionPending({ status: "envoyee" })).toBe(false);
  });

  it("le statut terminal prime : une candidature refusée après une demande de révision n'affiche plus « Révision demandée »", () => {
    // Cas réel : le client demande une révision à A, puis retient B — A passe à "refusee".
    expect(isRevisionPending({ status: "refusee", revisionRequestedAt: "2026-09-09T10:00:00Z" })).toBe(false);
  });

  it("idem pour une candidature acceptée ou un devis validé malgré une révision demandée", () => {
    expect(isRevisionPending({ status: "acceptee", revisionRequestedAt: new Date() })).toBe(false);
    expect(isRevisionPending({ status: "devis_valide", revisionRequestedAt: new Date() })).toBe(false);
    expect(isRevisionPending({ status: "annulee_definitive", revisionRequestedAt: new Date() })).toBe(false);
  });

  it("isTerminalProposalStatus couvre les 4 fins de négociation et rien d'autre", () => {
    for (const s of ["acceptee", "devis_valide", "refusee", "annulee_definitive"]) {
      expect(isTerminalProposalStatus(s)).toBe(true);
    }
    for (const s of ["envoyee", "preselectionnee", "en_negociation"]) {
      expect(isTerminalProposalStatus(s)).toBe(false);
    }
  });

  it("le libellé partagé est unique", () => {
    expect(REVISION_REQUESTED_LABEL).toBe("Révision demandée");
  });
});
