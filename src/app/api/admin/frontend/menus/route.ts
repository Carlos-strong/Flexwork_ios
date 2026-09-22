import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor, requireFrontendReader } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { DEFAULT_MENUS, isLinkableHref } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const items = await prisma.frontendMenuItem.findMany({
    where: { status: { not: "archive" } },
    orderBy: [{ menu: "asc" }, { sortOrder: "asc" }],
  });

  // Les menus connus viennent du CODE (un composant les cite nommément), pas de la base :
  // sans cela, un menu vidé de toutes ses entrées disparaîtrait de l'écran d'édition, et
  // deviendrait impossible à repeupler.
  return NextResponse.json({
    menus: Object.entries(DEFAULT_MENUS).map(([key, def]) => ({
      key,
      label: def.label,
      items: items.filter((i) => i.menu === key),
    })),
    linkable: true,
  });
}

const schema = z.object({
  menu: z.string().min(2).max(60),
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(240),
  description: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const input = parsed.data;
  if (!(input.menu in DEFAULT_MENUS)) {
    return NextResponse.json({ error: "unknown_menu" }, { status: 404 });
  }
  if (!isLinkableHref(input.href)) {
    return NextResponse.json({ error: "unlinkable_href", href: input.href }, { status: 422 });
  }

  const last = await prisma.frontendMenuItem.findFirst({
    where: { menu: input.menu },
    orderBy: { sortOrder: "desc" },
  });
  const created = await prisma.frontendMenuItem.create({
    data: { ...input, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_menu_create",
    targetType: "FrontendMenuItem",
    targetId: created.id,
    justification: `Ajout de « ${input.label} » au menu ${input.menu}`,
  });
  return NextResponse.json(created, { status: 201 });
}
