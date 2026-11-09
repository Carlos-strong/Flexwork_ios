import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["suspended", "active"]),
  justification: z.string().trim().min(10).max(1000),
});

/**
 * Suspension et réactivation d'un compte — pouvoir de la Modération (§13 : « suspend pour
 * fausse déclaration »).
 *
 * L'effet est réel : `src/auth.ts` refuse la connexion d'un compte non actif et coupe sa session
 * dès la requête suivante. Le bannissement définitif (`banned`) n'est PAS offert ici : aucun
 * rôle du §13 ne le détient, et une suspension motivée, réversible, suffit à la modération sur
 * signalement.
 *
 * Un administrateur ne se suspend pas par cette voie, ni un autre administrateur : retirer un
 * pouvoir se fait en base, par séparation des pouvoirs, pas depuis le pouvoir d'à côté.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminRole("moderation");
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  if (id === guard.user.id) return NextResponse.json({ error: "cannot_target_self" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id }, select: { isAdmin: true, status: true } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.isAdmin) return NextResponse.json({ error: "cannot_target_admin" }, { status: 400 });
  if (target.status === "banned") return NextResponse.json({ error: "banned_account" }, { status: 409 });
  if (target.status === parsed.data.status) return NextResponse.json({ error: "unchanged" }, { status: 409 });

  await prisma.user.update({ where: { id }, data: { status: parsed.data.status } });
  await logAdminAction({
    adminId: guard.user.id,
    action: parsed.data.status === "suspended" ? "user_suspended" : "user_reactivated",
    targetType: "User",
    targetId: id,
    justification: parsed.data.justification,
  });

  return NextResponse.json({ status: parsed.data.status });
}
