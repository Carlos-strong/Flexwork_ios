import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

const schema = z.object({ justification: z.string().min(1) });

// US-306 (Phase 8) : l'Admin Modération retire une déclaration manifestement frauduleuse,
// uniquement sur signalement — pas de vérification systématique (modele-skillafrica-v3-
// Flexwork.md §5). La déclaration n'est pas supprimée de la chaîne append-only, elle est
// marquée retirée pour ne plus apparaître dans les listes publiques.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminRole("moderation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const declaration = await prisma.professionalDeclaration.findUnique({ where: { id } });
  if (!declaration) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.professionalDeclaration.update({
    where: { id },
    data: { removedAt: new Date(), removedReason: parsed.data.justification },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "declaration_removed",
    targetType: "ProfessionalDeclaration",
    targetId: id,
    justification: parsed.data.justification,
  });

  return NextResponse.json({ ok: true });
}
