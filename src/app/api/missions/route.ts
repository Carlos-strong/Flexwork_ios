import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { missionSchema } from "@/lib/validation";
import { notifyMatchingProviders } from "@/lib/mission-notify";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { resolveMissionRisk } from "@/lib/domain-risk";

// US-401 (Phase 4) : le client publie une mission ; son domaine détermine automatiquement
// son palier de risque et si une assurance effective est requise (US-702).
// US-203 (Phase 2) : le KYC ne conditionne QUE la publication (Mission.status = "publiee"),
// jamais l'enregistrement d'un brouillon — auparavant cette route forçait `status: "publiee"`
// sur toute création et exigeait le KYC même pour un brouillon, empêchant tout brouillon
// d'exister (contradiction avec la bannière d'aide de /missions/new qui promet l'inverse).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = missionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const wantsPublish = (parsed.data.status ?? "publiee") === "publiee";

  let userId: string;
  if (wantsPublish) {
    const guard = await requireVerifiedKyc();
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    // "QUOTE" (Demande de devis) annonce explicitement l'absence de montant — le client
    // recevra des propositions financières des prestataires plutôt que d'en fixer un.
    // Exiger un budget malgré ce choix contredisait le formulaire lui-même.
    if (parsed.data.budget === undefined && parsed.data.budgetType !== "QUOTE") {
      return NextResponse.json({ error: "budget_required_to_publish" }, { status: 400 });
    }
    userId = guard.userId;
  } else {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    userId = (session.user as typeof session.user & { id: string }).id;
  }

  const client = await prisma.user.findUnique({ where: { id: userId }, select: { country: true } });
  const { riskLevel, insuranceRequired } = await resolveMissionRisk(parsed.data.domaine, client?.country ?? "BJ");

  const mission = await prisma.mission.create({
    data: {
      clientId: userId,
      titre: parsed.data.titre,
      description: parsed.data.description,
      domaine: parsed.data.domaine,
      mode: parsed.data.mode ?? "presentiel",
      // Brouillon sans montant fixé : 0 est un simple espace réservé, jamais affiché tant
      // que la mission n'est pas publiée (le budget redevient obligatoire à ce moment-là).
      budget: parsed.data.budget ?? 0,
      currency: parsed.data.currency ?? "XOF",
      delaiJours: parsed.data.delaiJours,
      riskLevel,
      insuranceRequired,
      professionalType: parsed.data.professionalType,
      requiredLevel: parsed.data.level,
      budgetType: parsed.data.budgetType,
      tags: parsed.data.tags ?? [],
      maxRevisionRounds: parsed.data.maxRevisionRounds ?? 3,
      dateExpiration: parsed.data.dateExpiration ?? null,
      status: wantsPublish ? "publiee" : "brouillon",
    },
  });

  if (wantsPublish) {
    // La notification est un effet secondaire non bloquant : si elle échoue, la mission
    // est déjà publiée — ne pas faire échouer la requête (sinon le client retente et
    // crée des doublons, la création ayant déjà été committée).
    try {
      await notifyMatchingProviders(mission.id, mission.domaine);
    } catch (e) {
      console.error("notifyMatchingProviders failed (non fatal):", e);
    }
  }

  return NextResponse.json({ id: mission.id, status: mission.status, riskLevel: mission.riskLevel });
}

// GET : le client voit ses propres missions ; un prestataire voit les missions ouvertes
// (`publiee`) correspondant à son domaine principal déclaré, pour pouvoir candidater
// (US-203 : le KYC ne conditionne que la candidature elle-même, pas la consultation).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profiles: true } });
  if (user?.role === "client") {
    const missions = await prisma.mission.findMany({
      where: { clientId: userId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { proposals: true } } },
    });
    return NextResponse.json({ items: missions });
  }

  const mainDomain =
    user.profiles.find((p) => p.isDefault)?.mainDomain ?? user.profiles[0]?.mainDomain ?? null;
  const missions = await prisma.mission.findMany({
    where: { status: "publiee", ...(mainDomain ? { domaine: mainDomain } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items: missions });
}
