import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor, requireFrontendReader } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { DEFAULT_SETTINGS } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const stored = await prisma.frontendSetting.findMany();
  const byKey = new Map(stored.map((s) => [s.key, s]));

  // Le catalogue des réglages vient du code : un réglage jamais édité doit tout de même
  // apparaître, avec sa valeur d'origine, sinon l'écran ne montre que ce qu'on a déjà touché.
  return NextResponse.json({
    settings: DEFAULT_SETTINGS.map((d) => ({
      key: d.key,
      group: d.group,
      label: d.label,
      value: byKey.get(d.key)?.value ?? d.value,
      defaultValue: d.value,
      // « Personnalisé » compare les VALEURS, et non la présence d'une ligne en base : le seed
      // écrit les cinq réglages à leur valeur d'origine, si bien qu'une ligne existe partout
      // dès la première installation. Se fier à sa présence afficherait « revenir à l'origine »
      // sur des réglages auxquels personne n'a touché, et l'indication ne voudrait plus rien
      // dire là où elle compte vraiment.
      customized: (byKey.get(d.key)?.value ?? d.value) !== d.value,
    })),
  });
}

const schema = z.object({ key: z.string().min(2), value: z.string().max(400) });

export async function PATCH(req: Request) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const known = DEFAULT_SETTINGS.find((d) => d.key === parsed.data.key);
  if (!known) return NextResponse.json({ error: "unknown_setting" }, { status: 404 });

  const saved = await prisma.frontendSetting.upsert({
    where: { key: parsed.data.key },
    create: { key: parsed.data.key, value: parsed.data.value, group: known.group, label: known.label },
    update: { value: parsed.data.value },
  });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_setting_update",
    targetType: "FrontendSetting",
    targetId: saved.key,
    justification: `Réglage « ${known.label} » modifié`,
  });
  return NextResponse.json(saved);
}
