import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_MENUS,
  DEFAULT_SECTIONS,
  DEFAULT_SETTINGS,
  PUBLIC_ROUTES,
} from "@/lib/frontend-defaults";

/**
 * Domaines de départ du référentiel.
 *
 * Tirés des libellés que la plateforme emploie DÉJÀ — les neuf catégories de la barre
 * d'accueil et les paliers de risque du seed. Aucun n'est inventé pour faire nombre.
 *
 * Et aucune spécialité ni compétence n'est semée. La maquette en montre 47 et 312 ; les
 * écrire ici reviendrait à livrer un référentiel métier rédigé par un développeur depuis un
 * éditeur de code, là où il relève d'une connaissance du terrain béninois que ce dépôt n'a
 * pas. L'écran d'administration existe précisément pour que quelqu'un qui la détient les
 * saisisse — et il affiche, en face, les libellés réellement saisis par les utilisateurs
 * pour que ce travail parte des données plutôt que d'une page blanche.
 */
const SEED_DOMAINS: { name: string; icon: string }[] = [
  { name: "Design Graphique", icon: "🎨" },
  { name: "Programmation", icon: "💻" },
  { name: "Marketing Digital", icon: "📱" },
  { name: "Vidéo & Animation", icon: "🎬" },
  { name: "Rédaction", icon: "✍️" },
  { name: "Maçonnerie", icon: "🧱" },
  { name: "Plomberie", icon: "🚰" },
  { name: "Électricité", icon: "⚡" },
  { name: "Menuiserie", icon: "🪚" },
  { name: "Carrelage", icon: "🧩" },
  { name: "Peinture", icon: "🖌️" },
  { name: "Jardinage", icon: "🌿" },
  { name: "Nettoyage", icon: "🧽" },
];

function slug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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
  domains: number;
  sections: number;
  items: number;
  menuItems: number;
  pages: number;
  settings: number;
}> {
  let domainCount = 0;
  for (const [index, domain] of SEED_DOMAINS.entries()) {
    await prisma.taxonomyDomain.upsert({
      where: { slug: slug(domain.name) },
      create: {
        slug: slug(domain.name),
        name: domain.name,
        icon: domain.icon,
        sortOrder: index + 1,
        status: "publie",
      },
      update: {},
    });
    domainCount += 1;
  }

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
    domains: domainCount,
    sections: DEFAULT_SECTIONS.length,
    items: itemCount,
    menuItems: menuCount,
    pages: PUBLIC_ROUTES.length,
    settings: DEFAULT_SETTINGS.length,
  };
}
