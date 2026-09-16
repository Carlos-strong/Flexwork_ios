import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { missionSchema } from "@/lib/validation";
import { notifyMatchingProviders, notifyMissionUser } from "@/lib/mission-notify";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { resolveMissionRisk } from "@/lib/domain-risk";
import { getFinancingMode } from "@/lib/financing-modes";
import { expectedMaxAmount } from "@/lib/spot-time";
import { missionDomainFilter } from "@/lib/domain-match";

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

  // Contrat au TEMPS (S2, 2026-09-15) : le budget publié est le plafond, DÉRIVÉ du tarif et de la
  // quantité maximale — jamais saisi à part, sans quoi les deux divergeraient dès la première
  // retouche du formulaire. Le régime de rémunération est « Taux » par construction.
  const chosenMode = parsed.data.financingModeKey ? getFinancingMode(parsed.data.financingModeKey) : null;
  const isTimeMode = chosenMode?.family === "temps";
  const timeRate = isTimeMode ? (parsed.data.timeRate ?? null) : null;
  const timeMaxQuantity = isTimeMode ? (parsed.data.timeMaxQuantity ?? null) : null;
  const budget =
    timeRate && timeMaxQuantity ? expectedMaxAmount({ rate: timeRate, maxQuantity: timeMaxQuantity }) : parsed.data.budget;

  let userId: string;
  if (wantsPublish) {
    const guard = await requireVerifiedKyc();
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    // "QUOTE" (Demande de devis) annonce explicitement l'absence de montant — le client
    // recevra des propositions financières des prestataires plutôt que d'en fixer un.
    // Exiger un budget malgré ce choix contredisait le formulaire lui-même.
    if (isTimeMode && !(timeRate && timeMaxQuantity)) {
      return NextResponse.json({ error: "time_terms_required_to_publish" }, { status: 400 });
    }
    if (budget === undefined && parsed.data.budgetType !== "QUOTE") {
      return NextResponse.json({ error: "budget_required_to_publish" }, { status: 400 });
    }
    // Mode de financement (2026-09-10) : un mode décrit mais pas encore implémenté (F1, F4,
    // J4, J5) ne peut pas être publié — il figure au catalogue pour être comparé, pas choisi.
    // Contrôle fait ici et pas dans le schéma Zod : un BROUILLON peut légitimement porter un
    // mode indisponible (le client compare, il n'a encore rien engagé), seule la publication
    // engage un prestataire à chiffrer selon ce mode.
    if (parsed.data.financingModeKey) {
      const mode = getFinancingMode(parsed.data.financingModeKey);
      if (!mode?.available) {
        return NextResponse.json(
          { error: "financing_mode_unavailable", reason: mode?.unavailableReason ?? null },
          { status: 400 }
        );
      }
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
      budget: budget ?? 0,
      currency: parsed.data.currency ?? "XOF",
      delaiJours: parsed.data.delaiJours,
      riskLevel,
      insuranceRequired,
      professionalType: parsed.data.professionalType,
      requiredLevel: parsed.data.level,
      budgetType: isTimeMode ? "RATE" : parsed.data.budgetType,
      // Choisi à la publication : c'est lui qui dit au prestataire comment chiffrer son devis
      // (voir Mission.financingModeKey, prisma/schema.prisma). Absent → la génération de
      // contrat retombe sur la saisie manuelle des jalons, comportement historique.
      financingModeKey: parsed.data.financingModeKey ?? null,
      timeRate,
      timeMaxQuantity,
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
      const notifiés = await notifyMatchingProviders(mission.id, mission.domaine);
      // Le client aussi est notifié de sa propre publication (cloche + e-mail) — les deux
      // parties d'un événement sont prévenues, pas seulement celle qui le subit (2026-09-09).
      await notifyMissionUser({
        missionId: mission.id,
        userId,
        type: "mission_publiee",
        message: `Votre mission « ${mission.titre} » est publiée — ${notifiés.length} prestataire(s) du domaine « ${mission.domaine} » ont été notifiés.`,
        email: {
          subject: `Mission publiée — ${mission.titre}`,
          text: `Votre mission « ${mission.titre} » est en ligne. ${notifiés.length} prestataire(s) du domaine « ${mission.domaine} » ont été notifiés et peuvent désormais candidater.`,
        },
      });
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
  // Session valide mais compte absent (supprimé entre la vérification de session et cette
  // requête) : le `user?.role` plus bas court-circuitait le cas client, puis le code
  // retombait sur `user.profiles` sans garde — `next build` refusait ce déréférencement
  // (TS18047). Même convention que GET /api/messages.
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (user.role === "client") {
    const missions = await prisma.mission.findMany({
      where: { clientId: userId },
      orderBy: { createdAt: "desc" },
      // `contract.jalons` inclus pour que useSidebarBadges.ts puisse détecter un jalon
      // "livrable_soumis" en attente — sur un contrat à jalons, mission.status ne reflète
      // jamais cet état au niveau agrégé (voir src/lib/psp-webhook.ts). `contract.provider`
      // ajouté (2026-09-04) pour la colonne "Freelance" de MesMissions — identité du
      // prestataire engagé sur CE contrat, pas une liste de candidats.
      include: {
        _count: { select: { proposals: true } },
        contract: { select: { jalons: { select: { status: true, montant: true, observedProgress: true } }, provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } } } },
      },
    });
    return NextResponse.json({ items: missions });
  }

  const mainDomain =
    user.profiles.find((p) => p.isDefault)?.mainDomain ?? user.profiles[0]?.mainDomain ?? null;
  const missions = await prisma.mission.findMany({
    where: { status: "publiee", ...missionDomainFilter(mainDomain) },
    include: { client: { select: { id: true, firstname: true, lastname: true, country: true, avatarPath: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items: missions });
}
