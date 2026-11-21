import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["retenu", "classe"]),
  // Motif obligatoire : le §13 exige une justification pour toute décision de modération.
  note: z.string().trim().min(10).max(1000),
});

/**
 * Décision sur un signalement — rôle Modération uniquement.
 *
 * « Retenu » ne sanctionne rien par lui-même : il consigne que le signalement est fondé. Le
 * retrait de la déclaration ou la suspension du compte se font ensuite, depuis leur rubrique,
 * avec leur propre motif. Une décision rendue ne se réécrit pas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminRole("moderation");
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const report = await prisma.report.findUnique({ where: { id }, select: { status: true } });
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (report.status !== "ouvert") return NextResponse.json({ error: "already_decided" }, { status: 409 });

  const updated = await prisma.report.update({
    where: { id },
    data: {
      status: parsed.data.status,
      decisionNote: parsed.data.note,
      handledById: guard.user.id,
      handledAt: new Date(),
    },
    select: { id: true, status: true },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: parsed.data.status === "retenu" ? "report_upheld" : "report_dismissed",
    targetType: "Report",
    targetId: id,
    justification: parsed.data.note,
  });

  return NextResponse.json(updated);
}
