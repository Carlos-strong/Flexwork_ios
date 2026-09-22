import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor, requireFrontendReader } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { publishFrontend } from "@/lib/frontend-config";

export const dynamic = "force-dynamic";

/** Historique des publications. L'instantané lui-même n'est pas renvoyé ici — il pèse lourd. */
export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const releases = await prisma.frontendRelease.findMany({
    orderBy: { version: "desc" },
    take: 50,
    select: {
      id: true,
      version: true,
      publishedAt: true,
      note: true,
      rolledBackFromVersion: true,
      publishedBy: { select: { id: true, firstname: true, lastname: true, email: true } },
    },
  });
  return NextResponse.json({ releases });
}

const schema = z.object({ note: z.string().max(200).optional() });

/** Publie l'état courant des tables de travail en une nouvelle version. */
export async function POST(req: Request) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const release = await publishFrontend({ adminId: guard.user.id, note: parsed.data.note });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_publish",
    targetType: "FrontendRelease",
    targetId: release.id,
    justification: parsed.data.note?.trim() || `Publication de la version ${release.version}`,
  });
  return NextResponse.json({ version: release.version, publishedAt: release.publishedAt }, { status: 201 });
}
