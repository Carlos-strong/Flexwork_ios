/**
 * État financier d'un contrat (§3 du cahier des charges) — fonction PURE.
 *
 * Testée seule, sans base : c'est une lecture des soldes, et ce qui compte est qu'elle soit
 * TOTALE (aucune combinaison de soldes ne reste sans état) et qu'elle ne mente jamais — un
 * contrat où le prestataire attend encore ne doit pas s'afficher « totalement libéré ».
 */

import { describe, expect, it } from "vitest";
import { escrowFinancialState } from "@/lib/escrow-state";

const balance = (over: Partial<Parameters<typeof escrowFinancialState>[0]> = {}) => ({
  funded: 0,
  released: 0,
  held: 0,
  releasable: 0,
  fundingPending: false,
  ...over,
});

describe("escrowFinancialState", () => {
  it("rien versé, rien en route : non financé", () => {
    expect(escrowFinancialState(balance(), "contrat_signe")).toBe("non_finance");
  });

  it("un débit transmis mais pas confirmé : financement en attente", () => {
    // Distinct de « non financé » : le client a peut-être déjà autorisé le paiement sur son
    // téléphone. Lui réafficher « non financé » l'inviterait à payer une seconde fois.
    expect(escrowFinancialState(balance({ fundingPending: true }), "contrat_signe")).toBe(
      "financement_en_attente"
    );
  });

  it("fonds présents, rien de parti : séquestré", () => {
    expect(escrowFinancialState(balance({ funded: 300_000, held: 300_000 }), "fonds_sous_sequestre")).toBe(
      "sequestre"
    );
  });

  it("une partie versée, une partie restante : partiellement libéré", () => {
    expect(
      escrowFinancialState(
        balance({ funded: 300_000, released: 100_000, held: 200_000 }),
        "livrable_soumis"
      )
    ).toBe("partiellement_libere");
  });

  it("séquestre vidé, plus rien dû, mission en cours : totalement libéré", () => {
    // Pas « clôturé » : entre la dernière libération et la clôture il s'écoule le temps d'un
    // webhook. Annoncer une fin non acquise serait un mensonge dans le sens le plus coûteux.
    expect(
      escrowFinancialState(balance({ funded: 300_000, released: 300_000, held: 0 }), "validee")
    ).toBe("totalement_libere");
  });

  it("séquestre vidé, mission terminale : clôturé", () => {
    expect(
      escrowFinancialState(balance({ funded: 300_000, released: 300_000, held: 0 }), "cloturee")
    ).toBe("cloture");
  });

  it("une mission REMBOURSÉE est close, même si le prestataire n'a rien touché", () => {
    expect(
      escrowFinancialState(balance({ funded: 300_000, released: 0, held: 0 }), "remboursee")
    ).toBe("cloture");
  });

  it("séquestre vidé mais une somme reste DUE : jamais « totalement libéré »", () => {
    // Cas d'insuffisance (§18) : une validation attend sa recharge. Le prestataire attend
    // encore — afficher « totalement libéré » serait un contresens à son détriment.
    expect(
      escrowFinancialState(
        balance({ funded: 100_000, released: 100_000, held: 0, releasable: 80_000 }),
        "livrable_soumis"
      )
    ).toBe("partiellement_libere");
  });

  it("une recharge en vol ne fait pas RECULER l'état d'un contrat déjà financé", () => {
    // Le contrat est financé, seulement insuffisamment — c'est `releasable > available` qui le
    // dit, pas cet état. Repasser « financement en attente » effacerait ce qui est déjà acquis.
    expect(
      escrowFinancialState(
        balance({ funded: 120_000, released: 0, held: 120_000, fundingPending: true }),
        "livrable_soumis"
      )
    ).toBe("sequestre");
  });

  it("la fonction est TOTALE : toute combinaison de soldes reçoit un état", () => {
    const valeurs = [0, 100];
    const etats = new Set<string>();
    for (const funded of valeurs)
      for (const released of valeurs)
        for (const held of valeurs)
          for (const releasable of valeurs)
            for (const fundingPending of [false, true])
              for (const statut of ["contrat_signe", "livrable_soumis", "cloturee", "remboursee"]) {
                const etat = escrowFinancialState(
                  { funded, released, held, releasable, fundingPending },
                  statut
                );
                expect(etat).toBeTruthy();
                etats.add(etat);
              }
    // Et aucun état du modèle n'est inatteignable — sinon c'est qu'il n'aurait pas dû exister.
    expect(etats).toEqual(
      new Set([
        "non_finance",
        "financement_en_attente",
        "sequestre",
        "partiellement_libere",
        "totalement_libere",
        "cloture",
      ])
    );
  });
});
