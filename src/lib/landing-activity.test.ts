import { describe, expect, it } from "vitest";
import { rankDomainsByActivity, type LandingActivity } from "@/lib/landing-activity";
import type { LandingCategorie } from "@/lib/taxonomy-landing";

const metier = (id: string, libelle: string) => ({ id, libelle, description: null });
const TREE: LandingCategorie[] = [
  { id: "c-energie", libelle: "Énergie et Électricité", description: null, icon: "⚡", metiers: [metier("m-elec", "Électricité bâtiment")] },
  { id: "c-design", libelle: "Design", description: null, icon: "🎨", metiers: [metier("m-logo", "Logo")] },
  { id: "c-artisanat", libelle: "Artisanat", description: null, icon: "🧵", metiers: [metier("m-couture", "Couture"), metier("m-poterie", "Poterie")] },
  { id: "c-btp", libelle: "BTP", description: null, icon: "🧱", metiers: [metier("m-macon", "Maçonnerie")] },
];
const ITEMS = [{ label: "Design" }, { label: "Code" }, { label: "Maçonnerie" }, { label: "Électricité" }];
const labels = (items: { label: string }[]) => items.map((i) => i.label);
const mission = (categorieId: string | null, metierId: string | null, count = 1, domaine = ""): LandingActivity => ({ categorieId, metierId, domaine, count });

describe("domaines de l'accueil classés par activité publiée", () => {
  it("sans aucune publication, rend la liste de l'éditeur à l'identique", () => {
    expect(rankDomainsByActivity(ITEMS, TREE, [])).toEqual(ITEMS);
  });

  it("une entrée dont la catégorie ou le métier a des publications passe devant ; l'ordre de l'éditeur départage", () => {
    const ranked = rankDomainsByActivity(ITEMS, TREE, [mission("c-btp", "m-macon", 2), mission("c-energie", "m-elec", 2)]);
    expect(labels(ranked)).toEqual(["Maçonnerie", "Électricité", "Design", "Code"]);
  });

  it("un domaine actif sans entrée est ajouté en tête, lien par identifiant, icône de sa catégorie", () => {
    const ranked = rankDomainsByActivity(ITEMS, TREE, [mission("c-artisanat", "m-couture")]);
    expect(ranked[0]).toEqual({ label: "Couture", sublabel: "Couture", href: "/recherche?metier=m-couture", icon: "🧵" });
    // Longueur conservée : la dernière entrée sans activité cède sa place.
    expect(labels(ranked)).toEqual(["Couture", "Design", "Code", "Maçonnerie"]);
  });

  it("le plus actif d'abord ; à égalité, l'entrée de l'éditeur avant l'entrée ajoutée", () => {
    const ranked = rankDomainsByActivity(ITEMS, TREE, [
      mission("c-artisanat", "m-couture", 1),
      mission("c-artisanat", "m-poterie", 3),
      mission("c-design", "m-logo", 1),
    ]);
    expect(labels(ranked)).toEqual(["Poterie", "Design", "Couture", "Code"]);
  });

  it("une entrée qui couvre la catégorie absorbe ses métiers : pas de doublon ajouté", () => {
    const ranked = rankDomainsByActivity([{ label: "Artisanat" }, { label: "Code" }], TREE, [mission("c-artisanat", "m-couture", 2)]);
    expect(labels(ranked)).toEqual(["Artisanat", "Code"]);
  });

  it("missions anciennes et Gigs sans identifiant : rattachés par leur libellé ; libellé inconnu ignoré", () => {
    const ranked = rankDomainsByActivity(ITEMS, TREE, [
      mission(null, null, 2, "Électricité bâtiment"),
      mission(null, null, 5, "expert_digital"),
    ]);
    expect(labels(ranked)).toEqual(["Électricité", "Design", "Code", "Maçonnerie"]);
  });

  it("« Services populaires » rapproche sur le domaine visé (sublabel), pas sur le libellé affiché", () => {
    const vignettes = [{ label: "Design & Identité", sublabel: "Design" }, { label: "Chantiers", sublabel: "Maçonnerie" }];
    const ranked = rankDomainsByActivity(vignettes, TREE, [mission("c-btp", "m-macon")], (s) => s.sublabel ?? s.label);
    expect(labels(ranked)).toEqual(["Chantiers", "Design & Identité"]);
  });
});
