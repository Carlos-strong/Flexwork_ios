import { describe, expect, it } from "vitest";
import {
  validateJalonsSum,
  canSubmitJalonDeliverable,
  canDecideJalon,
  isJalonUnengaged,
  isValidProgress,
  canReportDeclaredProgress,
  isAboveProgressFloor,
  weightedJalonsProgress,
  progressiveReleaseTarget,
  remainingReleasableAmount,
  canHoldJalonSequential,
  retentionAmount,
  releasableBeforeRetention,
  totalRetentionAmount,
} from "./jalons";

describe("validateJalonsSum", () => {
  it("refuses an empty list", () => {
    expect(validateJalonsSum([], 100000)).toEqual({ ok: false, error: "jalons_empty" });
  });

  it("refuses a non-positive montant", () => {
    expect(validateJalonsSum([{ titre: "A", montant: 0 }], 0)).toEqual({ ok: false, error: "jalon_montant_invalide" });
  });

  it("refuses an empty titre", () => {
    expect(validateJalonsSum([{ titre: "  ", montant: 100 }], 100)).toEqual({ ok: false, error: "jalon_titre_requis" });
  });

  it("refuses a sum that does not match the contract price", () => {
    expect(
      validateJalonsSum([{ titre: "A", montant: 50000 }, { titre: "B", montant: 40000 }], 100000)
    ).toEqual({ ok: false, error: "jalons_sum_mismatch" });
  });

  it("accepts a sum matching exactly", () => {
    expect(
      validateJalonsSum([{ titre: "A", montant: 60000 }, { titre: "B", montant: 40000 }], 100000)
    ).toEqual({ ok: true });
  });

  it("tolerates floating point rounding", () => {
    expect(
      validateJalonsSum([{ titre: "A", montant: 33333.33 }, { titre: "B", montant: 33333.33 }, { titre: "C", montant: 33333.34 }], 100000)
    ).toEqual({ ok: true });
  });
});

describe("jalon status guards", () => {
  // Financer (HOLD) et redécouper (split) posaient la même question sous deux noms : une seule
  // règle depuis 2026-09-11, donc un seul cas de test.
  it("isJalonUnengaged n'autorise que en_attente — ni HOLD ni scission après engagement", () => {
    expect(isJalonUnengaged("en_attente")).toBe(true);
    expect(isJalonUnengaged("fonds_sous_sequestre")).toBe(false);
    expect(isJalonUnengaged("valide")).toBe(false);
    expect(isJalonUnengaged("libere")).toBe(false);
  });

  it("canSubmitJalonDeliverable allows fonds_sous_sequestre and rejete", () => {
    expect(canSubmitJalonDeliverable("fonds_sous_sequestre")).toBe(true);
    expect(canSubmitJalonDeliverable("rejete")).toBe(true);
    expect(canSubmitJalonDeliverable("en_attente")).toBe(false);
    expect(canSubmitJalonDeliverable("libere")).toBe(false);
  });

  it("canDecideJalon only allows livrable_soumis", () => {
    expect(canDecideJalon("livrable_soumis")).toBe(true);
    expect(canDecideJalon("valide")).toBe(false);
  });

  it("canReportDeclaredProgress allows fonds_sous_sequestre, livrable_soumis et rejete", () => {
    expect(canReportDeclaredProgress("fonds_sous_sequestre")).toBe(true);
    expect(canReportDeclaredProgress("livrable_soumis")).toBe(true);
    expect(canReportDeclaredProgress("rejete")).toBe(true);
    expect(canReportDeclaredProgress("en_attente")).toBe(false);
    expect(canReportDeclaredProgress("valide")).toBe(false);
    expect(canReportDeclaredProgress("libere")).toBe(false);
  });
});

describe("isValidProgress", () => {
  it("accepts integers and floats within [0, 100]", () => {
    expect(isValidProgress(0)).toBe(true);
    expect(isValidProgress(100)).toBe(true);
    expect(isValidProgress(42.5)).toBe(true);
  });

  it("rejects out-of-range, non-finite or non-number values", () => {
    expect(isValidProgress(-1)).toBe(false);
    expect(isValidProgress(101)).toBe(false);
    expect(isValidProgress(NaN)).toBe(false);
    expect(isValidProgress(Infinity)).toBe(false);
    expect(isValidProgress("50")).toBe(false);
    expect(isValidProgress(undefined)).toBe(false);
    expect(isValidProgress(null)).toBe(false);
  });
});

describe("isAboveProgressFloor", () => {
  it("accepts a proposal at or above the last validated progress", () => {
    expect(isAboveProgressFloor(65, 65)).toBe(true);
    expect(isAboveProgressFloor(80, 65)).toBe(true);
    expect(isAboveProgressFloor(100, 65)).toBe(true);
  });

  it("refuses a proposal below the last validated progress", () => {
    expect(isAboveProgressFloor(64, 65)).toBe(false);
    expect(isAboveProgressFloor(0, 65)).toBe(false);
  });

  it("never blocks when nothing has been validated yet", () => {
    expect(isAboveProgressFloor(0, 0)).toBe(true);
  });
});

describe("weightedJalonsProgress", () => {
  it("returns 0 for an empty list", () => {
    expect(weightedJalonsProgress([])).toBe(0);
  });

  it("weights each jalon by its montant (règle 18.14)", () => {
    // Exemple de la doc : 300k×100% + 400k×50% + 300k×0% = 500k / 1 000k = 50%.
    expect(
      weightedJalonsProgress([
        { montant: 300000, observedProgress: 100 },
        { montant: 400000, observedProgress: 50 },
        { montant: 300000, observedProgress: 0 },
      ])
    ).toBe(50);
  });

  it("counts a partially-validated, not-yet-released jalon proportionally (unlike a raw libere ratio)", () => {
    // Un seul jalon, jamais `libere`, mais constaté à 65% — l'ancien calcul (jalons
    // "libere"/total) aurait renvoyé 0 ici.
    expect(weightedJalonsProgress([{ montant: 455000, observedProgress: 65 }])).toBe(65);
  });

  it("gives more weight to a larger jalon", () => {
    // Jalon A (900) à 100%, jalon B (100) à 0% → 90%, pas 50% (moyenne non pondérée).
    expect(
      weightedJalonsProgress([
        { montant: 900, observedProgress: 100 },
        { montant: 100, observedProgress: 0 },
      ])
    ).toBe(90);
  });

  it("returns 100 once every jalon is fully validated", () => {
    expect(
      weightedJalonsProgress([
        { montant: 200000, observedProgress: 100 },
        { montant: 300000, observedProgress: 100 },
      ])
    ).toBe(100);
  });

  it("guards against a zero total montant instead of dividing by zero", () => {
    expect(weightedJalonsProgress([{ montant: 0, observedProgress: 50 }])).toBe(0);
  });
});

describe("progressiveReleaseTarget — cumul dû à un taux donné", () => {
  it("0 % ne doit rien, 100 % doit le plafond entier", () => {
    expect(progressiveReleaseTarget(120000, 0)).toBe(0);
    expect(progressiveReleaseTarget(120000, 100)).toBe(120000);
  });

  it("un palier intermédiaire doit sa part du plafond", () => {
    expect(progressiveReleaseTarget(120000, 50)).toBe(60000);
    expect(progressiveReleaseTarget(120000, 25)).toBe(30000);
  });

  it("borne les taux hors intervalle plutôt que de dépasser le plafond", () => {
    expect(progressiveReleaseTarget(120000, 150)).toBe(120000);
    expect(progressiveReleaseTarget(120000, -10)).toBe(0);
  });

  it("INVARIANT : la cible à 100 % retombe EXACTEMENT sur le plafond, arrondis compris", () => {
    // C'est ce qui garantit qu'aucun résidu ne reste séquestré après le dernier palier — le
    // défaut que le calcul par incréments successifs pouvait produire.
    for (const plafond of [12345, 99999, 7, 333333, 250001]) {
      expect(progressiveReleaseTarget(plafond, 100), `plafond ${plafond}`).toBe(plafond);
    }
  });

  it("la cible ne dépend QUE du taux courant, jamais du chemin parcouru", () => {
    // Le fond du correctif F8 : deux clients arrivant à 70 % — l'un d'un coup, l'autre par
    // paliers, l'autre encore après un passage par observe-progress — doivent le même montant.
    expect(progressiveReleaseTarget(200000, 70)).toBe(140000);
  });
});

describe("remainingReleasableAmount", () => {
  it("retourne le solde restant", () => {
    expect(remainingReleasableAmount(400000, 320000)).toBe(80000);
  });

  it("retourne 0 une fois tout libéré, jamais négatif même en cas de dépassement", () => {
    expect(remainingReleasableAmount(400000, 400000)).toBe(0);
    expect(remainingReleasableAmount(400000, 400001)).toBe(0);
  });
});

describe("canHoldJalonSequential", () => {
  const jalons = [
    { ordre: 1, status: "libere" },
    { ordre: 2, status: "valide" },
    { ordre: 3, status: "en_attente" },
  ];

  it("mode non séquentiel : identique à canHoldJalon, l'ordre n'a pas d'importance", () => {
    expect(canHoldJalonSequential("en_attente", 3, jalons, false)).toBe(true);
    expect(canHoldJalonSequential("en_attente", 2, jalons, false)).toBe(true);
  });

  it("mode séquentiel : débloqué si tous les jalons précédents sont valide/libere", () => {
    expect(canHoldJalonSequential("en_attente", 3, jalons, true)).toBe(true);
  });

  it("mode séquentiel : verrouillé si un jalon précédent n'est pas encore validé", () => {
    const blocked = [
      { ordre: 1, status: "livrable_soumis" },
      { ordre: 2, status: "en_attente" },
    ];
    expect(canHoldJalonSequential("en_attente", 2, blocked, true)).toBe(false);
  });

  it("le premier jalon (aucun précédent) n'est jamais bloqué par le mode séquentiel", () => {
    expect(canHoldJalonSequential("en_attente", 1, jalons, true)).toBe(true);
  });

  it("reste refusé si le jalon cible lui-même n'est pas finançable, même débloqué", () => {
    expect(canHoldJalonSequential("valide", 3, jalons, true)).toBe(false);
  });
});

describe("retenue de garantie (règle 18.10, mode J4)", () => {
  it("ne retient rien sans taux — le chemin par défaut de tous les autres modes", () => {
    expect(retentionAmount(120000, 0)).toBe(0);
    expect(releasableBeforeRetention(120000, 0)).toBe(120000);
    // Un taux aberrant (négatif, NaN) ne doit jamais retenir « à l'envers », c'est-à-dire
    // libérer PLUS que le montant du jalon.
    expect(retentionAmount(120000, -0.05)).toBe(0);
    expect(retentionAmount(120000, Number.NaN)).toBe(0);
    expect(releasableBeforeRetention(120000, -0.05)).toBe(120000);
  });

  it("retient la fraction attendue et libère le reste", () => {
    expect(retentionAmount(120000, 0.05)).toBe(6000);
    expect(releasableBeforeRetention(120000, 0.05)).toBe(114000);
  });

  it("arrondit la retenue à l'unité — le XOF n'a pas de sous-unité", () => {
    // 5 % de 12 345 = 617,25
    expect(retentionAmount(12345, 0.05)).toBe(617);
    expect(releasableBeforeRetention(12345, 0.05)).toBe(12345 - 617);
  });

  it("INVARIANT : libérable + retenue == montant, arrondis compris", () => {
    // Des montants volontairement non ronds : c'est là que le libérable et la retenue peuvent
    // se mettre à ne plus retomber sur le montant, laissant un résidu séquestré introuvable.
    for (const montant of [12345, 99999, 7, 1, 333333, 250001]) {
      expect(
        releasableBeforeRetention(montant, 0.05) + retentionAmount(montant, 0.05),
        `montant ${montant}`
      ).toBe(montant);
    }
  });

  it("la retenue du contrat somme celles des jalons, jamais le taux sur le prix total", () => {
    const jalons = [{ montant: 12345 }, { montant: 12345 }, { montant: 12345 }];
    // 3 × 617 = 1 851, alors que 5 % de 37 035 donnerait 1 852 : c'est exactement l'écart d'un
    // franc qui resterait immobilisé si la retenue était calculée sur le total.
    expect(totalRetentionAmount(jalons, 0.05)).toBe(1851);
    expect(retentionAmount(37035, 0.05)).toBe(1852);
  });

  it("INVARIANT : Σ(libérable par jalon) + retenue du contrat == prix du contrat", () => {
    const jalons = [{ montant: 12345 }, { montant: 80000 }, { montant: 7 }, { montant: 250001 }];
    const prix = jalons.reduce((sum, j) => sum + j.montant, 0);
    const libere = jalons.reduce((sum, j) => sum + releasableBeforeRetention(j.montant, 0.05), 0);
    expect(libere + totalRetentionAmount(jalons, 0.05)).toBe(prix);
  });

  it("une liste vide ne retient rien (contrat sans jalon)", () => {
    expect(totalRetentionAmount([], 0.05)).toBe(0);
  });
});
