/**
 * Brouillon local du tunnel de création de mission (2026-09-23).
 *
 * Ce module est un CONFORT : il ne doit jamais faire échouer la création d'une mission. Ces
 * tests vérifient donc autant ce qu'il sauvegarde que ce qu'il refuse de faire échouer —
 * stockage absent, plein, ou contenu illisible.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { saveMissionDraft, loadMissionDraft, clearMissionDraft } from "./mission-draft";

const KEY = "flexwork:mission-draft";

function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    ...impl,
  } as Storage;
  vi.stubGlobal("window", { localStorage: storage });
  return store;
}

const draft = {
  step: 2,
  draftId: "d7f3c1a0-0000-4000-8000-000000000000",
  titre: "Réfection plomberie",
  description: "Une description de mission suffisamment détaillée.",
  cahierDesCharges: "",
  categorieId: "cat1",
  categorieLabel: "BTP et Construction",
  metierId: "met1",
  metierLabel: "Plomberie",
  competences: ["Soudure", "Placo"],
  professionalType: "ARTISAN",
  level: "Senior",
  maxCandidatures: "5",
  urgent: true,
  pays: "BJ",
  ville: "Cotonou",
  quartier: "Fidjrossè",
  mode: "presentiel",
  dateDebut: "2026-07-01",
  delaiJours: "5",
  materiel: "client",
  budgetType: "RATE",
  financingModeKey: "S2J",
  amount: "",
  budgetMin: "",
  budgetMax: "",
  timeRate: "5000",
  timeMaxQuantity: "40",
  maxRevisionRounds: "3",
  dateExpiration: "",
  currency: "XOF",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aller-retour", () => {
  beforeEach(() => installStorage());

  it("restaure la saisie à l'identique, étape comprise", () => {
    saveMissionDraft(draft);
    const loaded = loadMissionDraft();
    expect(loaded).toMatchObject(draft);
    expect(loaded?.step).toBe(2);
    // Sans lui, les pièces jointes déjà déposées seraient orphelines à la reprise.
    expect(loaded?.draftId).toBe(draft.draftId);
    expect(loaded?.competences).toEqual(["Soudure", "Placo"]);
  });

  it("horodate chaque sauvegarde", () => {
    saveMissionDraft(draft);
    expect(new Date(loadMissionDraft()!.savedAt).getTime()).toBeGreaterThan(0);
  });

  it("ne renvoie rien quand aucun brouillon n'a été enregistré", () => {
    expect(loadMissionDraft()).toBeNull();
  });

  it("efface sur demande — la mission créée ne doit pas laisser de brouillon fantôme", () => {
    saveMissionDraft(draft);
    clearMissionDraft();
    expect(loadMissionDraft()).toBeNull();
  });
});

describe("péremption", () => {
  it("ignore et purge un brouillon vieux de plus de sept jours", () => {
    const store = installStorage();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    store.set(KEY, JSON.stringify({ ...draft, savedAt: old }));

    expect(loadMissionDraft()).toBeNull();
    // Purgé, pas seulement ignoré : sinon il resterait à traîner indéfiniment.
    expect(store.has(KEY)).toBe(false);
  });

  it("conserve un brouillon de la veille", () => {
    const store = installStorage();
    store.set(KEY, JSON.stringify({ ...draft, savedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }));
    expect(loadMissionDraft()?.titre).toBe("Réfection plomberie");
  });

  it("ignore un brouillon sans horodatage, qu'on ne sait pas dater", () => {
    const store = installStorage();
    store.set(KEY, JSON.stringify({ ...draft, savedAt: "" }));
    expect(loadMissionDraft()).toBeNull();
  });
});

describe("ne casse jamais le tunnel", () => {
  it("survit à un contenu illisible plutôt que de faire planter la page", () => {
    const store = installStorage();
    store.set(KEY, "{ ceci n'est pas du json");
    expect(() => loadMissionDraft()).not.toThrow();
    expect(loadMissionDraft()).toBeNull();
  });

  it("survit à un stockage plein", () => {
    installStorage({
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    });
    expect(() => saveMissionDraft(draft)).not.toThrow();
  });

  it("survit à un stockage qui refuse la lecture (navigation privée)", () => {
    installStorage({
      getItem: () => {
        throw new DOMException("SecurityError");
      },
    });
    expect(() => loadMissionDraft()).not.toThrow();
    expect(loadMissionDraft()).toBeNull();
  });

  it("ne fait rien côté serveur, où `window` n'existe pas", () => {
    // Pas de stockage installé : le module doit sortir sans toucher à rien.
    expect(() => saveMissionDraft(draft)).not.toThrow();
    expect(loadMissionDraft()).toBeNull();
    expect(() => clearMissionDraft()).not.toThrow();
  });
});
