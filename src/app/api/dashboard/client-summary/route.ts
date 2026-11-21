import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { PROVIDER_PAYOUT_TYPES } from "@/lib/escrow-instructions";
import { escrowBalancesFor } from "@/lib/escrow";
import { groupAnnonces, groupIsActive, groupIsClosed } from "@/lib/annonce-groups";
import { initials } from "@/lib/initials";
import { clientPublicName } from "@/lib/person-name";

// Agrégation des données réelles pour la vue d'accueil du dashboard client
// (/client/dashboard). La session JWT ne porte que id/email/tel/role — jamais
// firstname/lastname — cette route est donc la seule source fiable de l'identité
// affichée (sidebar + "Bonjour {prénom}"), et centralise les agrégats du tableau de
// bord. Même modèle que provider-summary (côté prestataire) : une seule requête renvoie
// tout ce dont la page a besoin au lieu de valeurs codées en dur.


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

  // Brouillons exclus (2026-10-06) : ni dans « Mes missions récentes », ni dans les compteurs.
  // Une mission non publiée n'entre pas dans la gestion des missions ; elle a sa carte dédiée
  // en tête du tableau de bord (PendingPublicationsCard).
  const missions = await prisma.mission.findMany({
    where: { clientId: userId, status: { not: "brouillon" } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { proposals: true } },
      // Nécessaire pour pendingValidations ci-dessous : sur un contrat à jalons (paiement
      // fractionné), mission.status ne passe JAMAIS à "livrable_soumis" — seul jalon.status
      // le fait, jalon par jalon (voir src/lib/psp-webhook.ts, commentaire "pas le statut
      // agrégé de la mission de façon optimiste"). Sans ça, un client avec un contrat à
      // jalons ne voyait jamais ce compteur bouger, même avec un jalon réellement en attente
      // de sa vérification.
      // montant/observedProgress : progression pondérée des cartes (weightedJalonsProgress).
      contract: { select: { jalons: { select: { status: true, montant: true, observedProgress: true } } } },
      // Prestataire retenu sur un ENGAGEMENT (2026-11-11) : nommé dans la carte de son annonce.
      proposals: {
        where: { status: { in: ["acceptee", "devis_valide"] }, mission: { parentMissionId: { not: null } } },
        select: { provider: { select: { firstname: true, lastname: true } } },
        take: 1,
      },
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

  // Fonds actuellement détenus sous séquestre pour ce client (tuile « En escrow ») : même règle
  // que la page Paiements (/api/dashboard/client-payments → escrowBalancesFor), sur tous ses
  // contrats signés — financé moins versé et remboursé.
  const signedContracts = await prisma.prestationContract.findMany({
    where: { clientId: userId, clientSignedAt: { not: null } },
    select: { id: true },
  });
  const balances = await escrowBalancesFor(signedContracts.map((c) => c.id));
  const inEscrow = Array.from(balances.values()).reduce((sum, b) => sum + b.held, 0);

  // Compteurs par MISSION PUBLIÉE (2026-11-11) : une annonce et ses engagements comptent pour
  // une seule mission (src/lib/annonce-groups.ts). Les candidatures, elles, se somment sur le
  // groupe entier — une candidature retenue a été déplacée sur son engagement, elle reste reçue.
  const groups = groupAnnonces(missions);
  const totalProposals = missions.reduce((s, m) => s + m._count.proposals, 0);
  const hasPendingJalon = (m: (typeof missions)[number]) =>
    (m.contract?.jalons.length ?? 0) > 0 && m.contract!.jalons.some((j) => j.status === "livrable_soumis");

  return NextResponse.json({
    user: {
      name: clientPublicName(user),
      initials: initials(user.firstname, user.lastname, "CL"),
      firstName: user.firstname?.trim() || user.lastname?.trim() || "Client",
      // Nom complet et ville pour l'en-tête « Bonjour, Prénom Nom • Ville » — le client se voit
      // lui-même, l'abréviation publique (clientPublicName) n'a pas lieu d'être ici.
      fullName: [user.firstname?.trim(), user.lastname?.trim()].filter(Boolean).join(" ") || clientPublicName(user),
      city: user.city?.trim() || null,
      // Null si pas de photo : les vues retombent sur les initiales SANS lancer de requête
      // 404 inutile sur /api/users/[id]/avatar (elle cassait le rendu de la navbar + bas de
      // sidebar avec des erreurs console).
      avatarUrl: user.avatarPath ? `/api/users/${userId}/avatar` : null,
    },
    stats: {
      total: groups.length,
      // Active : la mission, ou l'un de ses engagements, est en cours d'exécution.
      active: groups.filter(groupIsActive).length,
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
      closed: groups.filter(groupIsClosed).length,
      open: groups.filter((g) => g.mission.status === "publiee").length,
      inEscrow,
    },
    missions,
  });
}
