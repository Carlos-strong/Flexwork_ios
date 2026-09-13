import { describe, expect, it } from "vitest";
import { stepIndexFor } from "./contract-stepper";

describe("stepIndexFor", () => {
  it("étape 0 (Contrat) — aucun contrat généré", () => {
    expect(stepIndexFor("none", null)).toBe(0);
  });

  it("étape 1 (Signature) — contrat généré, aucune signature", () => {
    expect(stepIndexFor({ clientSignedAt: null, providerSignedAt: null }, "contrat_genere")).toBe(1);
  });

  it("étape 1 (Signature) — une seule des deux signatures posée", () => {
    expect(stepIndexFor({ clientSignedAt: "2026-08-01T10:00:00Z", providerSignedAt: null }, "contrat_genere")).toBe(1);
  });

  it("étape 2 (Financement) — double signature, fonds pas encore sous séquestre", () => {
    expect(
      stepIndexFor({ clientSignedAt: "2026-08-01T10:00:00Z", providerSignedAt: "2026-08-02T10:00:00Z" }, "contrat_signe")
    ).toBe(2);
  });

  it.each(["fonds_sous_sequestre", "en_cours", "livrable_soumis"])(
    "étape 3 (Pilotage) — mission.status=%s après double signature",
    (status) => {
      expect(
        stepIndexFor({ clientSignedAt: "2026-08-01T10:00:00Z", providerSignedAt: "2026-08-02T10:00:00Z" }, status)
      ).toBe(3);
    }
  );

  it.each(["validee", "cloturee"])("étape 4 (Clôture) — mission.status=%s", (status) => {
    expect(
      stepIndexFor({ clientSignedAt: "2026-08-01T10:00:00Z", providerSignedAt: "2026-08-02T10:00:00Z" }, status)
    ).toBe(4);
  });
});
