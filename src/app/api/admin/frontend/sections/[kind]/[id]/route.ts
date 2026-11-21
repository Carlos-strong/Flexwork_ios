import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { isLinkableHref } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

const statusSchema = z.enum(["brouillon", "publie", "desactive", "archive"]);

const sectionSchema = z.object({
  title: z.string().max(400).nullable().optional(),
  subtitle: z.string().max(600).nullable().optional(),
  ctaText: z.string().max(120).nullable().optional(),
  ctaLink: z.string().max(240).nullable().optional(),
  status: statusSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const itemSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  sublabel: z.string().max(240).nullable().optional(),
  href: z.string().max(240).nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(120).nullable().optional(),
  imageUrl: z.string().max(240).nullable().optional(),
  status: statusSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { kind, id } = await params;
  const body = await req.json().catch(() => null);

  if (kind === "section") {
    const parsed = sectionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    if (parsed.data.ctaLink && !isLinkableHref(parsed.data.ctaLink)) {
      return NextResponse.json({ error: "unlinkable_href", href: parsed.data.ctaLink }, { status: 422 });
    }

    const updated = await prisma.frontendSection.update({ where: { id }, data: parsed.data });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_section_update",
      targetType: "FrontendSection",
      targetId: id,
      justification: `Édition de la section ${updated.key}`,
    });
    return NextResponse.json(updated);
  }

  if (kind === "item") {
    const parsed = itemSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    if (parsed.data.href && !isLinkableHref(parsed.data.href)) {
      return NextResponse.json({ error: "unlinkable_href", href: parsed.data.href }, { status: 422 });
    }

    const updated = await prisma.frontendSectionItem.update({ where: { id }, data: parsed.data });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_section_item_update",
      targetType: "FrontendSectionItem",
      targetId: id,
      justification: `Édition de l'entrée « ${updated.label} »`,
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "unknown_kind" }, { status: 404 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { kind, id } = await params;
  // Une SECTION ne se supprime pas : son composant de rendu existe dans le code et la
  // redemanderait aussitôt — au socle de repli, donc avec son contenu d'origine restauré.
  // La retirer de la page se fait par le statut « désactivé », qui, lui, est respecté.
  if (kind !== "item") return NextResponse.json({ error: "delete_not_allowed" }, { status: 405 });

  const item = await prisma.frontendSectionItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.frontendSectionItem.delete({ where: { id } });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_section_item_delete",
    targetType: "FrontendSectionItem",
    targetId: id,
    justification: `Suppression de l'entrée « ${item.label} »`,
  });
  return NextResponse.json({ deleted: true });
}
