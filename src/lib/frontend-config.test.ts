/**
 * Sémantique de résolution du contenu public — la partie du module qui décide, pour chaque
 * section, entre « ce que l'éditeur a publié », « ce qu'il a retiré » et « ce qu'il n'a jamais
 * touché ». Ces trois cas se ressemblent dans le code et ne se ressemblent pas du tout à
 * l'écran : les confondre fait réapparaître un bloc qu'on vient de retirer.
 *
 * Module pur, sans base : ces tests décrivent la règle, pas l'état d'une installation.
 */

import { describe, expect, it } from "vitest";
import {
  fallbackFrontendConfig,
  frontendEtag,
  hasPendingChanges,
  parseHeroTitle,
  resolveMenu,
  resolveSection,
  resolveSetting,
  stableStringify,
  type FrontendConfig,
} from "@/lib/frontend-config";
import { DEFAULT_MENUS, HERO_TITLE } from "@/lib/frontend-defaults";

function configWith(sections: FrontendConfig["sections"], menus: FrontendConfig["menus"] = {}): FrontendConfig {
  return { ...fallbackFrontendConfig(), version: 7, sections, menus };
}

describe("résolution d'une section", () => {
  it("rend le socle de repli quand la clé n'a jamais été publiée", () => {
    const section = resolveSection(configWith({}), "categories_bar");
    expect(section?.items.length).toBe(9);
    expect(section?.items[0].label).toBe("Design Graphique");
  });

  it("rend le contenu publié quand il existe", () => {
    const section = resolveSection(
      configWith({
        categories_bar: { key: "categories_bar", label: "Barre", visible: true, items: [{ label: "Soudure" }] },
      }),
      "categories_bar"
    );
    expect(section?.items).toEqual([{ label: "Soudure" }]);
  });

  // Le piège central de ce module. Une section retirée par l'éditeur doit rester PRÉSENTE
  // dans le document publié, marquée invisible. Si on l'omettait, la résolution retomberait
  // sur le socle de repli — et le bloc que l'éditeur vient de retirer réapparaîtrait avec son
  // contenu d'origine, en donnant en plus l'impression que le geste n'a pas été enregistré.
  it("rend null pour une section retirée, sans repli sur le socle", () => {
    const section = resolveSection(
      configWith({
        categories_bar: { key: "categories_bar", label: "Barre", visible: false, items: [] },
      }),
      "categories_bar"
    );
    expect(section).toBeNull();
  });

  it("respecte une section publiée VIDE — vider n'est pas ne rien avoir édité", () => {
    const section = resolveSection(
      configWith({ categories_bar: { key: "categories_bar", label: "Barre", visible: true, items: [] } }),
      "categories_bar"
    );
    expect(section?.items).toEqual([]);
  });

  it("rend null pour une clé que le code ne connaît pas", () => {
    expect(resolveSection(configWith({}), "bandeau-promo")).toBeNull();
  });
});

describe("résolution d'un menu", () => {
  it("retombe sur le socle de repli quand le menu n'a jamais été publié", () => {
    expect(resolveMenu(configWith({}), "header_explore")).toEqual(DEFAULT_MENUS.header_explore.items);
  });

  it("respecte un menu publié vide", () => {
    expect(resolveMenu(configWith({}, { header_explore: [] }), "header_explore")).toEqual([]);
  });
});

describe("réglages", () => {
  it("retombe sur la valeur d'origine quand le réglage n'a pas été édité", () => {
    expect(resolveSetting(fallbackFrontendConfig(), "site.name")).toBe("FlexWork");
  });

  it("rend une chaîne vide plutôt que undefined pour une clé inconnue", () => {
    expect(resolveSetting(fallbackFrontendConfig(), "site.inexistant")).toBe("");
  });
});

describe("titre de héros", () => {
  it("sépare les lignes et le segment mis en dégradé", () => {
    expect(parseHeroTitle(HERO_TITLE)).toEqual([
      [{ text: "Trouve le bon", highlight: false }],
      [{ text: "talent africain,", highlight: true }],
      [{ text: "tout de suite ✨", highlight: false }],
    ]);
  });

  // Le titre est saisi à la main dans un champ de texte : un marqueur oublié ou dépareillé
  // doit produire un titre correct, jamais une exception dans un composant serveur.
  it("rend un titre sans marqueur comme une ligne simple", () => {
    expect(parseHeroTitle("Trouvez le bon expert")).toEqual([[{ text: "Trouvez le bon expert", highlight: false }]]);
  });

  it("supporte un marqueur dépareillé sans lever", () => {
    expect(() => parseHeroTitle("Trouvez **le bon expert")).not.toThrow();
  });

  it("supporte une chaîne vide", () => {
    expect(parseHeroTitle("")).toEqual([[]]);
  });
});

describe("validateur d'ETag", () => {
  it("change avec la version, et seulement avec elle", () => {
    expect(frontendEtag(24)).toBe('W/"frontend-24"');
    expect(frontendEtag(25)).not.toBe(frontendEtag(24));
  });

  // Les deux points d'entrée publics servent des documents différents tirés de la même
  // version. Sans portée distincte, un client qui met les deux en cache présenterait le
  // validateur de l'un pour obtenir l'autre et recevrait un 304 pour un document qu'il n'a pas.
  it("distingue la portée taxonomie de la configuration complète", () => {
    expect(frontendEtag(24, "taxonomy")).not.toBe(frontendEtag(24));
  });
});

describe("écart entre le brouillon et ce qui est en ligne", () => {
  const draft = {
    settings: { "site.name": "FlexWork" },
    sections: {
      hero: { key: "hero", label: "Héros", title: "A", subtitle: "B", visible: true, items: [] },
    },
    menus: { header_explore: [{ label: "FAQ", href: "/faq" }] },
    taxonomy: [],
    pages: [],
  };

  // Le défaut qui a motivé stableStringify, constaté en conditions réelles le 2026-09-21 :
  // l'instantané publié fait l'aller-retour par une colonne `jsonb` de Postgres, qui réordonne
  // les clés (par longueur, puis alphabétiquement). Une comparaison naïve déclarait donc
  // « brouillon en attente » en permanence — y compris sur une base tout juste publiée.
  it("ignore l'ordre des clés, que Postgres ne conserve pas", () => {
    const reordered = {
      ...fallbackFrontendConfig(),
      version: 1,
      settings: draft.settings,
      sections: {
        hero: { key: "hero", items: [], label: "Héros", title: "A", visible: true, subtitle: "B" },
      },
      menus: { header_explore: [{ href: "/faq", label: "FAQ" }] },
    } as unknown as FrontendConfig;

    expect(hasPendingChanges(draft, reordered)).toBe(false);
  });

  it("voit une vraie différence de contenu", () => {
    const published = {
      ...fallbackFrontendConfig(),
      version: 1,
      settings: draft.settings,
      sections: {
        hero: { key: "hero", label: "Héros", title: "TITRE MODIFIÉ", subtitle: "B", visible: true, items: [] },
      },
      menus: draft.menus,
    } as unknown as FrontendConfig;

    expect(hasPendingChanges(draft, published)).toBe(true);
  });

  // L'ORDRE d'un tableau est du contenu, lui : réordonner les colonnes du pied de page change
  // ce que voit le visiteur, et doit donc compter comme une modification à publier.
  it("tient compte de l'ordre des tableaux", () => {
    const published = {
      ...fallbackFrontendConfig(),
      version: 1,
      settings: draft.settings,
      sections: draft.sections,
      menus: {
        header_explore: [
          { label: "FAQ", href: "/faq" },
          { label: "Tarifs", href: "/tarifs" },
        ],
      },
    } as unknown as FrontendConfig;

    expect(hasPendingChanges(draft, published)).toBe(true);
  });

  it("traite une propriété absente et une propriété undefined comme identiques", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it("sérialise les valeurs simples sans lever", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});
