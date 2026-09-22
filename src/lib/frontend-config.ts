import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_MENUS,
  DEFAULT_SECTIONS,
  DEFAULT_SETTINGS,
  type DefaultSection,
} from "@/lib/frontend-defaults";

// Document servi au frontend public, et FIGÉ dans FrontendRelease.snapshot à chaque
// publication. C'est le seul contrat entre l'administration et les composants : un composant
// ne lit jamais les tables de travail, il lit ce document.
//
// Il est volontairement PLAT et sans identifiants de base : les `id` cuid des tables n'ont
// aucun sens pour un composant de rendu, et les exposer inviterait à écrire du code public
// qui dépend de la ligne plutôt que de la clé fonctionnelle.

export type FrontendConfigItem = {
  label: string;
  sublabel?: string;
  href?: string;
  icon?: string;
  color?: string;
  imageUrl?: string;
};

export type FrontendConfigSection = {
  key: string;
  label: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  /** false = section retirée de la page par l'éditeur (statut désactivé ou brouillon). */
  visible: boolean;
  items: FrontendConfigItem[];
};

export type FrontendConfigMenuItem = { label: string; href: string; description?: string };

export type FrontendConfigCompetency = { slug: string; name: string; verificationExpected: boolean };
export type FrontendConfigSpecialty = {
  slug: string;
  name: string;
  description?: string;
  competencies: FrontendConfigCompetency[];
};
export type FrontendConfigDomain = {
  slug: string;
  name: string;
  icon?: string;
  specialties: FrontendConfigSpecialty[];
};

export type FrontendConfigPage = { path: string; title: string; seoTitle?: string; seoDescription?: string };

export type FrontendConfig = {
  version: number;
  publishedAt: string | null;
  settings: Record<string, string>;
  sections: Record<string, FrontendConfigSection>;
  menus: Record<string, FrontendConfigMenuItem[]>;
  taxonomy: FrontendConfigDomain[];
  pages: FrontendConfigPage[];
};

// ── Construction depuis les tables de travail ──────────────────────────────────────────────

const PUBLISHED = { status: "publie" } as const;

/**
 * État COURANT des tables de travail, mis en forme de document public.
 *
 * Ne filtre que sur le statut : ce qui est publié entre, le reste non. Sert à deux choses —
 * l'aperçu avant publication, et la publication elle-même. Les deux doivent voir exactement la
 * même chose, sans quoi l'aperçu mentirait ; d'où une seule fonction plutôt que deux.
 */
export async function buildFrontendDraft(): Promise<Omit<FrontendConfig, "version" | "publishedAt">> {
  const [sections, menuItems, settings, domains, pages] = await Promise.all([
    prisma.frontendSection.findMany({
      where: { status: { not: "archive" } },
      orderBy: { sortOrder: "asc" },
      include: { items: { where: PUBLISHED, orderBy: { sortOrder: "asc" } } },
    }),
    prisma.frontendMenuItem.findMany({ where: PUBLISHED, orderBy: { sortOrder: "asc" } }),
    prisma.frontendSetting.findMany(),
    prisma.taxonomyDomain.findMany({
      where: PUBLISHED,
      orderBy: { sortOrder: "asc" },
      include: {
        specialties: {
          where: PUBLISHED,
          orderBy: { sortOrder: "asc" },
          include: { competencies: { where: PUBLISHED, orderBy: { sortOrder: "asc" } } },
        },
      },
    }),
    prisma.frontendPage.findMany({ where: PUBLISHED, orderBy: { path: "asc" } }),
  ]);

  const sectionsByKey: Record<string, FrontendConfigSection> = {};
  for (const s of sections) {
    sectionsByKey[s.key] = {
      key: s.key,
      label: s.label,
      title: s.title ?? undefined,
      subtitle: s.subtitle ?? undefined,
      ctaText: s.ctaText ?? undefined,
      ctaLink: s.ctaLink ?? undefined,
      // Une section en brouillon ou désactivée reste PRÉSENTE dans le document, invisible.
      // L'omettre la ferait retomber sur le socle de repli côté composant — c'est-à-dire
      // réapparaître, exactement à l'inverse de ce que l'éditeur a demandé.
      visible: s.status === "publie",
      items: s.items.map((i) => ({
        label: i.label,
        sublabel: i.sublabel ?? undefined,
        href: i.href ?? undefined,
        icon: i.icon ?? undefined,
        color: i.color ?? undefined,
        imageUrl: i.imageUrl ?? undefined,
      })),
    };
  }

  const menus: Record<string, FrontendConfigMenuItem[]> = {};
  for (const item of menuItems) {
    (menus[item.menu] ??= []).push({
      label: item.label,
      href: item.href,
      description: item.description ?? undefined,
    });
  }

  return {
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    sections: sectionsByKey,
    menus,
    taxonomy: domains.map((d) => ({
      slug: d.slug,
      name: d.name,
      icon: d.icon ?? undefined,
      specialties: d.specialties.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description ?? undefined,
        competencies: s.competencies.map((c) => ({
          slug: c.slug,
          name: c.name,
          verificationExpected: c.verificationExpected,
        })),
      })),
    })),
    pages: pages.map((p) => ({
      path: p.path,
      title: p.title,
      seoTitle: p.seoTitle ?? undefined,
      seoDescription: p.seoDescription ?? undefined,
    })),
  };
}

// ── Lecture publique ───────────────────────────────────────────────────────────────────────

/** Document rendu quand aucune publication n'existe encore : le socle de repli, version 0. */
export function fallbackFrontendConfig(): FrontendConfig {
  return {
    version: 0,
    publishedAt: null,
    settings: Object.fromEntries(DEFAULT_SETTINGS.map((s) => [s.key, s.value])),
    sections: {},
    menus: {},
    taxonomy: [],
    pages: [],
  };
}

/**
 * Dernière version publiée. Mémoïsée par requête (`cache`) : la page d'accueil la demande
 * depuis six composants serveur distincts, qui ne doivent pas déclencher six requêtes.
 *
 * NE LÈVE JAMAIS. Une base indisponible renvoie le socle de repli, et la page publique reste
 * servie : le contenu éditorial n'est pas une raison de rendre une erreur 500 au visiteur.
 */
type ConfigLoader = () => Promise<FrontendConfig>;

// `cache` de React n'existe que dans un runtime serveur React. Ce module est aussi importé
// par le seed Prisma et par les tests, qui tournent sous Node nu : l'appeler y lève
// « cache is not a function » et fait échouer le seed entier. La mémoïsation n'y a de toute
// façon aucun objet — hors requête, il n'y a rien à dédoublonner.
const memoizePerRequest = (fn: ConfigLoader): ConfigLoader =>
  typeof cache === "function" ? cache(fn) : fn;

export const getPublishedFrontendConfig = memoizePerRequest(async (): Promise<FrontendConfig> => {
  try {
    const release = await prisma.frontendRelease.findFirst({ orderBy: { version: "desc" } });
    if (!release) return fallbackFrontendConfig();

    const snapshot = release.snapshot as unknown as Omit<FrontendConfig, "version" | "publishedAt">;
    return {
      ...snapshot,
      version: release.version,
      publishedAt: release.publishedAt.toISOString(),
    };
  } catch {
    return fallbackFrontendConfig();
  }
});

const DEFAULT_SECTION_BY_KEY = new Map<string, DefaultSection>(DEFAULT_SECTIONS.map((s) => [s.key, s]));

/**
 * Section prête à rendre, ou `null` si l'éditeur l'a retirée de la page.
 *
 * Trois cas, dans cet ordre : la clé est absente du document publié → socle de repli (rien
 * n'a jamais été édité) ; la clé est présente mais invisible → `null` (retrait volontaire) ;
 * sinon → contenu publié.
 */
export function resolveSection(config: FrontendConfig, key: string): FrontendConfigSection | null {
  const published = config.sections[key];
  if (published) return published.visible ? published : null;

  const fallback = DEFAULT_SECTION_BY_KEY.get(key);
  if (!fallback) return null;
  return {
    key: fallback.key,
    label: fallback.label,
    title: fallback.title,
    subtitle: fallback.subtitle,
    ctaText: fallback.ctaText,
    ctaLink: fallback.ctaLink,
    visible: true,
    items: fallback.items,
  };
}

/** Entrées d'un menu, socle de repli compris. Un menu publié VIDE reste vide : c'est un choix. */
export function resolveMenu(config: FrontendConfig, key: string): FrontendConfigMenuItem[] {
  const published = config.menus[key];
  if (published) return published;
  return DEFAULT_MENUS[key]?.items ?? [];
}

export function resolveSetting(config: FrontendConfig, key: string): string {
  return config.settings[key] ?? DEFAULT_SETTINGS.find((s) => s.key === key)?.value ?? "";
}

/**
 * Titre de héros : séparation des lignes et du segment mis en dégradé (voir HERO_TITLE).
 * Un titre sans marqueur `**` rend une seule portion non mise en valeur — jamais d'erreur.
 */
export function parseHeroTitle(title: string): { text: string; highlight: boolean }[][] {
  return title.split("\n").map((line) =>
    line
      .split(/\*\*(.+?)\*\*/g)
      .map((part, index) => ({ text: part, highlight: index % 2 === 1 }))
      .filter((part) => part.text.length > 0)
  );
}

// ── Publication ────────────────────────────────────────────────────────────────────────────

/**
 * Fige l'état courant en une nouvelle version. `rolledBackFromVersion` n'est renseigné que
 * par un retour arrière ; l'instantané est alors celui de la version reprise, et non l'état
 * des tables de travail — sinon « revenir à la v23 » publierait le brouillon en cours.
 */
export async function publishFrontend(params: {
  // `null` pour la publication initiale posée par le seed : aucun administrateur ne l'a
  // demandée, et lui en attribuer un serait une fausse trace dans l'historique.
  adminId: string | null;
  note?: string;
  snapshot?: Omit<FrontendConfig, "version" | "publishedAt">;
  rolledBackFromVersion?: number;
}) {
  const snapshot = params.snapshot ?? (await buildFrontendDraft());
  const last = await prisma.frontendRelease.findFirst({ orderBy: { version: "desc" } });

  return prisma.frontendRelease.create({
    data: {
      version: (last?.version ?? 0) + 1,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      publishedById: params.adminId,
      note: params.note,
      rolledBackFromVersion: params.rolledBackFromVersion,
    },
  });
}

export async function rollbackFrontend(params: { adminId: string; version: number; note?: string }) {
  const source = await prisma.frontendRelease.findUnique({ where: { version: params.version } });
  if (!source) return null;

  return publishFrontend({
    adminId: params.adminId,
    note: params.note ?? `Retour arrière sur la v${params.version}`,
    snapshot: source.snapshot as unknown as Omit<FrontendConfig, "version" | "publishedAt">,
    rolledBackFromVersion: params.version,
  });
}

/**
 * Métadonnées d'une page publique, composées depuis la configuration publiée.
 *
 * Sans cette fonction, le module « Pages » de la console serait un mensonge poli : il propose
 * d'éditer un titre et une description de référencement, mais chaque page de src/app/(public)
 * exporte son propre `metadata` statique, qui gagne toujours. On modifierait le référencement
 * de /faq dans la console sans que /faq change d'un octet.
 *
 * Composition du titre d'onglet, dans cet ordre :
 *   1. `seoTitle` s'il est renseigné — un titre de référencement se rédige en entier ;
 *   2. sinon « <titre de la page> — <nom du site> », la forme déjà en usage ;
 *   3. sinon le repli fourni par la page, si la configuration ne la connaît pas.
 */
export async function frontendPageMetadata(path: string, fallbackTitle: string): Promise<Metadata> {
  const config = await getPublishedFrontendConfig();
  const page = config.pages.find((p) => p.path === path);

  const seoTitle = page?.seoTitle?.trim();
  const pageTitle = page?.title?.trim();
  const siteName = resolveSetting(config, "site.name");
  const description = page?.seoDescription?.trim();

  return {
    title: seoTitle || (pageTitle ? `${pageTitle} — ${siteName}` : fallbackTitle),
    // Pas de description propre : la page hérite de celle du gabarit racine, qui est éditable
    // elle aussi. Écraser avec une chaîne vide priverait la page de toute description.
    ...(description ? { description } : {}),
  };
}

/**
 * Sérialisation STABLE : clés triées à toute profondeur, tableaux dans leur ordre.
 *
 * Indispensable pour comparer un brouillon à ce qui est en ligne. L'instantané publié fait
 * l'aller-retour par une colonne `jsonb` de Postgres, qui NE CONSERVE PAS l'ordre des clés —
 * il les réordonne par longueur puis par ordre alphabétique. Un `JSON.stringify` naïf compare
 * donc `{key, label, title, subtitle, visible, items}` à `{key, items, label, title, visible,
 * subtitle}` et les déclare différents, toujours. Constaté en conditions réelles le
 * 2026-09-21 : la console affichait « Brouillon en attente » en permanence, y compris sur une
 * base tout juste publiée — un indicateur toujours allumé ne signale plus rien.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Le brouillon s'écarte-t-il de ce qui est en ligne ?
 *
 * Compare uniquement les parties de contenu : `version` et `publishedAt` décrivent la
 * publication, pas ce qu'elle contient, et les inclure rendrait tout brouillon différent.
 */
export function hasPendingChanges(
  draft: Omit<FrontendConfig, "version" | "publishedAt">,
  published: FrontendConfig
): boolean {
  return (
    stableStringify(draft) !==
    stableStringify({
      settings: published.settings,
      sections: published.sections,
      menus: published.menus,
      taxonomy: published.taxonomy,
      pages: published.pages,
    })
  );
}

/**
 * Validateur d'ETag. Adossé au NUMÉRO DE VERSION, pas à un hachage du contenu : la version ne
 * bouge qu'à la publication, donc un client qui détient la v24 détient exactement l'octet
 * servi pour la v24. Un hachage des tables de travail, lui, changerait à chaque frappe de
 * l'éditeur sans que le public voie quoi que ce soit de différent.
 */
export function frontendEtag(version: number, scope?: string): string {
  return scope ? `W/"frontend-${version}-${scope}"` : `W/"frontend-${version}"`;
}
