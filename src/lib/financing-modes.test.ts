import { describe, expect, it } from "vitest";
import {
  FINANCING_MODES,
  DEFAULT_FINANCING_MODE_KEY,
  deriveJalons,
  distributeExact,
  getFinancingMode,
  isFinancingModeKey,
  listAvailableFinancingModes,
  providerBrief,
  resolveFinancing,
  RETENTION_RATE_J4,
} from "@/lib/financing-modes";
import { computeDevisData } from "@/lib/devis";
import { validateJalonsSum } from "@/lib/jalons";

// Devis de référence : 4 postes, une main d'œuvre forfaitaire et 18% de TVA — c'est-à-dire le
// cas où la somme des LIGNES (485 000) ne vaut PAS le prix du contrat (le TTC), la difficulté
// que la dérivation doit absorber.
const DEVIS = computeDevisData(
  [
    { description: "Fondations & terrassement", quantity: 1, unit: "forfait", unitPrice: 180000 },
    { description: "Élévation murs R+1", quantity: 1, unit: "forfait", unitPrice: 150000 },
    { description: "Plomberie & sanitaires", quantity: 1, unit: "forfait", unitPrice: 95000 },
    { description: "Finitions & livraison", quantity: 1, unit: "forfait", unitPrice: 60000 },
  ],
  "45 jours",
  "",
  18,
  40000
);

// Le prix du contrat EST le TTC du devis (MissionProposal.montant est mis à jour à chaque
// soumission de devis = totalTTC, voir prisma/schema.prisma).
const PRIX = DEVIS.totalTTC;

describe("catalogue des modes de financement", () => {
  it("le mode par défaut existe et est disponible", () => {
    const mode = getFinancingMode(DEFAULT_FINANCING_MODE_KEY);
    expect(mode).not.toBeNull();
    expect(mode!.available).toBe(true);
  });

  it("tout mode indisponible motive son indisponibilité", () => {
    for (const mode of Object.values(FINANCING_MODES)) {
      if (!mode.available) {
        expect(mode.unavailableReason, `${mode.key} sans motif`).toBeTruthy();
      }
    }
  });

  it("F1 est refusé structurellement — le séquestre préalable est obligatoire", () => {
    expect(FINANCING_MODES.F1.available).toBe(false);
    expect(listAvailableFinancingModes().map((m) => m.key)).not.toContain("F1");
  });

  it("isFinancingModeKey rejette ce qui n'est pas au catalogue", () => {
    expect(isFinancingModeKey("J1")).toBe(true);
    expect(isFinancingModeKey("J9")).toBe(false);
    expect(isFinancingModeKey(null)).toBe(false);
    // Piège classique : une clé héritée d'Object.prototype ne doit pas passer pour un mode.
    expect(isFinancingModeKey("toString")).toBe(false);
  });

  it("un mode sans jalon ne peut pas être séquentiel — l'option n'a aucun sens seule", () => {
    for (const mode of Object.values(FINANCING_MODES)) {
      if (!mode.primitives.useJalons) {
        expect(mode.primitives.jalonsSequential, `${mode.key}`).toBe(false);
        expect(mode.jalonStrategy, `${mode.key}`).toBe("none");
      }
    }
  });
});

describe("distributeExact — la somme est exacte par construction", () => {
  it("répartit un total indivisible sans perdre ni créer de montant", () => {
    const parts = distributeExact([1, 1, 1], 100);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(100);
  });

  it("respecte les poids", () => {
    expect(distributeExact([3, 1], 100)).toEqual([75, 25]);
  });

  it("des poids tous nuls retombent sur une répartition égale plutôt que sur une division par zéro", () => {
    const parts = distributeExact([0, 0, 0], 90);
    expect(parts).toEqual([30, 30, 30]);
  });

  it("une seule part reçoit tout", () => {
    expect(distributeExact([7], 1234.56)).toEqual([1234.56]);
  });
});

describe("dérivation des jalons depuis le devis", () => {
  it("J1 — une ligne de devis = un jalon, proratisé au TTC (main d'œuvre et TVA comprises)", () => {
    const res = deriveJalons(FINANCING_MODES.J1, DEVIS, PRIX);
    expect(res.ok).toBe(true);
    const jalons = (res as { ok: true; jalons: NonNullable<ReturnType<typeof Object>> }).ok
      ? (res as Extract<typeof res, { ok: true }>).jalons!
      : [];

    expect(jalons).toHaveLength(DEVIS.lineItems.length);
    expect(jalons.map((j) => j.titre)).toEqual(DEVIS.lineItems.map((l) => l.description));

    // L'invariant qui compte : le contrat séquestre le prix, les jalons doivent le sommer.
    expect(validateJalonsSum(jalons, PRIX)).toEqual({ ok: true });

    // Les lignes seules ne suffisaient pas — c'est bien le prorata qui comble l'écart.
    const sommeLignes = DEVIS.lineItems.reduce((s, l) => s + l.total, 0);
    expect(sommeLignes).toBeLessThan(PRIX);

    // L'ordre des poids est conservé : le poste le plus lourd du devis reste le jalon le plus lourd.
    expect(jalons[0].montant).toBeGreaterThan(jalons[3].montant);
  });

  it("J2 — mêmes intitulés que le devis, mais montants égalisés, somme toujours exacte", () => {
    const res = deriveJalons(FINANCING_MODES.J2, DEVIS, PRIX);
    expect(res.ok).toBe(true);
    const jalons = (res as Extract<typeof res, { ok: true }>).jalons!;

    expect(validateJalonsSum(jalons, PRIX)).toEqual({ ok: true });
    // Les trois premiers sont strictement égaux ; le dernier absorbe le reliquat d'arrondi.
    expect(jalons[0].montant).toBe(jalons[1].montant);
    expect(jalons[1].montant).toBe(jalons[2].montant);
    expect(Math.abs(jalons[3].montant - jalons[0].montant)).toBeLessThan(0.02);
  });

  it("F3 — deux moitiés, indépendantes du découpage du devis", () => {
    const res = deriveJalons(FINANCING_MODES.F3, DEVIS, PRIX);
    expect(res.ok).toBe(true);
    const jalons = (res as Extract<typeof res, { ok: true }>).jalons!;

    expect(jalons).toHaveLength(2);
    expect(validateJalonsSum(jalons, PRIX)).toEqual({ ok: true });
    expect(Math.abs(jalons[0].montant - PRIX / 2)).toBeLessThan(0.02);
  });

  it("F2 — aucun jalon : un seul séquestre sur le prix total", () => {
    const res = deriveJalons(FINANCING_MODES.F2, DEVIS, PRIX);
    expect(res).toEqual({ ok: true, jalons: null });
  });

  it("un mode à jalons sans devis signale devis_required — l'appelant retombe sur la saisie manuelle", () => {
    expect(deriveJalons(FINANCING_MODES.J1, null, PRIX)).toEqual({ ok: false, error: "devis_required" });
    expect(deriveJalons(FINANCING_MODES.J3, { ...DEVIS, lineItems: [] }, PRIX)).toEqual({
      ok: false,
      error: "devis_required",
    });
  });

  it("F2 n'a pas besoin de devis — il ne fractionne rien", () => {
    expect(deriveJalons(FINANCING_MODES.F2, null, PRIX)).toEqual({ ok: true, jalons: null });
  });

  it("un prix nul ou négatif est refusé avant toute répartition", () => {
    expect(deriveJalons(FINANCING_MODES.J1, DEVIS, 0)).toEqual({ ok: false, error: "prix_contrat_invalide" });
  });

  it("une ligne de devis sans description reçoit un titre de repli — validateJalonsSum exige un titre", () => {
    const devisSansTitre = computeDevisData(
      [{ description: "   ", quantity: 1, unit: "forfait", unitPrice: 1000 }],
      "10 jours",
      "",
      0,
      0
    );
    const res = deriveJalons(FINANCING_MODES.J1, devisSansTitre, 1000);
    const jalons = (res as Extract<typeof res, { ok: true }>).jalons!;
    expect(jalons[0].titre).toBe("Jalon 1");
    expect(validateJalonsSum(jalons, 1000)).toEqual({ ok: true });
  });
});

describe("resolveFinancing — ce que la génération de contrat persiste", () => {
  it("J3 impose le financement progressif", () => {
    const res = resolveFinancing(FINANCING_MODES.J3, DEVIS, PRIX);
    expect(res.ok).toBe(true);
    const resolved = (res as Extract<typeof res, { ok: true }>).resolved;
    expect(resolved.financingMode).toBe("progressive");
    expect(resolved.jalons).toHaveLength(DEVIS.lineItems.length);
  });

  it("J1 reste en lump_sum — un jalon est payé en une fois, à 100% validé", () => {
    const res = resolveFinancing(FINANCING_MODES.J1, DEVIS, PRIX);
    const resolved = (res as Extract<typeof res, { ok: true }>).resolved;
    expect(resolved.financingMode).toBe("lump_sum");
    expect(resolved.jalonsSequential).toBe(false);
  });

  it("F3 est séquentiel : le solde attend la validation de l'acompte", () => {
    const res = resolveFinancing(FINANCING_MODES.F3, DEVIS, PRIX);
    const resolved = (res as Extract<typeof res, { ok: true }>).resolved;
    expect(resolved.jalonsSequential).toBe(true);
  });

  it("sans jalon, jalonsSequential est forcé à faux même si le mode le déclarait", () => {
    const res = resolveFinancing(FINANCING_MODES.F2, DEVIS, PRIX);
    const resolved = (res as Extract<typeof res, { ok: true }>).resolved;
    expect(resolved.jalons).toBeNull();
    expect(resolved.jalonsSequential).toBe(false);
  });

  it("tout mode disponible produit un découpage qui somme au prix — invariant du catalogue", () => {
    for (const mode of listAvailableFinancingModes()) {
      const res = resolveFinancing(mode, DEVIS, PRIX);
      expect(res.ok, `${mode.key} n'a pas pu être résolu`).toBe(true);
      const { jalons } = (res as Extract<typeof res, { ok: true }>).resolved;
      if (jalons) {
        expect(validateJalonsSum(jalons, PRIX), `${mode.key} ne somme pas au prix`).toEqual({ ok: true });
      }
    }
  });
});

describe("providerBrief — consigne de chiffrage côté prestataire", () => {
  it("J1 en mode devis : annonce que chaque ligne devient un jalon", () => {
    const brief = providerBrief(FINANCING_MODES.J1, { quoteMode: true });
    expect(brief.headline).toContain("chaque ligne");
    expect(brief.points[0]).toContain("Un jalon = une preuve");
  });

  it("J1 en prix fixe : ne promet AUCUN découpage — il n'y a pas de ligne à dériver", () => {
    // Garde-fou du vrai piège : `deriveJalons` répond `devis_required` hors mode devis, le
    // découpage vient alors du client. Promettre « une ligne = un jalon » serait faux.
    const brief = providerBrief(FINANCING_MODES.J1, { quoteMode: false });
    expect(brief.headline).toContain("montant global");
    expect(brief.headline).not.toContain("chaque ligne");
    expect(brief.points[0]).toContain("Un seul séquestre");
  });

  it("J3 : ajoute la libération au fil des paliers (financement progressif)", () => {
    const brief = providerBrief(FINANCING_MODES.J3, { quoteMode: true });
    expect(brief.points.some((p) => p.includes("palier"))).toBe(true);
  });

  it("F3 : deux moitiés indépendantes du devis, et jalons séquentiels", () => {
    const brief = providerBrief(FINANCING_MODES.F3, { quoteMode: true });
    expect(brief.headline).toContain("deux moitiés");
    expect(brief.points.some((p) => p.includes("dans l'ordre"))).toBe(true);
  });

  it("F2 : un seul séquestre, aucune mention de jalon", () => {
    const brief = providerBrief(FINANCING_MODES.F2, { quoteMode: true });
    expect(brief.headline).toContain("prix unique");
    expect(brief.points).toHaveLength(1);
    expect(brief.points[0]).toContain("Un seul séquestre");
  });

  it("tout mode disponible produit une consigne non vide, dans les deux modes de mission", () => {
    for (const mode of listAvailableFinancingModes()) {
      for (const quoteMode of [true, false]) {
        const brief = providerBrief(mode, { quoteMode });
        expect(brief.headline.length, `${mode.key} sans consigne`).toBeGreaterThan(0);
        expect(brief.points.length, `${mode.key} sans conséquence de paiement`).toBeGreaterThan(0);
      }
    }
  });
});

describe("offre effective — quatre modes proposés, retenue de garantie incluse", () => {
  it("le catalogue proposé est exactement F2, J1, J3, J4", () => {
    // Volontairement une égalité stricte et non un `toContain` : l'intérêt de ce test est
    // d'échouer si un mode redevient disponible sans décision explicite. Rouvrir F3 ou J2 est
    // une ligne à changer ici en même temps que le drapeau — pas un effet de bord silencieux.
    expect(listAvailableFinancingModes().map((m) => m.key).sort()).toEqual(["F2", "J1", "J3", "J4"]);
  });

  it("chaque famille reste représentée — le client n'est pas enfermé dans les jalons", () => {
    const familles = new Set(listAvailableFinancingModes().map((m) => m.family));
    expect(familles).toEqual(new Set(["fixe", "jalon"]));
  });

  it("J4 est le SEUL mode à porter une retenue de garantie", () => {
    expect(FINANCING_MODES.J4.available).toBe(true);
    expect(FINANCING_MODES.J4.primitives.retentionRate).toBe(RETENTION_RATE_J4);
    for (const mode of Object.values(FINANCING_MODES)) {
      if (mode.key === "J4") continue;
      expect(mode.primitives.retentionRate, `${mode.key} ne doit rien retenir`).toBe(0);
    }
  });

  it("J4 dérive ses jalons du devis et propage le taux au contrat", () => {
    const res = resolveFinancing(FINANCING_MODES.J4, DEVIS, PRIX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resolved.retentionRate).toBe(RETENTION_RATE_J4);
    // La retenue ne change RIEN au découpage : les jalons somment toujours au prix du contrat.
    // Elle ne joue qu'au moment de libérer, jamais au moment de découper.
    expect(res.resolved.jalons).not.toBeNull();
    expect(validateJalonsSum(res.resolved.jalons!, PRIX)).toEqual({ ok: true });
  });

  it("un mode sans jalon ne retient jamais rien, même si ses primitives le demandaient", () => {
    // F2 n'a pas de retenue, mais c'est la RÈGLE qui est testée ici : `resolveFinancing`
    // neutralise la retenue dès qu'il n'y a pas de jalon — il n'existe alors aucune libération
    // finale distincte à laquelle la rattacher.
    const sansJalon = {
      ...FINANCING_MODES.J4,
      jalonStrategy: "none" as const,
      primitives: { ...FINANCING_MODES.J4.primitives, useJalons: false },
    };
    const res = resolveFinancing(sansJalon, DEVIS, PRIX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resolved.jalons).toBeNull();
    expect(res.resolved.retentionRate).toBe(0);
  });

  it("le prestataire est prévenu de la retenue avant de chiffrer", () => {
    const brief = providerBrief(FINANCING_MODES.J4, { quoteMode: true });
    const retenue = brief.points.find((p) => p.includes("Retenue de garantie"));
    expect(retenue, "la consigne de chiffrage doit annoncer la retenue").toBeTruthy();
    expect(retenue).toContain("5 %");

    // Et aucun autre mode ne l'annonce — sinon le texte ne viendrait plus des primitives.
    for (const key of ["F2", "J1", "J3"] as const) {
      const autre = providerBrief(FINANCING_MODES[key], { quoteMode: true });
      expect(autre.points.some((p) => p.includes("Retenue de garantie")), key).toBe(false);
    }
  });
});
