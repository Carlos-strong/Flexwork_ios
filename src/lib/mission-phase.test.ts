import { describe, expect, it } from "vitest";
import { nextAction, phaseOf, phaseSummary } from "./mission-phase";

describe("phaseOf", () => {
  it("traduit les statuts en étapes de suivi", () => {
    expect(phaseOf("publiee")).toBe("recrutement");
    expect(phaseOf("proposition_acceptee")).toBe("contrat");
    expect(phaseOf("contrat_genere")).toBe("contrat");
    expect(phaseOf("contrat_signe")).toBe("financement");
    expect(phaseOf("fonds_sous_sequestre")).toBe("en_cours");
    expect(phaseOf("livrable_soumis")).toBe("a_valider");
    expect(phaseOf("mediation_ouverte")).toBe("litige");
    expect(phaseOf("cloturee")).toBe("terminee");
    expect(phaseOf("annonce_close")).toBe("close");
  });
  it("un jalon soumis met une mission en cours « à valider »", () => {
    expect(phaseOf("en_cours", true)).toBe("a_valider");
  });
});

describe("nextAction", () => {
  it("prend l'action la plus urgente des engagements", () => {
    const a = nextAction({ id: "clim", phase: "recrutement", pendingCandidatures: 1 }, [
      { id: "e1", phase: "en_cours" },
      { id: "e2", phase: "contrat" },
      { id: "e3", phase: "a_valider" },
    ]);
    expect(a).toEqual({ label: "Valider le livrable", href: "/missions/e3", priority: 1 });
  });
  it("sinon, pendant le recrutement : examiner les candidatures", () => {
    expect(nextAction({ id: "clim", phase: "recrutement", pendingCandidatures: 2 }, [])?.href).toBe("/missions/clim/proposals");
    expect(nextAction({ id: "clim", phase: "recrutement", pendingCandidatures: 0 }, [])).toBeNull();
  });
  it("contrat à signer et séquestre à financer mènent à leur page", () => {
    expect(nextAction({ id: "m", phase: "contrat", pendingCandidatures: 0 }, [])?.href).toBe("/missions/m/contract");
    expect(nextAction({ id: "m", phase: "financement", pendingCandidatures: 0 }, [])?.href).toBe("/missions/m/escrow");
  });
});

describe("phaseSummary", () => {
  it("compte les engagements par phase, les plus urgentes d'abord", () => {
    expect(phaseSummary(["en_cours", "contrat", "en_cours"])).toEqual([
      { phase: "contrat", count: 1 },
      { phase: "en_cours", count: 2 },
    ]);
  });
});
