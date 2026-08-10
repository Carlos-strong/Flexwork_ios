import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// US-304 (Phase 3) : profil affiché en trois blocs strictement séparés — « Vérifié par
// Flexwork » (identité uniquement), « Déclaré par le prestataire (non vérifié) »,
// « Activité sur la plateforme » (faits d'usage constatés, pas des déclarations).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id: userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: {
        include: { declarations: { where: { removedAt: null }, include: { documents: true }, orderBy: { declaredAt: "desc" } } },
      },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const latestByType = new Map<string, NonNullable<typeof user.profile>["declarations"][number]>();
  for (const d of user.profile?.declarations ?? []) {
    if (!latestByType.has(d.declarationType)) latestByType.set(d.declarationType, d);
  }

  const [missionsCompleted, reviews] = await Promise.all([
    prisma.mission.count({
      where: { status: "cloturee", proposals: { some: { providerId: userId, status: "acceptee" } } },
    }),
    prisma.review.findMany({ where: { targetId: userId, suspendu: false }, select: { note: true } }),
  ]);
  const averageNote = reviews.length ? reviews.reduce((s, r) => s + r.note, 0) / reviews.length : null;

  return NextResponse.json({
    // Bloc 1 — Vérifié par Flexwork : identité uniquement, jamais rien d'autre.
    verifie: { identiteVerifiee: user.kycStatus === "verifie" },
    // Bloc 2 — Déclaré par le prestataire (non vérifié).
    declare: {
      mainDomain: user.profile?.mainDomain ?? null,
      declaredLevel: user.profile?.declaredLevel ?? null,
      declaredExperienceYears: user.profile?.declaredExperienceYears ?? null,
      indicativeRate: user.profile?.indicativeRate ?? null,
      tarifUnite: user.profile?.tarifUnite ?? null,
      tags: user.profile?.tags ?? [],
      description: user.profile?.description ?? null,
      portfolioUrls: user.profile?.portfolioUrls ?? [],
      zonePays: user.profile?.zonePays ?? null,
      zoneVille: user.profile?.zoneVille ?? null,
      zoneRayonKm: user.profile?.zoneRayonKm ?? null,
      insurance: latestByType.get("insurance") ?? null,
      qualification: latestByType.get("qualification") ?? null,
      mention: "Ces informations sont déclarées par le prestataire. Flexwork ne les a pas vérifiées.",
    },
    // Bloc 3 — Activité sur la plateforme : faits d'usage constatés, pas des déclarations.
    activite: {
      missionsCompleted,
      averageNote,
      memberSince: user.createdAt,
    },
  });
}
