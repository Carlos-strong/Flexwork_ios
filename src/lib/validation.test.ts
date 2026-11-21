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

// ── Bornes et devise de la mission (2026-09-23) ───────────────────────────────────────────
// Trois règles vivaient sans se concerter : le `maxLength` du formulaire, les contrôles
// JavaScript du wizard, et ce schéma. La borne HAUTE manquait complètement côté serveur — un
// POST direct pouvait stocker un titre de taille arbitraire — et plusieurs bornes hautes
// tombaient au-delà du plafond d'un INTEGER Postgres : l'insertion levait alors un 500 là où
// un 400 était dû. Ces tests fixent ce que le schéma peut garantir seul. La barre de
// PUBLICATION (10 et 50 caractères) est vérifiée par la route, car ce schéma valide aussi les
// brouillons — voir src/lib/mission-limits.ts.
describe("missionSchema — bornes de saisie", () => {
  it("accepte les quatre devises du catalogue", () => {
    for (const currency of ["XOF", "NGN", "EUR", "USD"]) {
      expect(missionSchema.safeParse({ ...mission, currency }).success).toBe(true);
    }
  });

  it("refuse une devise hors catalogue", () => {
    // `Mission.currency` est une colonne `String`, sans contrainte pour rattraper l'erreur.
    expect(missionSchema.safeParse({ ...mission, currency: "GBP" }).success).toBe(false);
  });

  it("refuse un titre plus long que le champ qui le saisit", () => {
    expect(missionSchema.safeParse({ ...mission, titre: "a".repeat(100) }).success).toBe(true);
    expect(missionSchema.safeParse({ ...mission, titre: "a".repeat(101) }).success).toBe(false);
  });

  it("refuse une description plus longue que le champ qui la saisit", () => {
    expect(missionSchema.safeParse({ ...mission, description: "a".repeat(2000) }).success).toBe(true);
    expect(missionSchema.safeParse({ ...mission, description: "a".repeat(2001) }).success).toBe(false);
  });

  it("refuse un délai au-delà du plafond d'un INTEGER Postgres", () => {
    expect(missionSchema.safeParse({ ...mission, delaiJours: 5_000_000_000 }).success).toBe(false);
    expect(missionSchema.safeParse({ ...mission, delaiJours: 3650 }).success).toBe(true);
  });

  it("refuse une fourchette de budget au-delà du plafond d'un INTEGER Postgres", () => {
    expect(missionSchema.safeParse({ ...mission, budgetMin: 5_000_000_000 }).success).toBe(false);
    expect(missionSchema.safeParse({ ...mission, budgetMax: 5_000_000_000 }).success).toBe(false);
    expect(missionSchema.safeParse({ ...mission, budgetMin: 900_000, budgetMax: 950_000 }).success).toBe(true);
  });

  it("garde des minima de brouillon, pas la barre de publication", () => {
    // Le pendant du durcissement : le schéma valide les BROUILLONS et ne doit donc PAS
    // réclamer 10 et 50 caractères, sinon un client ne pourrait pas enregistrer « Plomberie »
    // à la sortie de l'étape 1. La route applique cette barre à la seule publication.
    expect(missionSchema.safeParse({ ...mission, titre: "abc", description: "Début de saisie." }).success).toBe(true);
  });
});
