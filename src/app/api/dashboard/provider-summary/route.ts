import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { weightedJalonsProgress } from "@/lib/jalons";

import { PROVIDER_PAYOUT_TYPES } from "@/lib/escrow-instructions";
import { escrowBalancesFor } from "@/lib/escrow";
import { missionDomainFilter } from "@/lib/domain-match";

// Agrégation des données réelles pour la vue d'accueil des dashboards prestataire
// (/dashboard/expert-digital, expert-btp, artisan, manoeuvre) — ces pages affichaient
// jusqu'ici des chiffres et listes entièrement fictifs, alors que /missions/<role> (via
// ProviderMissionsBoard) et /api/missions exposent déjà les vraies données de mission. Cet
// endpoint complète ce qui manquait pour l'aperçu du dashboard : missions déjà contractées
// (le GET /api/missions provider ne renvoie que les missions "publiee" ouvertes à
// candidature, jamais celles déjà en cours), revenus réels, et activité réelle.
//
// Pas de "wallet"/solde ici par conception : le schéma est explicite (voir
// PspEscrowOperation) — la plateforme instruit des paiements PSP, elle ne détient et ne
// gère aucun solde interne. "Revenus totaux" est donc la somme des RELEASE confirmés reçus,
// jamais un solde retirable.

const IN_PROGRESS_STATUSES = [
  "proposition_acceptee",
  "contrat_genere",
  "contrat_signe",
  "fonds_sous_sequestre",
  "en_cours",
  "livrable_soumis",
] as const;

const COMPLETED_STATUSES = ["validee", "cloturee"] as const;

// Progression approximative à partir du statut de mission quand le contrat n'utilise pas
// de jalons (paiement unique — voir le commentaire sur PspEscrowOperation.jalonId) : reste
// une donnée réelle (dérivée du statut réel), pas une valeur inventée, juste moins précise
// qu'un calcul jalon par jalon.
const STATUS_PROGRESS: Record<string, number> = {
  proposition_acceptee: 10,
  contrat_genere: 20,
  contrat_signe: 30,
  fonds_sous_sequestre: 50,
  en_cours: 60,
  livrable_soumis: 90,
};

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profiles: true },
  });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const mainDomain = user.profiles.find((p) => p.isDefault)?.mainDomain ?? user.profiles[0]?.mainDomain ?? null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Filtres écrits une seule fois : chacun servait à deux ou trois lectures qui recopiaient la
  // même clause, avec le risque habituel qu'une correction n'en touche qu'une.
  const completedMissionWhere = {
    status: { in: [...COMPLETED_STATUSES] },
    contract: { providerId: userId },
  };
  const payoutWhere = {
    instructionType: { in: PROVIDER_PAYOUT_TYPES },
    status: "confirmed" as const,
    contract: { providerId: userId },
  };

  const [openMissions, inProgressMissions, completedTotal, completedThisMonth, proposals, releases, releasesThisMonth, notifications] =
    await Promise.all([
      // Missions ouvertes correspondant au domaine — mêmes règles que GET /api/missions
      // pour rester cohérent avec /missions/<role>.
      prisma.mission.findMany({
        where: { status: "publiee", ...missionDomainFilter(mainDomain) },
        include: { client: { select: { firstname: true, lastname: true, country: true } } },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
      // Missions déjà contractées pour ce prestataire, encore actives.
      prisma.mission.findMany({
        where: { status: { in: [...IN_PROGRESS_STATUSES] }, contract: { providerId: userId } },
        include: {
          client: { select: { firstname: true, lastname: true } },
          contract: { include: { jalons: { select: { status: true, montant: true, observedProgress: true } } } },
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.mission.count({ where: completedMissionWhere }),
      prisma.mission.count({ where: { ...completedMissionWhere, updatedAt: { gte: startOfMonth } } }),
      prisma.missionProposal.findMany({ where: { providerId: userId }, select: { status: true } }),
      // Total et cumul du mois : deux agrégats qui ne diffèrent que par la borne de date. Ils
      // restent DEUX requêtes — elles partent en parallèle dans ce `Promise.all`, donc les
      // fondre en une seule (SUM ... FILTER en SQL brut, seule façon de faire une somme
      // conditionnelle) ne gagnerait aucun temps d'horloge et coûterait le typage du schéma.
      // Ce qui était réellement dupliqué, en revanche, c'est le filtre : il est désormais écrit
      // une fois (`payoutWhere`), et les trois lectures des versements en dérivent.
      prisma.pspEscrowOperation.aggregate({ where: payoutWhere, _sum: { amount: true } }),
      prisma.pspEscrowOperation.aggregate({
        where: { ...payoutWhere, pspConfirmedAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
    ]);

  // "Activité récente" : flux reconstruit à partir des tables d'événements réels. Depuis le
  // 2026-09-09, la table Notification porte TOUS les types d'événements (elle alimente la
  // cloche du navbar) et non plus seulement le KYC ; ce flux-ci reste néanmoins bâti sur les
  // tables métier, pour garder son détail par mission. On le construit donc à partir de :  missions
  // signalées comme correspondant au profil (MissionNotification), candidatures acceptées,
  // et paiements confirmés (PspEscrowOperation). Chaque entrée reste un événement réel, pas
  // une donnée inventée — seule sa mise en forme en "flux d'activité" est reconstruite ici.
  const [matchedMissionRows, acceptedProposalRows, releaseRows] = await Promise.all([
    prisma.missionNotification.findMany({
      where: { userId },
      select: { id: true, type: true, message: true, createdAt: true, mission: { select: { titre: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.missionProposal.findMany({
      where: { providerId: userId, status: "acceptee" },
      include: { mission: { select: { titre: true } } },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.pspEscrowOperation.findMany({
      where: payoutWhere,
      include: { contract: { include: { mission: { select: { titre: true } } } } },
      orderBy: { pspConfirmedAt: "desc" },
      take: 4,
    }),
  ]);

  // Libellé + icône selon le type d'événement mission (MissionNotification.type) — les types
  // contrat/signature (contrat_genere, provider_signed, contract_locked, contract_expired)
  // portent leur message déjà formaté ; mission_match conserve le libellé historique
  // reconstruit depuis le titre de mission.
  const MISSION_NOTIF_META: Record<string, { icon: string; fallback: (titre: string) => string }> = {
    mission_match: { icon: "📋", fallback: (titre) => `Nouvelle mission correspondant à ton profil : ${titre}` },
    contract_generated: { icon: "📝", fallback: (titre) => `Contrat généré pour « ${titre} » — signez-le` },
    contract_locked: { icon: "🤝", fallback: (titre) => `Mission engagée — contrat signé pour « ${titre} »` },
    contract_expired: { icon: "⏳", fallback: (titre) => `Contrat annulé faute de contre-signature pour « ${titre} »` },
    deliverable_rejected: { icon: "↩️", fallback: (titre) => `Livrable rejeté pour « ${titre} » — resoumettez des preuves corrigées` },
    deliverable_validated: { icon: "✅", fallback: (titre) => `Livrable validé pour « ${titre} » — libération en cours` },
    proof_rejected: { icon: "❌", fallback: (titre) => `Une preuve a été rejetée pour « ${titre} » — fournissez une preuve corrigée` },
    progress_checkpoint: { icon: "📍", fallback: (titre) => `Point d'étape confirmé par le client pour « ${titre} »` },
  };

  const activityFeed = [
    ...notifications.map((n) => ({ id: n.id, message: n.message, time: n.createdAt, icon: n.type === "kyc_verifie" ? "✅" : "⚠️" })),
    ...matchedMissionRows.map((n) => {
      const meta = MISSION_NOTIF_META[n.type] ?? MISSION_NOTIF_META.mission_match;
      return { id: n.id, message: n.message ?? meta.fallback(n.mission.titre), time: n.createdAt, icon: meta.icon };
    }),
    ...acceptedProposalRows.map((p) => ({ id: p.id, message: `Candidature acceptée : ${p.mission.titre}`, time: p.createdAt, icon: "✅" })),
    ...releaseRows
      .filter((r) => r.pspConfirmedAt)
      .map((r) => ({
        id: r.id,
        message: `Paiement reçu : ${Math.round(r.amount).toLocaleString("fr-FR")} ${r.currency}${r.contract?.mission ? ` — ${r.contract.mission.titre}` : ""}`,
        time: r.pspConfirmedAt as Date,
        icon: "💰",
      })),
  ]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 4);

  // ── Ce qui est engagé et pas encore reçu (2026-09-15) ─────────────────────────────────────
  // « Revenus totaux » ne dit que le passé. Un prestataire a surtout besoin de savoir ce qui lui
  // est DÛ : validé mais pas versé, en route vers son compte, retenu en garantie, gelé par un
  // litige. Ces montants existaient contrat par contrat ; ils sont ici agrégés, avec la même
  // règle de calcul que le panneau du séquestre (escrowBalancesFor), en un nombre constant de
  // requêtes quel que soit le nombre de missions.
  // TOUS les contrats du prestataire, sans filtre de statut. Exclure les missions « remboursées »
  // cachait des fonds encore engagés : un accord de médiation qui rembourse une part au client
  // passe la mission `remboursee` alors qu'une autre part peut rester gelée à son nom (constaté par
  // le test de workflow complet, 2026-09-15). Un contrat soldé ne pèse rien dans les totaux, et
  // `escrowBalancesFor` reste à nombre constant de requêtes.
  const openContracts = await prisma.prestationContract.findMany({
    where: { providerId: userId },
    select: { id: true },
  });
  const openIds = openContracts.map((c) => c.id);
  const [balances, inFlightAgg] = await Promise.all([
    escrowBalancesFor(openIds),
    prisma.payable.aggregate({
      where: { contractId: { in: openIds }, status: "instructed" },
      _sum: { amount: true },
    }),
  ]);
  const escrow = { owed: 0, awaitingFunding: 0, retained: 0, blocked: 0, inFlight: inFlightAgg._sum.amount ?? 0 };
  for (const b of balances.values()) {
    escrow.owed += b.owedToProvider;
    escrow.awaitingFunding += Math.max(0, b.releasable - b.owedToProvider);
    escrow.retained += b.retained;
    escrow.blocked += b.blocked;
  }

  const pendingProposals = proposals.filter((p) => p.status === "envoyee").length;
  const decidedProposals = proposals.filter((p) => p.status === "acceptee" || p.status === "refusee");
  const acceptedProposals = proposals.filter((p) => p.status === "acceptee").length;
  const successRate = decidedProposals.length > 0 ? Math.round((acceptedProposals / decidedProposals.length) * 100) : null;

  const newMissionsToday = openMissions.filter((m) => m.createdAt >= startOfToday).length;

  return NextResponse.json({
    user: {
      name: user.firstname || user.lastname || "Prestataire",
      initials: initialsOf(user.firstname, user.lastname, "PR"),
      // Null si pas de photo : les vues retombent sur les initiales SANS lancer de requête
      // 404 inutile sur /api/users/[id]/avatar (elle cassait le rendu de la navbar + bas de
      // sidebar avec des erreurs console).
      avatarUrl: user.avatarPath ? `/api/users/${userId}/avatar` : null,
    },
    stats: {
      missionsCompleted: completedTotal,
      missionsCompletedThisMonth: completedThisMonth,
      revenueTotal: releases._sum.amount ?? 0,
      revenueThisMonth: releasesThisMonth._sum.amount ?? 0,
      pendingProposals,
      successRate,
    },
    escrow,
    newMissionsToday,
    recommended: openMissions.map((m) => ({
      id: m.id,
      titre: m.titre,
      domaine: m.domaine,
      budget: m.budget,
      currency: m.currency,
      budgetType: m.budgetType,
      delaiJours: m.delaiJours,
      client: displayName(m.client),
      country: m.client?.country ?? null,
    })),
    inProgress: inProgressMissions.map((m) => {
      const jalons = m.contract?.jalons ?? [];
      // Pondéré par montant (règle 18.14, voir weightedJalonsProgress) — un jalon en cours de
      // validation partielle (observedProgress < 100, pas encore `libere`) pèse déjà dans
      // l'avancement, proportionnellement à son montant, plutôt que de compter pour 0 tant
      // qu'il n'est pas intégralement payé.
      const progress = jalons.length > 0 ? weightedJalonsProgress(jalons) : STATUS_PROGRESS[m.status] ?? 0;
      const echeance = new Date(m.createdAt);
      echeance.setDate(echeance.getDate() + m.delaiJours);
      return {
        id: m.id,
        titre: m.titre,
        client: displayName(m.client),
        budget: m.budget,
        currency: m.currency,
        progress,
        echeance: echeance.toISOString(),
        status: m.status,
        // Sur un contrat à jalons, mission.status ne passe jamais à "livrable_soumis" — seul
        // jalon.status le fait, jalon par jalon (voir src/lib/psp-webhook.ts). Sans ce champ,
        // le prestataire ne voyait jamais "En révision" pour une mission à jalons dont l'un
        // d'eux attend réellement la vérification du client — cette carte restait bloquée
        // sur "En cours" (et `status` lui-même était absent de la réponse jusqu'ici, donc
        // aucune mission, jalons ou non, n'affichait jamais "En révision").
        hasPendingJalon: jalons.some((j) => j.status === "livrable_soumis"),
      };
    }),
    activity: activityFeed.map((a) => ({ id: a.id, message: a.message, icon: a.icon, createdAt: a.time.toISOString() })),
  });
}
