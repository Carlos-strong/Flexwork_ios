import { describe, expect, it } from "vitest";
import { allowedProfessionalTypes, isProfessionalTypeAllowed, isSecteur, parseSecteurInput, secteurLabel } from "./secteur";

describe("secteur de la marketplace", () => {
  it("reconnaît les trois pôles et rien d'autre", () => {
    expect(isSecteur("digital")).toBe(true);
    expect(isSecteur("btp")).toBe(true);
    expect(isSecteur("services")).toBe(true);
    expect(isSecteur("BTP")).toBe(false);
    expect(isSecteur("autre")).toBe(false);
    expect(isSecteur(null)).toBe(false);
  });

  it("affiche « Non classée » pour une catégorie sans secteur", () => {
    expect(secteurLabel(null)).toBe("Non classée");
    expect(secteurLabel(undefined)).toBe("Non classée");
    expect(secteurLabel("btp")).toBe("BTP");
  });

  it("distingue clé absente, déclassement explicite et valeur invalide", () => {
    expect(parseSecteurInput(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseSecteurInput(null)).toEqual({ ok: true, value: null });
    expect(parseSecteurInput("")).toEqual({ ok: true, value: null });
    expect(parseSecteurInput("digital")).toEqual({ ok: true, value: "digital" });
    expect(parseSecteurInput("industrie")).toEqual({ ok: false });
    expect(parseSecteurInput(3)).toEqual({ ok: false });
  });
});

describe("types de professionnel admis par secteur", () => {
  it("une mission Digital ne cible ni artisan ni manœuvre", () => {
    expect(allowedProfessionalTypes("digital")).toEqual(["EXPERT_DIGITAL", "EXPERT_BTP"]);
    expect(isProfessionalTypeAllowed("digital", "ARTISAN")).toBe(false);
    expect(isProfessionalTypeAllowed("digital", "MANOEUVRE")).toBe(false);
    expect(isProfessionalTypeAllowed("digital", "EXPERT_BTP")).toBe(true);
  });

  it("BTP et Services admettent les quatre types", () => {
    for (const s of ["btp", "services"]) {
      expect(allowedProfessionalTypes(s)).toHaveLength(4);
      expect(isProfessionalTypeAllowed(s, "MANOEUVRE")).toBe(true);
    }
  });

  it("une catégorie non classée ne restreint rien, et « Indifférent » passe toujours", () => {
    expect(allowedProfessionalTypes(null)).toHaveLength(4);
    expect(isProfessionalTypeAllowed(null, "ARTISAN")).toBe(true);
    expect(isProfessionalTypeAllowed("digital", "")).toBe(true);
    expect(isProfessionalTypeAllowed("digital", undefined)).toBe(true);
  });
});
