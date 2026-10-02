/**
 * Le registre des modules est une CARTE, et une carte qui ment est pire que pas de carte.
 *
 * L'écran de vue d'ensemble affiche, pour chaque module actif, les fichiers qu'il pilote.
 * Ce test vérifie que ces fichiers existent, et qu'un module déclaré actif lit ou écrit
 * réellement la configuration. Sans lui, renommer un composant laisserait la console annoncer
 * un pilotage qui n'existe plus — exactement le genre d'affirmation invérifiable que cette
 * console est censée remplacer.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FRONTEND_MODULES, activeModules } from "@/lib/frontend-modules";

const ROOT = path.resolve(__dirname, "../..");

describe("registre des modules d'administration du frontend", () => {
  it("couvre les vingt-deux modules des maquettes", () => {
    expect(FRONTEND_MODULES.length).toBe(22);
  });

  it.each(activeModules().flatMap((m) => m.drives.map((file) => [m.label, file] as const)))(
    "%s — %s existe",
    (_label, file) => {
      expect(existsSync(path.join(ROOT, file))).toBe(true);
    }
  );

  // Un module actif doit toucher la configuration, d'une façon ou d'une autre. Les fichiers
  // d'interface d'administration passent par fetch, les composants publics et les modules de
  // service par un import : on cherche donc l'un ou l'autre indice.
  it.each(activeModules().map((m) => [m.label, m.drives] as const))(
    "%s pilote des fichiers qui touchent réellement la configuration",
    (_label, drives) => {
      for (const file of drives) {
        const source = readFileSync(path.join(ROOT, file), "utf8");
        const touchesConfig =
          source.includes("frontend-config") ||
          source.includes("frontend-defaults") ||
          source.includes("/api/admin/frontend") ||
          source.includes("frontendRelease") ||
          source.includes("admin-audit") ||
          source.includes("adminAuditLog") ||
          source.includes("/api/admin/audit") ||
          source.includes("frontend-modules") ||
          source.includes("/api/categories") ||
          source.includes("frontend-admin-guard");
        expect(touchesConfig, `${file} ne référence aucune pièce de l'administration du frontend`).toBe(true);
      }
    }
  );

  it("n'annonce aucun fichier piloté pour un module absent", () => {
    for (const entry of FRONTEND_MODULES.filter((m) => m.state === "absent")) {
      expect(entry.drives).toEqual([]);
    }
  });

  // Le motif d'absence est ce qui rend la liste utile : sans lui, treize lignes grisées ne
  // disent rien de ce qu'il faudrait construire.
  it("justifie chaque module absent", () => {
    for (const entry of FRONTEND_MODULES.filter((m) => m.state === "absent")) {
      expect(entry.missing, `${entry.label} est absent sans motif`).toBeTruthy();
      expect(entry.missing!.length).toBeGreaterThan(40);
    }
  });

  it("n'a pas d'identifiant en double", () => {
    const ids = FRONTEND_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
