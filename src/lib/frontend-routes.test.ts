import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CONFIG_DRIVEN_PAGES,
  LINKABLE_ROUTES,
  PUBLIC_ROUTES,
  isLinkableHref,
} from "@/lib/frontend-defaults";

const APP_DIR = path.resolve(__dirname, "../app");

// Une route de src/app peut vivre sous un groupe de routes — /faq est servie par
// src/app/(public)/faq/page.tsx. Les deux emplacements sont donc admis.
function pageExists(route: string): boolean {
  const segment = route === "/" ? "" : route.slice(1);
  return (
    existsSync(path.join(APP_DIR, segment, "page.tsx")) ||
    existsSync(path.join(APP_DIR, "(public)", segment, "page.tsx"))
  );
}

describe("routes liables depuis les menus éditables", () => {
  // Le garde-fou n'a de valeur que si sa liste dit vrai. Sans ce test, supprimer une page de
  // src/app laisserait la route dans LINKABLE_ROUTES, donc autorisée à l'écriture, donc
  // publiable en lien mort — exactement ce que la liste existe pour empêcher.
  it.each(LINKABLE_ROUTES)("%s est servie par une page réelle", (route) => {
    expect(pageExists(route)).toBe(true);
  });

  it.each(PUBLIC_ROUTES.map((p) => p.path))("la page éditoriale %s existe", (route) => {
    expect(pageExists(route)).toBe(true);
  });

  it("refuse une destination qui n'existe pas", () => {
    expect(isLinkableHref("/carrieres")).toBe(false);
    expect(isLinkableHref("/blog-afrotech")).toBe(false);
    expect(isLinkableHref("")).toBe(false);
  });

  it("accepte les routes réelles, les ancres et les liens externes sécurisés", () => {
    expect(isLinkableHref("/faq")).toBe(true);
    expect(isLinkableHref("/recherche?domaine=Plomberie")).toBe(true);
    expect(isLinkableHref("#newsletter")).toBe(true);
    expect(isLinkableHref("https://exemple.org/partenaire")).toBe(true);
  });

  it("refuse le protocole javascript et les URL non sécurisées", () => {
    expect(isLinkableHref("javascript:alert(1)")).toBe(false);
    expect(isLinkableHref("http://exemple.org")).toBe(false);
  });
});

// La liste des pages « pilotées » commande ce que l'écran d'administration laisse éditer. Si
// elle dérive du code, la console redevient ce qu'elle prétend remplacer : un formulaire qui
// enregistre sans effet. Ces deux tests l'ancrent au disque, dans les deux sens.
describe("pages dont le référencement vient de la configuration", () => {
  function sourceOf(route: string): string {
    const segment = route.slice(1);
    const candidats = [
      path.join(APP_DIR, segment, "page.tsx"),
      path.join(APP_DIR, "(public)", segment, "page.tsx"),
    ];
    const trouve = candidats.find((c) => existsSync(c));
    if (!trouve) throw new Error(`page introuvable pour ${route}`);
    return readFileSync(trouve, "utf8");
  }

  it.each(CONFIG_DRIVEN_PAGES)("%s compose ses métadonnées depuis la configuration", (route) => {
    const source = sourceOf(route);
    expect(source).toContain("frontendPageMetadata");
    expect(source).toContain(`"${route}"`);
    // Un `metadata` statique résiduel gagnerait sur generateMetadata et annulerait le câblage.
    expect(source).not.toMatch(/export const metadata/);
  });

  it("n'annonce comme pilotée aucune page qui ne l'est pas", () => {
    for (const route of PUBLIC_ROUTES.map((p) => p.path)) {
      if (CONFIG_DRIVEN_PAGES.includes(route)) continue;
      expect(sourceOf(route).includes("frontendPageMetadata"), `${route} est câblé mais absent de CONFIG_DRIVEN_PAGES`).toBe(false);
    }
  });

  it("ne référence que des routes publiques connues", () => {
    const connues = new Set(PUBLIC_ROUTES.map((p) => p.path));
    for (const route of CONFIG_DRIVEN_PAGES) expect(connues.has(route)).toBe(true);
  });
});
