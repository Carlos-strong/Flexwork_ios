/**
 * Barème de complétion du profil client (2026-09-23).
 *
 * Ce que ces tests verrouillent, parce que c'est ce qui rend le pourcentage honnête :
 *   - aucun point gratuit (la devise, qui a une valeur par défaut, est hors barème) ;
 *   - un dénominateur variable (un particulier n'est pas plafonné à 80 % faute d'avoir une
 *     organisation et un secteur d'activité) ;
 *   - 100 % atteignable pour chaque type de client.
 */

import { describe, expect, it } from "vitest";
import { computeClientProfileCompletion } from "./client-profile-completion";

// Ce que l'inscription renseigne déjà : identité, contact, pays/ville.
const justSignedUp = {
  firstname: "Koffi",
  lastname: "Adjovi",
  email: "koffi@flexwork.test",
  tel: "+22996123456",
  country: "BJ",
  city: "Cotonou",
};

const particulierComplet = {
  ...justSignedUp,
  avatarPath: "avatars/koffi.jpg",
  address: "Rue 12.34, maison Adjovi",
  profession: "Directeur d'exploitation",
  clientType: "particulier",
  languages: ["Français", "Fon"],
};

describe("barème", () => {
  it("part de 38 % au sortir de l'inscription — ni 0 %, ni un score flatteur", () => {
    const result = computeClientProfileCompletion(justSignedUp);
    expect(result.done).toBe(3);
    expect(result.total).toBe(8);
    expect(result.percent).toBe(38);
  });

  it("ne compte rien pour un compte vide", () => {
    expect(computeClientProfileCompletion({}).percent).toBe(0);
  });

  it("nomme précisément ce qui manque, pour que l'UI n'ait pas à le deviner", () => {
    const { missing } = computeClientProfileCompletion(justSignedUp);
    expect(missing.map((m) => m.key)).toEqual(["photo", "adresse", "profession", "type_client", "langues"]);
  });

  it("ignore les chaînes vides et les espaces — un champ blanc n'est pas rempli", () => {
    const result = computeClientProfileCompletion({ ...justSignedUp, profession: "   ", address: "" });
    expect(result.done).toBe(3);
  });

  it("exige les deux moitiés d'un item composé", () => {
    expect(computeClientProfileCompletion({ firstname: "Koffi" }).done).toBe(0);
    expect(computeClientProfileCompletion({ firstname: "Koffi", lastname: "Adjovi" }).done).toBe(1);
  });

  it("ne donne aucun point pour une liste de langues vide", () => {
    expect(computeClientProfileCompletion({ ...justSignedUp, languages: [] }).done).toBe(3);
    expect(computeClientProfileCompletion({ ...justSignedUp, languages: ["Français"] }).done).toBe(4);
  });
});

describe("dénominateur variable selon le type de client", () => {
  it("laisse un particulier atteindre 100 % sans organisation ni secteur", () => {
    const result = computeClientProfileCompletion(particulierComplet);
    expect(result.total).toBe(8);
    expect(result.percent).toBe(100);
  });

  it("réclame organisation et secteur à une entreprise", () => {
    const result = computeClientProfileCompletion({ ...particulierComplet, clientType: "entreprise" });
    expect(result.total).toBe(10);
    expect(result.percent).toBe(80);
    expect(result.missing.map((m) => m.key)).toEqual(["organisation", "secteur"]);
  });

  it("applique la même règle aux associations et aux administrations", () => {
    for (const clientType of ["association", "administration"]) {
      const result = computeClientProfileCompletion({ ...particulierComplet, clientType });
      expect(result.total, clientType).toBe(10);
    }
  });

  it("permet à une entreprise renseignée d'atteindre 100 %", () => {
    const result = computeClientProfileCompletion({
      ...particulierComplet,
      clientType: "entreprise",
      company: "SOBEBRA",
      sector: "Industrie et manufacture",
    });
    expect(result.percent).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it("ne réclame pas encore l'organisation tant que le type n'est pas choisi", () => {
    const result = computeClientProfileCompletion({ ...particulierComplet, clientType: undefined });
    expect(result.total).toBe(8);
    expect(result.missing.map((m) => m.key)).toEqual(["type_client"]);
  });
});

describe("pas de point gratuit", () => {
  it("n'accorde aucun point à la devise, qui a une valeur par défaut", () => {
    // `currency` n'est volontairement pas un champ d'entrée : le compter reviendrait à
    // afficher un pourcentage que l'utilisateur n'a jamais gagné.
    const withCurrency = computeClientProfileCompletion({ ...justSignedUp, ...{ currency: "XOF" } });
    expect(withCurrency.percent).toBe(38);
  });

  it("borne le pourcentage à 100 et ne le dépasse jamais", () => {
    const result = computeClientProfileCompletion({
      ...particulierComplet,
      clientType: "entreprise",
      company: "SOBEBRA",
      sector: "Industrie et manufacture",
      languages: ["Français", "Anglais", "Fon", "Yoruba"],
    });
    expect(result.percent).toBe(100);
    expect(result.done).toBe(result.total);
  });
});
