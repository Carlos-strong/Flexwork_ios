import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireFrontendReader } from "@/lib/frontend-admin-guard";
import { FRONTEND_MODULES } from "@/lib/frontend-modules";
import { DEFAULT_MENUS, PUBLIC_ROUTES } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

/**
 * Vue d'ensemble : ce que l'administration pilote réellement, et où en est la ligne.
 *
 * Les compteurs sont mesurés, jamais annoncés. Un module actif dont le compteur est à zéro
 * se lit comme tel — c'est l'information utile, et c'est exactement ce qu'une console de
 * démonstration dissimule en affichant « 12 éléments » sur chaque carte.
 */
export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const [
    categories,
    metiers,
    services,
    sections,
    sectionItems,
    menuItems,
    pages,
    settings,
    lastRelease,
    releaseCount,
  ] = await Promise.all([
    prisma.categorie.count(),
    prisma.metier.count(),
    prisma.service.count(),
    prisma.frontendSection.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.frontendSectionItem.count({ where: { status: { not: "archive" } } }),
    prisma.frontendMenuItem.count({ where: { status: { not: "archive" } } }),
    prisma.frontendPage.count(),
    prisma.frontendSetting.count(),
    prisma.frontendRelease.findFirst({
      orderBy: { version: "desc" },
      select: {
        version: true,
        publishedAt: true,
        note: true,
        publishedBy: { select: { firstname: true, lastname: true, email: true } },
      },
    }),
    prisma.frontendRelease.count(),
  ]);

  const countByStatus = (rows: { status: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

  return NextResponse.json({
    modules: FRONTEND_MODULES,
    release: lastRelease,
    releaseCount,
    counts: {
      categories,
      metiers,
      services,
      sections: countByStatus(sections),
      sectionsTotal: sections.reduce((n, r) => n + r._count._all, 0),
      sectionItems,
      menuItems,
      menusKnown: Object.keys(DEFAULT_MENUS).length,
      pages,
      pagesKnown: PUBLIC_ROUTES.length,
      settings,
    },
  });
}
