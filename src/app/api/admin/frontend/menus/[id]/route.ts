import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { isLinkableHref } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

const schema = z.object({
  label: z.string().min(1).max(80).optional(),
  href: z.string().min(1).max(240).optional(),
  description: z.string().max(200).nullable().optional(),
  status: z.enum(["brouillon", "publie", "desactive", "archive"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  if (parsed.data.href && !isLinkableHref(parsed.data.href)) {
    return NextResponse.json({ error: "unlinkable_href", href: parsed.data.href }, { status: 422 });
  }

  const updated = await prisma.frontendMenuItem.update({ where: { id }, data: parsed.data });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_menu_update",
    targetType: "FrontendMenuItem",
    targetId: id,
    justification: `Édition de l'entrée « ${updated.label} » du menu ${updated.menu}`,
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const item = await prisma.frontendMenuItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.frontendMenuItem.delete({ where: { id } });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_menu_delete",
    targetType: "FrontendMenuItem",
    targetId: id,
    justification: `Retrait de « ${item.label} » du menu ${item.menu}`,
  });
  return NextResponse.json({ deleted: true });
}
