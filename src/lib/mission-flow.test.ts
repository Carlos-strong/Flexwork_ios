import { describe, expect, it } from "vitest";
import { missionFlow, MISSION_FLOW_STEPS } from "./mission-flow";

const M = "m1";

describe("missionFlow — Offre acceptée → Signature → Financement → Pilotage", () => {
  it("expose les quatre étapes dans l'ordre du cycle applicatif", () => {
    expect(MISSION_FLOW_STEPS.map((s) => s.id)).toEqual(["offre", "signature", "financement", "pilotage"]);
  });

  it("candidature retenue : l'offre est faite, la signature est l'étape courante", () => {
    const f = missionFlow(M, "proposition_acceptee");
    expect(f.steps[0]).toMatchObject({ id: "offre", done: true, current: false });
    expect(f.steps[1]).toMatchObject({ id: "signature", current: true });
    expect(f.cta).toEqual({ label: "Générer le contrat", href: "/missions/m1/contract" });
  });

  it("contrat généré : toujours l'étape signature, mais l'action change", () => {
    const f = missionFlow(M, "contrat_genere");
    expect(f.steps[1].current).toBe(true);
    expect(f.cta?.href).toBe("/missions/m1/contract");
    expect(f.cta?.label).toBe("Ouvrir la signature");
  });

  it("contrat signé : l'étape courante devient le financement du séquestre", () => {
    const f = missionFlow(M, "contrat_signe");
    expect(f.steps[1].done).toBe(true);
    expect(f.steps[2]).toMatchObject({ id: "financement", current: true });
    expect(f.cta).toEqual({ label: "Financer le séquestre", href: "/missions/m1/escrow" });
  });

  it("fonds séquestrés : on passe au pilotage des jalons, sur la page mission", () => {
    const f = missionFlow(M, "fonds_sous_sequestre");
    expect(f.steps[3]).toMatchObject({ id: "pilotage", current: true });
    expect(f.cta).toEqual({ label: "Piloter les jalons", href: "/missions/m1" });
  });

  it("travail engagé et livrable soumis restent sur l'étape pilotage", () => {
    for (const s of ["en_cours", "livrable_soumis"]) {
      const f = missionFlow(M, s);
      expect(f.steps[3].current).toBe(true);
      expect(f.cta?.label).toBe("Piloter les jalons");
    }
  });

  it("mission clôturée : les quatre étapes sont faites, plus aucune action à pousser", () => {
    const f = missionFlow(M, "cloturee");
    expect(f.steps.every((s) => s.done)).toBe(true);
    expect(f.steps.some((s) => s.current)).toBe(false);
    expect(f.cta).toEqual({ label: "Voir la mission", href: "/missions/m1" });
  });

  it("avant toute acceptation, aucune étape n'est engagée et aucune action n'est proposée", () => {
    const f = missionFlow(M, "publiee");
    expect(f.steps[0]).toMatchObject({ done: false, current: true });
    expect(f.cta).toBeNull();
  });

  it("un statut inconnu ou absent ne casse pas la vue", () => {
    expect(missionFlow(M, null).cta).toBeNull();
    expect(missionFlow(M, "statut_inexistant").steps).toHaveLength(4);
  });
});
