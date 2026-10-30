import { describe, expect, it } from "vitest";
import { metierIconName, normalizeLabel, resolveLandingTarget, type LandingCategorie } from "./taxonomy-landing";

const m = (id: string, libelle: string) => ({ id, libelle, description: null });
const tree: LandingCategorie[] = [
  {
    id: "dig", libelle: "Digital et Informatique", description: null, icon: "💻",
    metiers: [m("ux", "Design et UX/UI"), m("web", "Développement web")],
  },
  {
    id: "btp", libelle: "BTP et Construction", description: null, icon: "🏗️",
    metiers: [m("elec-btp", "Électricité bâtiment"), m("plomb", "Plomberie")],
  },
  {
    id: "nrj", libelle: "Énergie et Électricité", description: null, icon: "⚡",
    metiers: [m("elec-nrj", "Électricité bâtiment"), m("sol", "Solaire photovoltaïque")],
  },
  {
    id: "art", libelle: "Artisanat", description: null, icon: "🪵",
    metiers: [m("couture", "Couture")],
  },
];

describe("normalizeLabel", () => {
  it("ignore accents, casse, & et ponctuation", () => {
    expect(normalizeLabel("  Design & UX/UI. ")).toBe("design et ux ui");
    expect(normalizeLabel("Électricité")).toBe("electricite");
  });
});

describe("resolveLandingTarget", () => {
  it("un identifiant de métier prime sur le libellé, même homonyme", () => {
    const t = resolveLandingTarget(tree, { metier: "elec-nrj", domaine: "Plomberie" });
    expect(t).toMatchObject({ kind: "metier", categorie: { id: "nrj" }, metier: { id: "elec-nrj" } });
  });

  it("un identifiant de catégorie ouvre la catégorie", () => {
    expect(resolveLandingTarget(tree, { categorie: "btp" })).toMatchObject({ kind: "categorie", categorie: { id: "btp" } });
  });

  it("libellé exact de métier, sans accents ni casse", () => {
    expect(resolveLandingTarget(tree, { domaine: "plomberie" })).toMatchObject({ kind: "metier", metier: { id: "plomb" } });
  });

  it("un mot du libellé suffit : « Design » ouvre « Design et UX/UI »", () => {
    expect(resolveLandingTarget(tree, { domaine: "Design" })).toMatchObject({ kind: "metier", metier: { id: "ux" } });
  });

  it("à précision égale, la catégorie l'emporte sur le métier", () => {
    expect(resolveLandingTarget(tree, { domaine: "Électricité" })).toMatchObject({ kind: "categorie", categorie: { id: "nrj" } });
  });

  it("pas de correspondance sur un fragment de mot ni sur un terme trop court", () => {
    expect(resolveLandingTarget(tree, { domaine: "art" })).toBeNull();
    expect(resolveLandingTarget(tree, { domaine: "ux" })).toBeNull();
  });

  it("aucun paramètre ou terme inconnu : recherche libre", () => {
    expect(resolveLandingTarget(tree, {})).toBeNull();
    expect(resolveLandingTarget(tree, { domaine: "Code" })).toBeNull();
    expect(resolveLandingTarget(tree, { metier: "inconnu" })).toBeNull();
  });
});

describe("metierIconName", () => {
  it("choisit par mot-clé, avec repli", () => {
    expect(metierIconName("Plomberie")).toBe("Droplets");
    expect(metierIconName("Design et UX/UI")).toBe("Palette");
    expect(metierIconName("Inconnu")).toBe("Briefcase");
  });
});
