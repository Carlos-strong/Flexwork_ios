import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

const schema = z.object({
  key: z.string().min(2),
  zone: z.string().min(2),
  enabled: z.boolean(),
  note: z.string().optional(),
});

// Activation manuelle uniquement — après signature effective d'un partenaire physique
// dans la zone (voir README §Feature flags). Jamais déclenché automatiquement par le code.
export async function POST(req: Request) {
  const guard = await requireAdminRole("superviseur");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const flag = await prisma.featureFlag.upsert({
    where: { key_zone: { key: parsed.data.key, zone: parsed.data.zone } },
    create: parsed.data,
    update: { enabled: parsed.data.enabled, note: parsed.data.note },
  });

  // Ouvrir une filière dans une zone engage la plateforme sur un prérequis juridique : le geste
  // se trace, avec son auteur, comme toute décision administrative.
  await logAdminAction({
    adminId: guard.user.id,
    action: parsed.data.enabled ? "feature_flag_enabled" : "feature_flag_disabled",
    targetType: "FeatureFlag",
    targetId: flag.id,
    justification: parsed.data.note?.trim() || `${parsed.data.key} (${parsed.data.zone}) ${parsed.data.enabled ? "activé" : "désactivé"}`,
  });

  return NextResponse.json(flag);
}

export async function GET() {
  const guard = await requireAdminRole("superviseur");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ items: flags });
}
