import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor, requireFrontendReader } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { isLinkableHref } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

/** Sections d'accueil en cours d'édition, items compris, brouillons inclus. */
export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const sections = await prisma.frontendSection.findMany({
    where: { status: { not: "archive" } },
    orderBy: { sortOrder: "asc" },
    include: {
      items: { where: { status: { not: "archive" } }, orderBy: { sortOrder: "asc" } },
    },
  });
  return NextResponse.json({ sections });
}

const itemSchema = z.object({
  sectionId: z.string().min(1),
  label: z.string().min(1).max(120),
  sublabel: z.string().max(240).optional(),
  href: z.string().max(240).optional(),
  icon: z.string().max(8).optional(),
  color: z.string().max(120).optional(),
  imageUrl: z.string().max(240).optional(),
});

/**
 * Ajout d'un item à une section.
 *
 * Aucune route de CRÉATION de section : les clés de section sont le point d'ancrage des
 * composants React (`categories_bar` → CategoriesBar.tsx). Une section créée depuis
 * l'administration n'aurait aucun composant pour la rendre — elle serait éditable et
 * invisible, c'est-à-dire un mensonge d'interface. Les sections naissent avec le code, dans
 * DEFAULT_SECTIONS ; l'administration édite leur contenu.
 */
export async function POST(req: Request) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const parsed = itemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const input = parsed.data;
  if (input.href && !isLinkableHref(input.href)) {
    return NextResponse.json({ error: "unlinkable_href", href: input.href }, { status: 422 });
  }

  const section = await prisma.frontendSection.findUnique({ where: { id: input.sectionId } });
  if (!section) return NextResponse.json({ error: "section_not_found" }, { status: 404 });

  const last = await prisma.frontendSectionItem.findFirst({
    where: { sectionId: input.sectionId },
    orderBy: { sortOrder: "desc" },
  });

  const created = await prisma.frontendSectionItem.create({
    data: { ...input, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_section_item_create",
    targetType: "FrontendSectionItem",
    targetId: created.id,
    justification: `Ajout de « ${input.label} » à la section ${section.key}`,
  });
  return NextResponse.json(created, { status: 201 });
}
