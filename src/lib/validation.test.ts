/**
 * Intégralité monétaire au POINT D'ENTRÉE (2026-09-14).
 *
 * Le XOF n'a pas de sous-unité en circulation et le PSP Mobile Money refuse une instruction
 * décimale. Deux familles de montants entrent dans le système, et elles ne sont pas traitées
 * pareil — délibérément :
 *
 *   - les montants CALCULÉS (devis) sont arrondis à l'unité par `computeDevisData` : le
 *     prestataire peut saisir un prix unitaire décimal, le total est ramené au franc ;
 *   - les montants ENGAGEANTS (proposition, offre, budget) sont REFUSÉS s'ils ne sont pas
 *     entiers. Ils deviennent tels quels le prix du contrat, sans étape de calcul qui pourrait
 *     les arrondir — et arrondir en silence un prix sur lequel deux parties s'engagent le
 *     ferait changer entre la saisie et la signature.
 */

import { describe, expect, it } from "vitest";
import { missionSchema, offerSchema, proposalSchema } from "@/lib/validation";

const mission = {
  titre: "Villa R+1",
  description: "Construction d'une villa R+1 à Cotonou",
  domaine: "batiment",
  delaiJours: 45,
};

describe("montants engageants — entiers exigés", () => {
  it("une proposition à montant entier est acceptée", () => {
    expect(proposalSchema.safeParse({ montant: 487_000 }).success).toBe(true);
  });

  it("une proposition à montant décimal est REFUSÉE, jamais arrondie en silence", () => {
    expect(proposalSchema.safeParse({ montant: 1234.56 }).success).toBe(false);
  });

  it("le montant nul reste permis — mode devis, le prix viendra du devis", () => {
    expect(proposalSchema.safeParse({ montant: 0 }).success).toBe(true);
  });

  it("un budget de mission décimal est refusé", () => {
    expect(missionSchema.safeParse({ ...mission, budget: 450_000 }).success).toBe(true);
    expect(missionSchema.safeParse({ ...mission, budget: 450_000.5 }).success).toBe(false);
  });

  it("un budget absent reste permis — brouillon, ou mission sur devis", () => {
    expect(missionSchema.safeParse(mission).success).toBe(true);
  });

  it("une offre et ses jalons exigent des entiers", () => {
    const base = { titre: "Offre villa", description: "Offre détaillée pour la villa R+1" };
    expect(offerSchema.safeParse({ ...base, montant: 487_000 }).success).toBe(true);
    expect(offerSchema.safeParse({ ...base, montant: 487_000.25 }).success).toBe(false);
    expect(
      offerSchema.safeParse({
        ...base,
        montant: 487_000,
        milestones: [{ ordre: 0, description: "Fondations", montant: 180_000.75 }],
      }).success
    ).toBe(false);
  });
});
