import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().min(1).max(160).optional(),
  seoTitle: z.string().max(160).nullable().optional(),
  // 160 caractères : au-delà, une description de référencement est tronquée par les moteurs.
  // La contrainte est ici plutôt que dans l'interface pour qu'elle tienne aussi quand la
  // route est appelée autrement que depuis l'écran d'édition.
  seoDescription: z.string().max(160).nullable().optional(),
  status: z.enum(["brouillon", "publie", "desactive", "archive"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const updated = await prisma.frontendPage.update({ where: { id }, data: parsed.data });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_page_update",
    targetType: "FrontendPage",
    targetId: id,
    justification: `Édition du référencement de ${updated.path}`,
  });
  return NextResponse.json(updated);
}
