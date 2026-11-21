/**
 * Barème de complétion du profil prestataire (2026-09-23).
 *
 * Ce que ces tests verrouillent, parce que c'est ce qui rend le pourcentage honnête et
 * lisible :
 *   - une section vaut son poids ENTIER ou rien (pas de score au prorata) ;
 *   - la somme des poids fait 100, et chacun est celui arbitré (20/30/20/15/15) ;
 *   - aucun point gratuit : `currency`, qui porte une valeur par défaut, est hors barème ;
 *   - « 0 an d'expérience » est une réponse, pas un champ vide — un débutant peut atteindre
 *     100 %.
 */

import { describe, expect, it } from "vitest";
import { computeProviderProfileCompletion, MIN_COMPETENCES, type ProviderProfileCompletionInput } from "./provider-profile-completion";

const complet: ProviderProfileCompletionInput = {
  providerKind: "artisan",
  avatarPath: "avatars/koffi.jpg",
  title: "Électricien certifié",
  description: "Quinze ans d'installation électrique résidentielle et tertiaire à Cotonou.",
  mainDomain: "Électricien",
  tags: ["Câblage", "Tableau électrique", "Prises"],
  declaredExperienceYears: 15,
  experiencesCount: 2,
  diplomasCount: 1,
  zonePays: "BJ",
  zoneVille: "Cotonou",
  zoneRayonKm: 20,
  availability: "temps_plein",
  tarifUnite: "heure",
};

describe("barème", () => {
  it("donne 0 % pour un compte vide, et nomme tout ce qui manque", () => {
    const result = computeProviderProfileCompletion({});
    expect(result.percent).toBe(0);
    expect(result.done).toBe(0);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("atteint 100 % sur un profil complet", () => {
    expect(computeProviderProfileCompletion(complet).percent).toBe(100);
    expect(computeProviderProfileCompletion(complet).missing).toEqual([]);
  });

  it("porte les poids arbitrés, et leur somme fait exactement 100", () => {
    const { sections } = computeProviderProfileCompletion({});
    expect(sections.map((s) => [s.key, s.weight])).toEqual([
      ["presentation", 20],
      ["domaines", 30],
      ["experience", 20],
      ["localisation", 15],
      ["configuration", 15],
    ]);
    expect(sections.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
  });

  it("ne donne RIEN pour une section partielle — pas de score au prorata", () => {
    // Présentation à 3 critères sur 4 (bio trop courte) : 0 %, pas 15 %.
    const result = computeProviderProfileCompletion({ ...complet, description: "Bonjour" });
    expect(result.percent).toBe(80);
    expect(result.sections.find((s) => s.key === "presentation")?.done).toBe(false);
  });

  it("exige une bio d'au moins 40 caractères — « Bonjour » n'est pas une présentation", () => {
    const court = computeProviderProfileCompletion({ ...complet, description: "x".repeat(39) });
    const juste = computeProviderProfileCompletion({ ...complet, description: "x".repeat(40) });
    expect(court.percent).toBe(80);
    expect(juste.percent).toBe(100);
  });

  it(`exige ${MIN_COMPETENCES} compétences, pas moins`, () => {
    const deux = computeProviderProfileCompletion({ ...complet, tags: ["Câblage", "Prises"] });
    expect(deux.percent).toBe(70);
    expect(deux.missing).toContain(`Au moins ${MIN_COMPETENCES} compétences`);
  });

  it("ignore les compétences vides ou blanches — elles ne comptent pas comme déclarées", () => {
    const result = computeProviderProfileCompletion({ ...complet, tags: ["Câblage", "Prises", "   "] });
    expect(result.percent).toBe(70);
  });

  it("accepte « 0 an d'expérience » : un débutant n'est pas un profil vide", () => {
    const debutant = computeProviderProfileCompletion({ ...complet, declaredExperienceYears: 0 });
    expect(debutant.percent).toBe(100);
  });

  it("distingue « 0 an » de « non renseigné »", () => {
    const result = computeProviderProfileCompletion({ ...complet, declaredExperienceYears: null });
    expect(result.percent).toBe(80);
    expect(result.missing).toContain("Années d'expérience");
  });

  it("refuse un rayon de 0 km — ce n'est pas une zone d'intervention", () => {
    const result = computeProviderProfileCompletion({ ...complet, zoneRayonKm: 0 });
    expect(result.percent).toBe(85);
    expect(result.missing).toContain("Rayon d'intervention");
  });

  it("ne compte pas DU TOUT la devise, qui a une valeur par défaut", () => {
    // Le défaut XOF est toujours présent : s'il comptait, la section Configuration serait
    // à moitié offerte à un compte neuf, et l'unité de tarif n'y changerait plus rien.
    const result = computeProviderProfileCompletion({ ...complet, tarifUnite: null });
    expect(result.percent).toBe(85);
    expect(result.missing).toEqual(["Unité de tarif"]);
  });

  it("n'exige pas les modes de travail ni les zones couvertes — hors barème", () => {
    // Présents dans l'onglet Localisation, ils restent facultatifs : exiger un champ
    // facultatif le rendrait obligatoire par la bande.
    const { sections } = computeProviderProfileCompletion(complet);
    const localisation = sections.find((s) => s.key === "localisation")!;
    expect(localisation.items.map((i) => i.key)).toEqual(["zonePays", "zoneVille", "zoneRayonKm", "disponibilite"]);
  });

  it("compte les sections complètes pour le « x/y » de la carte", () => {
    const result = computeProviderProfileCompletion({ ...complet, tarifUnite: null, availability: null });
    expect(result.done).toBe(3);
    expect(result.total).toBe(5);
    expect(result.percent).toBe(70);
  });

  it("traite les chaînes blanches comme non renseignées", () => {
    const result = computeProviderProfileCompletion({ ...complet, title: "   ", mainDomain: "" });
    expect(result.percent).toBe(50);
  });
});
