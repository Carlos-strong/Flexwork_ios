import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

const schema = z.object({ justification: z.string().min(1) });

// Suppression d'un compte par l'admin — action destructive et irréversible, donc journalisée
// (US-801) comme toute autre décision admin. Toutes les relations vers User utilisent déjà
// onDelete: Cascade (prisma/schema.prisma) : missions, propositions, documents KYC,
// déclarations, garants, messages, avis... partent avec le compte.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { id: userId } = await params;

  if (userId === guard.user.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isAdmin: true } });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (target.isAdmin) {
    return NextResponse.json({ error: "cannot_delete_admin" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  await logAdminAction({
    adminId: guard.user.id,
    action: "user_deleted",
    targetType: "User",
    targetId: userId,
    justification: parsed.data.justification,
  });

  await prisma.user.delete({ where: { id: userId } });

  return NextResponse.json({ deleted: true });
}
