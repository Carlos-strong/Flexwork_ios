/**
 * Règle de solde séquestré (`netHeldAmount`) — fonction PURE, partagée depuis 2026-09-14 par
 * les deux moteurs financiers du dépôt : `PspEscrowOperation` (missions, via `heldBalance`) et
 * `GigOrderEscrowOperation` (commandes Gig, via `gigHeldBalance`).
 *
 * Elle est testée ici SEULE, sans base : c'est la seule règle que les deux moteurs partagent
 * réellement, donc la seule dont une divergence silencieuse coûterait de l'argent des deux
 * côtés à la fois. Les tests e2e (gig-completion, contract-refund) vérifient qu'elle est bien
 * câblée ; celui-ci vérifie qu'elle est juste.
 */

import { describe, expect, it } from "vitest";
import { netHeldAmount, isProviderPayout, PROVIDER_PAYOUT_TYPES } from "@/lib/escrow-instructions";

describe("netHeldAmount — ce qui reste réellement au séquestre", () => {
  it("aucun mouvement : rien au séquestre", () => {
    expect(netHeldAmount([])).toBe(0);
  });

  it("un hold seul crédite l'intégralité", () => {
    expect(netHeldAmount([{ instructionType: "hold", status: "confirmed", amount: 150_000 }])).toBe(150_000);
  });

  it("une libération au prestataire débite", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 150_000 },
        { instructionType: "release", status: "confirmed", amount: 60_000 },
      ])
    ).toBe(90_000);
  });

  it("un remboursement au client débite AUSSI — le séquestre ne distingue pas le destinataire", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 150_000 },
        { instructionType: "refund", status: "confirmed", amount: 150_000 },
      ])
    ).toBe(0);
  });

  it("la libération de retenue débite comme une libération ordinaire", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 100_000 },
        { instructionType: "release", status: "confirmed", amount: 95_000 },
        { instructionType: "retention_release", status: "confirmed", amount: 5_000 },
      ])
    ).toBe(0);
  });

  it("un gel est NEUTRE : les sommes litigieuses restent comptées au séquestre", () => {
    // C'est toute la fonction du gel — suspendre le déblocage sans déplacer les fonds. Les
    // compter comme sortis rendrait un litige indistinguable d'un paiement.
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 150_000 },
        { instructionType: "freeze", status: "confirmed", amount: 150_000 },
      ])
    ).toBe(150_000);
  });

  it("plusieurs holds s'additionnent — une recharge de séquestre ne remplace pas le premier", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 100_000 },
        { instructionType: "hold", status: "confirmed", amount: 50_000 },
        { instructionType: "release", status: "confirmed", amount: 30_000 },
      ])
    ).toBe(120_000);
  });

  it("un séquestre entièrement consommé retombe exactement à zéro", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 3_339 },
        { instructionType: "release", status: "confirmed", amount: 1_200 },
        { instructionType: "release", status: "confirmed", amount: 850 },
        { instructionType: "release", status: "confirmed", amount: 780 },
        { instructionType: "release", status: "confirmed", amount: 509 },
      ])
    ).toBe(0);
  });
});

describe("asymétrie entrant / sortant — le statut ne se lit pas pareil selon le sens", () => {
  it("un hold `pending` ne crédite RIEN : un débit transmis n'est pas un encaissement", () => {
    // Le compter autoriserait un paiement au prestataire contre de l'argent que le client n'a
    // pas encore autorisé — invariant n°1 du cahier des charges.
    expect(netHeldAmount([{ instructionType: "hold", status: "pending", amount: 150_000 }])).toBe(0);
  });

  it("le même hold, une fois confirmé, crédite l'intégralité", () => {
    expect(netHeldAmount([{ instructionType: "hold", status: "confirmed", amount: 150_000 }])).toBe(
      150_000
    );
  });

  it("une recharge en vol n'augmente pas le solde tant qu'elle n'est pas confirmée", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 120_000 },
        { instructionType: "hold", status: "pending", amount: 80_000 },
      ])
    ).toBe(120_000);
  });

  it("une libération `pending` débite DÉJÀ : elle est partie, elle ne doit pas être réémise", () => {
    // Asymétrie assumée : les deux sens penchent du même côté — ne jamais surestimer ce dont
    // on dispose (règle 18.3).
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 150_000 },
        { instructionType: "release", status: "pending", amount: 60_000 },
      ])
    ).toBe(90_000);
  });

  it("un remboursement `pending` débite aussi", () => {
    expect(
      netHeldAmount([
        { instructionType: "hold", status: "confirmed", amount: 150_000 },
        { instructionType: "refund", status: "pending", amount: 150_000 },
      ])
    ).toBe(0);
  });
});

describe("isProviderPayout — qui reçoit l'argent qui sort", () => {
  it("les deux types de versement au prestataire sont reconnus", () => {
    for (const type of PROVIDER_PAYOUT_TYPES) {
      expect(isProviderPayout(type)).toBe(true);
    }
  });

  it("un remboursement sort du séquestre mais ne va PAS au prestataire", () => {
    expect(isProviderPayout("refund")).toBe(false);
    expect(isProviderPayout("hold")).toBe(false);
    expect(isProviderPayout("freeze")).toBe(false);
  });
});
