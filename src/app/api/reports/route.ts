import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Route attendue par /signalement depuis sa création, et qui n'existait pas : chaque
// signalement se soldait par un 404 et le message « Échec de l'envoi ». Elle alimente la file
// de la Modération (§13 : « agit sur signalement »).

const schema = z.object({
  targetType: z.enum(["declaration", "profile", "mission", "review"]),
  targetId: z.string().trim().max(64).optional(),
  reason: z.string().trim().min(10).max(2000),
});

// Cadences maximales sur une heure glissante. Un signalement ouvre une revue humaine : en
// laisser passer des centaines d'une même source noierait la file sans rien signaler de plus.
const MAX_PER_HOUR_SIGNED_IN = 20;
const MAX_PER_HOUR_ANONYMOUS = 5;

/**
 * Empreinte de la source anonyme : HMAC de l'adresse IP, jamais l'adresse elle-même. Elle
 * permet de limiter la cadence sans constituer un fichier d'adresses IP des visiteurs.
 */
function sourceHash(req: Request): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  if (!ip) return null;
  const secret = process.env.AUTH_SECRET ?? "flexwork-reports";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const session = await auth();
  const reporterId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const hash = reporterId ? null : sourceHash(req);
  const since = new Date(Date.now() - 60 * 60 * 1000);

  const recent = reporterId
    ? await prisma.report.count({ where: { reporterId, createdAt: { gte: since } } })
    : hash
      ? await prisma.report.count({ where: { sourceHash: hash, createdAt: { gte: since } } })
      : 0;
  if (recent >= (reporterId ? MAX_PER_HOUR_SIGNED_IN : MAX_PER_HOUR_ANONYMOUS)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const report = await prisma.report.create({
    data: {
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId || null,
      reason: parsed.data.reason,
      reporterId,
      sourceHash: hash,
    },
    select: { id: true },
  });

  // Aucune action automatique : le signalement attend un modérateur, qui décide seul.
  return NextResponse.json({ id: report.id }, { status: 201 });
}
