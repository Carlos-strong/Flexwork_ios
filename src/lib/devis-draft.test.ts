import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDevisDraft, loadDevisDraft, clearDevisDraft, restorableDateDebut } from "./devis-draft";

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

const SAMPLE = {
  lineItems: [{ description: "Pose carrelage", quantity: 30, unit: "m2", unitPrice: 5000 }],
  delay: "3 semaines",
  notes: "",
  tvaRate: 18,
  laborCost: 100000,
};

describe("devis-draft (environnement sans window — vitest tourne en \"node\")", () => {
  it("saveDevisDraft ne lève jamais quand window est absent", () => {
    expect(() => saveDevisDraft("mission-1", SAMPLE)).not.toThrow();
  });

  it("loadDevisDraft renvoie null quand window est absent", () => {
    expect(loadDevisDraft("mission-1")).toBeNull();
  });

  it("clearDevisDraft ne lève jamais quand window est absent", () => {
    expect(() => clearDevisDraft("mission-1")).not.toThrow();
  });
});

describe("devis-draft (avec localStorage simulé)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trip complet : save → load renvoie exactement les mêmes données + savedAt", () => {
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });

    saveDevisDraft("mission-42", SAMPLE);
    const loaded = loadDevisDraft("mission-42");

    expect(loaded).not.toBeNull();
    expect(loaded?.lineItems).toEqual(SAMPLE.lineItems);
    expect(loaded?.delay).toBe(SAMPLE.delay);
    expect(loaded?.laborCost).toBe(SAMPLE.laborCost);
    expect(typeof loaded?.savedAt).toBe("string");
  });

  it("isole les brouillons par missionId — un devis pour une mission n'apparaît pas sous une autre", () => {
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });

    saveDevisDraft("mission-A", SAMPLE);
    expect(loadDevisDraft("mission-B")).toBeNull();
    expect(loadDevisDraft("mission-A")).not.toBeNull();
  });

  it("clearDevisDraft supprime le brouillon — un load suivant renvoie null", () => {
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });

    saveDevisDraft("mission-7", SAMPLE);
    expect(loadDevisDraft("mission-7")).not.toBeNull();

    clearDevisDraft("mission-7");
    expect(loadDevisDraft("mission-7")).toBeNull();
  });

  it("ne lève jamais si le stockage est indisponible (quota dépassé, navigation privée)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("quota exceeded"); },
        setItem: () => { throw new Error("quota exceeded"); },
        removeItem: () => { throw new Error("quota exceeded"); },
      },
    });

    expect(() => saveDevisDraft("mission-9", SAMPLE)).not.toThrow();
    expect(loadDevisDraft("mission-9")).toBeNull();
    expect(() => clearDevisDraft("mission-9")).not.toThrow();
  });
});

describe("dateDebut — le champ obligatoire que le brouillon perdait", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fait l'aller-retour comme le reste du devis", () => {
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });

    saveDevisDraft("mission-date", { ...SAMPLE, dateDebut: "2026-10-01" });
    expect(loadDevisDraft("mission-date")?.dateDebut).toBe("2026-10-01");
  });

  it("un brouillon d'avant l'ajout du champ se relit sans erreur", () => {
    // Ces brouillons sont déjà dans le localStorage des prestataires : ils n'ont pas de
    // dateDebut et doivent rester lisibles, pas faire échouer la restauration.
    vi.stubGlobal("window", { localStorage: fakeLocalStorage() });

    saveDevisDraft("mission-legacy", SAMPLE);
    const loaded = loadDevisDraft("mission-legacy");
    expect(loaded).not.toBeNull();
    expect(loaded?.dateDebut).toBeUndefined();
    expect(restorableDateDebut(loaded!)).toEqual({ value: "", expired: false });
  });

  it("restaure une date encore à venir, et le jour même", () => {
    expect(restorableDateDebut({ dateDebut: "2026-10-01" }, "2026-09-10")).toEqual({ value: "2026-10-01", expired: false });
    expect(restorableDateDebut({ dateDebut: "2026-09-10" }, "2026-09-10")).toEqual({ value: "2026-09-10", expired: false });
  });

  it("ne restaure PAS une date passée — elle partirait sinon au client sans reconfirmation", () => {
    expect(restorableDateDebut({ dateDebut: "2026-08-01" }, "2026-09-10")).toEqual({
      value: "",
      expired: true,
      expiredValue: "2026-08-01",
    });
  });

  it("`expired` sépare la date écartée du brouillon qui n'en avait pas — sinon rien à signaler", () => {
    // Les deux rendent un champ vide ; seul le premier cas justifie un avertissement, et il
    // rappelle la date écartée pour que le prestataire sache laquelle remplacer.
    expect(restorableDateDebut({ dateDebut: undefined }, "2026-09-10").expired).toBe(false);
    expect(restorableDateDebut({ dateDebut: "2026-09-09" }, "2026-09-10").expired).toBe(true);
  });
});
