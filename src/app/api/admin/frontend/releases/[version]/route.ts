import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireFrontendEditor, requireFrontendReader } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { rollbackFrontend } from "@/lib/frontend-config";

export const dynamic = "force-dynamic";

function parseVersion(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Instantané complet d'une version — ce que le public voyait exactement à ce moment. */
export async function GET(req: Request, { params }: { params: Promise<{ version: string }> }) {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const version = parseVersion((await params).version);
  if (!version) return NextResponse.json({ error: "invalid_version" }, { status: 400 });

  const release = await prisma.frontendRelease.findUnique({ where: { version } });
  if (!release) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(release);
}

/**
 * Retour arrière : republie l'instantané de cette version sous un NOUVEAU numéro.
 *
 * L'historique s'allonge, il ne se réécrit pas. Revenir de la v24 à la v23 produit une v25
 * identique à la v23 — la v24 reste consultable, et le geste lui-même reste lisible dans la
 * liste au lieu de disparaître avec ce qu'il a corrigé.
 */
export async function POST(req: Request, { params }: { params: Promise<{ version: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const version = parseVersion((await params).version);
  if (!version) return NextResponse.json({ error: "invalid_version" }, { status: 400 });

  const release = await rollbackFrontend({ adminId: guard.user.id, version });
  if (!release) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_rollback",
    targetType: "FrontendRelease",
    targetId: release.id,
    justification: `Retour arrière sur la v${version}, republiée en v${release.version}`,
  });
  return NextResponse.json({ version: release.version, rolledBackFromVersion: version }, { status: 201 });
}
