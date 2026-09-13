import { describe, expect, it } from "vitest";
import { canClientRejectDevis, canClientRequestRevision, canProviderReviseDevis, computeDevisData } from "./devis";
import { devisSchema } from "./validation";

describe("canProviderReviseDevis", () => {
  it("autorise toujours la toute première soumission", () => {
    expect(canProviderReviseDevis({ hasDevis: false, revisionRequested: false })).toBe(true);
  });

  it("refuse une resoumission sans demande du client", () => {
    expect(canProviderReviseDevis({ hasDevis: true, revisionRequested: false })).toBe(false);
  });

  it("autorise la resoumission une fois la révision demandée", () => {
    expect(canProviderReviseDevis({ hasDevis: true, revisionRequested: true })).toBe(true);
  });
});

describe("canClientRequestRevision", () => {
  it("refuse s'il n'y a pas encore de devis à réviser", () => {
    expect(canClientRequestRevision({ hasDevis: false, status: "en_negociation", revisionAlreadyRequested: false })).toBe(false);
  });

  it("refuse hors négociation active (ex. devis déjà validé)", () => {
    expect(canClientRequestRevision({ hasDevis: true, status: "devis_valide", revisionAlreadyRequested: false })).toBe(false);
  });

  it("refuse une 2e demande tant que la précédente n'a pas été consommée", () => {
    expect(canClientRequestRevision({ hasDevis: true, status: "en_negociation", revisionAlreadyRequested: true })).toBe(false);
  });

  it("autorise une demande de révision valide", () => {
    expect(canClientRequestRevision({ hasDevis: true, status: "en_negociation", revisionAlreadyRequested: false })).toBe(true);
  });

  it("autorise une demande de révision dès la première soumission (mode prix fixe/taux, statut 'envoyee')", () => {
    expect(canClientRequestRevision({ hasDevis: true, status: "envoyee", revisionAlreadyRequested: false })).toBe(true);
  });
});

describe("canClientRejectDevis", () => {
  it("autorise le rejet pendant une négociation active", () => {
    expect(canClientRejectDevis("en_negociation")).toBe(true);
  });

  // "envoyee" est désormais aussi une négociation ouverte : c'est le statut de la toute
  // première soumission d'une candidature prix fixe/taux (src/app/api/missions/[id]/
  // proposals/route.ts), qui doit pouvoir être rejetée ou faire l'objet d'une demande de
  // révision dès ce premier round — sans quoi la négociation prix fixe ne pourrait jamais
  // démarrer (round 2 exige déjà une demande de révision, qui exige elle-même un statut
  // ouvert). Sans effet sur le mode devis (QUOTE), qui n'atteint jamais "envoyee".
  it("autorise le rejet dès la première soumission (mode prix fixe/taux)", () => {
    expect(canClientRejectDevis("envoyee")).toBe(true);
  });

  it("refuse hors négociation (déjà validé, accepté, refusé, ou annulé)", () => {
    expect(canClientRejectDevis("devis_valide")).toBe(false);
    expect(canClientRejectDevis("acceptee")).toBe(false);
    expect(canClientRejectDevis("refusee")).toBe(false);
    expect(canClientRejectDevis("annulee_definitive")).toBe(false);
  });
});

describe("computeDevisData", () => {
  it("calcule HT, TVA (20%) et TTC", () => {
    const devis = computeDevisData(
      [{ description: "Pose carrelage", quantity: 2, unit: "m2", unitPrice: 100 }],
      "3 semaines",
      "",
      20
    );
    expect(devis.lineItems[0].total).toBe(200);
    expect(devis.totalHT).toBe(200);
    expect(devis.tva).toBe(40);
    expect(devis.totalTTC).toBe(240);
    expect(devis.tvaRate).toBe(20);
  });

  it("propage l'échéance de chaque jalon sans l'inclure dans le calcul", () => {
    const devis = computeDevisData(
      [
        { description: "Fondation", quantity: 1, unit: "forfait", unitPrice: 500000, echeance: "15/09/2026" },
        { description: "Toiture", quantity: 1, unit: "forfait", unitPrice: 300000 },
      ],
      "6 semaines",
      "",
      18
    );
    expect(devis.lineItems[0].echeance).toBe("15/09/2026");
    expect(devis.lineItems[1].echeance).toBeUndefined();
    expect(devis.totalHT).toBe(800000);
  });

  it("applique une TVA nulle", () => {
    const devis = computeDevisData(
      [{ description: "Forfait", quantity: 1, unit: "forfait", unitPrice: 1000 }],
      "5 jours",
      "",
      0
    );
    expect(devis.tva).toBe(0);
    expect(devis.totalTTC).toBe(1000);
  });

  it("additionne plusieurs jalons", () => {
    const devis = computeDevisData(
      [
        { description: "A", quantity: 2, unit: "u", unitPrice: 50 },
        { description: "B", quantity: 3, unit: "h", unitPrice: 10 },
      ],
      "1 semaine",
      "",
      20
    );
    expect(devis.totalHT).toBe(130);
    expect(devis.tva).toBe(26);
    expect(devis.totalTTC).toBe(156);
  });

  it("arrondit proprement les montants décimaux", () => {
    const devis = computeDevisData(
      [{ description: "A", quantity: 3, unit: "u", unitPrice: 0.1 }],
      "1 semaine",
      "",
      20
    );
    expect(devis.lineItems[0].total).toBe(0.3);
    expect(devis.totalHT).toBe(0.3);
    expect(devis.tva).toBe(0.06);
    expect(devis.totalTTC).toBe(0.36);
  });

  it("laborCost par défaut à 0 quand omis (comportement inchangé)", () => {
    const devis = computeDevisData(
      [{ description: "Pose carrelage", quantity: 2, unit: "m2", unitPrice: 100 }],
      "3 semaines",
      "",
      20
    );
    expect(devis.laborCost).toBe(0);
    expect(devis.totalHT).toBe(200);
  });

  it("ajoute la main d'œuvre au Total HT avant application de la TVA", () => {
    const devis = computeDevisData(
      [{ description: "Pose carrelage", quantity: 2, unit: "m2", unitPrice: 100 }],
      "3 semaines",
      "",
      20,
      50
    );
    expect(devis.laborCost).toBe(50);
    // 200 (jalons) + 50 (main d'œuvre) = 250 HT, TVA 20% dessus, pas seulement sur les jalons.
    expect(devis.totalHT).toBe(250);
    expect(devis.tva).toBe(50);
    expect(devis.totalTTC).toBe(300);
  });

  it("accepte une main d'œuvre seule, sans jalon chiffré", () => {
    const devis = computeDevisData(
      [{ description: "Forfait", quantity: 1, unit: "forfait", unitPrice: 0 }],
      "1 semaine",
      "",
      0,
      150
    );
    expect(devis.totalHT).toBe(150);
    expect(devis.totalTTC).toBe(150);
  });
});

describe("devisSchema", () => {
  const valid = {
    lineItems: [{ description: "A", quantity: 1, unit: "forfait", unitPrice: 100 }],
    delay: "3 semaines",
  };

  it("accepte un devis valide", () => {
    expect(devisSchema.safeParse(valid).success).toBe(true);
  });

  it("refuse une liste de jalons vide", () => {
    expect(devisSchema.safeParse({ lineItems: [], delay: "3 semaines" }).success).toBe(false);
  });

  it("refuse une quantité non positive", () => {
    expect(
      devisSchema.safeParse({
        lineItems: [{ description: "A", quantity: 0, unit: "u", unitPrice: 10 }],
        delay: "3 semaines",
      }).success
    ).toBe(false);
  });

  it("refuse un délai manquant", () => {
    expect(devisSchema.safeParse({ lineItems: valid.lineItems }).success).toBe(false);
  });

  it("laborCost par défaut à 0 quand omis", () => {
    const parsed = devisSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.laborCost).toBe(0);
  });

  it("accepte une main d'œuvre positive", () => {
    expect(devisSchema.safeParse({ ...valid, laborCost: 50 }).success).toBe(true);
  });

  it("refuse une main d'œuvre négative", () => {
    expect(devisSchema.safeParse({ ...valid, laborCost: -1 }).success).toBe(false);
  });
});
