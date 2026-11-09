import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_MENUS,
  DEFAULT_SECTIONS,
  DEFAULT_SETTINGS,
  PUBLIC_ROUTES,
} from "@/lib/frontend-defaults";

/**
 * Installe le contenu public de départ, à l'identique de ce que les composants affichaient
 * en dur. IDEMPOTENT : chaque entrée est identifiée par sa clé fonctionnelle, jamais par un
 * identifiant généré, donc rejouer le seed ne duplique rien et n'écrase pas une édition.
 *
 * Les items de section, eux, ne sont posés QUE si la section n'en a aucun : ils n'ont pas de
 * clé naturelle, et les réinsérer à chaque exécution ferait réapparaître une entrée que
 * l'administrateur vient de retirer.
 */
export async function seedFrontendContent(prisma: PrismaClient): Promise<{
  sections: number;
  items: number;
  menuItems: number;
  pages: number;
  settings: number;
}> {
  let itemCount = 0;
  for (const [index, section] of DEFAULT_SECTIONS.entries()) {
    const saved = await prisma.frontendSection.upsert({
      where: { key: section.key },
      create: {
        key: section.key,
        label: section.label,
        title: section.title,
        subtitle: section.subtitle,
        ctaText: section.ctaText,
        ctaLink: section.ctaLink,
        sortOrder: index + 1,
        status: "publie",
      },
      update: {},
    });

    const existing = await prisma.frontendSectionItem.count({ where: { sectionId: saved.id } });
    if (existing === 0 && section.items.length > 0) {
      await prisma.frontendSectionItem.createMany({
        data: section.items.map((item, itemIndex) => ({
          sectionId: saved.id,
          label: item.label,
          sublabel: item.sublabel,
          href: item.href,
          icon: item.icon,
          color: item.color,
          imageUrl: item.imageUrl,
          sortOrder: itemIndex + 1,
          status: "publie" as const,
        })),
      });
      itemCount += section.items.length;
    }
  }

  let menuCount = 0;
  for (const [menu, definition] of Object.entries(DEFAULT_MENUS)) {
    const existing = await prisma.frontendMenuItem.count({ where: { menu } });
    if (existing > 0) continue;
    await prisma.frontendMenuItem.createMany({
      data: definition.items.map((item, index) => ({
        menu,
        label: item.label,
        href: item.href,
        description: item.description,
        sortOrder: index + 1,
        status: "publie" as const,
      })),
    });
    menuCount += definition.items.length;
  }

  for (const route of PUBLIC_ROUTES) {
    await prisma.frontendPage.upsert({
      where: { path: route.path },
      create: { path: route.path, title: route.title, status: "publie" },
      update: {},
    });
  }

  for (const setting of DEFAULT_SETTINGS) {
    await prisma.frontendSetting.upsert({
      where: { key: setting.key },
      create: setting,
      update: {},
    });
  }

  return {
    sections: DEFAULT_SECTIONS.length,
    items: itemCount,
    menuItems: menuCount,
    pages: PUBLIC_ROUTES.length,
    settings: DEFAULT_SETTINGS.length,
  };
}
