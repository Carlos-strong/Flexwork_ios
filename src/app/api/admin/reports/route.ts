import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ReportStatus } from "@prisma/client";
import { requireAnyAdminRole } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

/** File des signalements — la Modération y agit, le superviseur la lit (§13). */
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["moderation", "superviseur"]);
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const raw = new URL(req.url).searchParams.get("status");
  const STATUSES: ReportStatus[] = ["ouvert", "retenu", "classe"];
  const where = STATUSES.includes(raw as ReportStatus) ? { status: raw as ReportStatus } : {};

  const [items, counts] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        status: true,
        createdAt: true,
        handledAt: true,
        decisionNote: true,
        reporter: { select: { email: true } },
        handledBy: { select: { email: true } },
      },
    }),
    prisma.report.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return NextResponse.json({
    items,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
}
