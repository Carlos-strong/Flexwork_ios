import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { PROVIDER_PAYOUT_TYPES } from "@/lib/escrow-instructions";

// Agrégation des données réelles pour la vue d'accueil du dashboard client
// (/client/dashboard). La session JWT ne porte que id/email/tel/role — jamais
// firstname/lastname — cette route est donc la seule source fiable de l'identité
// affichée (sidebar + "Bonjour {prénom}"), et centralise les agrégats du tableau de
// bord. Même modèle que provider-summary (côté prestataire) : une seule requête renvoie
// tout ce dont la page a besoin au lieu de valeurs codées en dur.

function displayName(u: { firstname: string | null; lastname: string | null } | null | undefined): string {
  if (!u) return "Client";
  const first = u.firstname?.trim();
  const lastInitial = u.lastname?.trim()?.charAt(0);
  if (first && lastInitial) return `${first} ${lastInitial}.`;
  return first || u.lastname || "Client";
}

function initialsOf(firstname: string | null, lastname: string | null, fallback: string): string {
  const a = firstname?.trim()?.charAt(0) ?? "";
  const b = lastname?.trim()?.charAt(0) ?? "";
  const initials = `${a}${b}`.toUpperCase();
  return initials || fallback;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const missions = await prisma.mission.findMany({
    where: { clientId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { proposals: true } },
      // Nécessaire pour pendingValidations ci-dessous : sur un contrat à jalons (paiement
      // fractionné), mission.status ne passe JAMAIS à "livrable_soumis" — seul jalon.status
      // le fait, jalon par jalon (voir src/lib/psp-webhook.ts, commentaire "pas le statut
      // agrégé de la mission de façon optimiste"). Sans ça, un client avec un contrat à
      // jalons ne voyait jamais ce compteur bouger, même avec un jalon réellement en attente
      // de sa vérification.
      contract: { select: { jalons: { select: { status: true } } } },
    },
  });

  // Versements confirmés par le PSP sur les contrats de ce client — `release` (jalon ou prix
  // total) et `retention_release` (retenue de garantie finale, mode J4). Les `pending` sont
  // exclus : on affiche ce qui est effectivement parti, pas ce qui est en vol.
  const payouts = await prisma.pspEscrowOperation.aggregate({
    where: {
      instructionType: { in: [...PROVIDER_PAYOUT_TYPES] },
      status: "confirmed",
      contract: { clientId: userId },
    },
    _sum: { amount: true },
  });

  const totalProposals = missions.reduce((s, m) => s + m._count.proposals, 0);
  const hasPendingJalon = (m: (typeof missions)[number]) =>
    (m.contract?.jalons.length ?? 0) > 0 && m.contract!.jalons.some((j) => j.status === "livrable_soumis");

  // Fil « Activité récente » côté client (⚠️ 7 du modèle — étapes de signature). Le client
  // reçoit `provider_signed` (« contre-signe sous 48h ») et `contract_expired` (délai
  // dépassé). Message déjà formaté stocké dans MissionNotification.message — même pattern
  // que le fil prestataire (provider-summary), qui reconstruit un fallback depuis le titre
  // quand message est absent (historique).
  const notifRows = await prisma.missionNotification.findMany({
    where: { userId },
    select: { id: true, type: true, message: true, createdAt: true, mission: { select: { titre: true } } },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const NOTIF_META: Record<string, { icon: string; fallback: (titre: string) => string }> = {
    provider_signed: { icon: "✍️", fallback: (titre) => `Un prestataire a signé le contrat — contre-signe sous 48h pour « ${titre} »` },
    contract_expired: { icon: "⏳", fallback: (titre) => `Délai de contre-signature dépassé pour « ${titre} » — contrat annulé` },
    contract_locked: { icon: "🔒", fallback: (titre) => `Contrat signé — séquestre déclenché pour « ${titre} »` },
    deliverable_submitted: { icon: "📦", fallback: (titre) => `Un livrable a été soumis pour « ${titre} » — vérifiez les preuves` },
  };
  const activity = notifRows.map((n) => {
    const meta = NOTIF_META[n.type] ?? { icon: "🔔", fallback: (titre: string) => `Notification pour « ${titre} »` };
    return { id: n.id, message: n.message ?? meta.fallback(n.mission.titre), icon: meta.icon, createdAt: n.createdAt.toISOString() };
  });

  return NextResponse.json({
    user: {
      name: displayName(user),
      initials: initialsOf(user.firstname, user.lastname, "CL"),
      firstName: user.firstname?.trim() || user.lastname?.trim() || "Client",
      // Null si pas de photo : les vues retombent sur les initiales SANS lancer de requête
      // 404 inutile sur /api/users/[id]/avatar (elle cassait le rendu de la navbar + bas de
      // sidebar avec des erreurs console).
      avatarUrl: user.avatarPath ? `/api/users/${userId}/avatar` : null,
    },
    stats: {
      total: missions.length,
      // Même définition "active" que le dashboard historique : tout sauf brouillon/publiee/cloturee.
      active: missions.filter((m) => !["brouillon", "publiee", "cloturee"].includes(m.status)).length,
      // Chemin historique (mission sans jalon, statut posé au niveau mission) OU chemin
      // à jalons (au moins un jalon "livrable_soumis" — voir le commentaire sur `contract`
      // ci-dessus).
      pendingValidations: missions.filter((m) => m.status === "livrable_soumis" || hasPendingJalon(m)).length,
      totalProposals,
      // Ce que le client a RÉELLEMENT payé : la somme des versements confirmés par le PSP,
      // retenue de garantie comprise. Sommer `Mission.budget` (comportement d'avant) donnait
      // 0 sur toute mission en mode devis — ce champ y est laissé nul, le prix venant de la
      // proposition acceptée — et comptait à l'inverse le budget INDICATIF d'une mission
      // simplement publiée, jamais payée. Même base que `revenueTotal` côté prestataire
      // (provider-summary), pour que les deux faces d'un même contrat s'accordent.
      budgetSpent: payouts._sum.amount ?? 0,
      closed: missions.filter((m) => m.status === "cloturee").length,
      open: missions.filter((m) => m.status === "publiee").length,
    },
    missions,
    activity,
  });
}
