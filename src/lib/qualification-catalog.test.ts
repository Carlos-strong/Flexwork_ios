import { describe, expect, it } from "vitest";
import {
  DIPLOMA_LEVELS,
  cleanSpecialty,
  diplomaTitle,
  normalizeSpecialty,
  specialtySuggestions,
} from "./qualification-catalog";

describe("niveaux de diplôme", () => {
  it("sont exactement les sept niveaux retenus, dans l'ordre", () => {
    expect(DIPLOMA_LEVELS.map((l) => l.value)).toEqual([
      "CAP",
      "DT",
      "DUT",
      "BTS",
      "Licence professionnelle",
      "Ingénieur",
      "Master professionnel",
    ]);
  });

  it("composent l'intitulé avec la spécialité saisie", () => {
    expect(diplomaTitle("BTS", "  génie   civil ")).toBe("BTS Génie civil");
    expect(diplomaTitle("Ingénieur", "génie civil")).toBe("Ingénieur en Génie civil");
    expect(diplomaTitle("CAP", "")).toBe("CAP");
  });
});

describe("spécialités", () => {
  it("une seule clé quelle que soit la graphie", () => {
    const k = normalizeSpecialty("Génie civil");
    expect(normalizeSpecialty("genie civil")).toBe(k);
    expect(normalizeSpecialty("  GÉNIE   CIVIL. ")).toBe(k);
    expect(normalizeSpecialty("   ")).toBe("");
  });

  it("garde la graphie saisie, première lettre en majuscule", () => {
    expect(cleanSpecialty("électricité bâtiment")).toBe("Électricité bâtiment");
    expect(cleanSpecialty("BTP")).toBe("BTP");
  });

  it("suggère d'abord le domaine, sans doublon", () => {
    const out = specialtySuggestions({
      categorieId: "btp",
      metiers: ["Plomberie", "Maçonnerie"],
      saved: [
        { libelle: "Comptabilité", categorieId: "gestion" },
        { libelle: "Génie civil", categorieId: "btp" },
        { libelle: "plomberie", categorieId: null },
      ],
    });
    expect(out).toEqual(["Génie civil", "Plomberie", "Maçonnerie", "Comptabilité"]);
  });
});
