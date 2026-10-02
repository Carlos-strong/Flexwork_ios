import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { escrowBalancesFor } from "@/lib/escrow";
import { attendanceAmount, fundingAlert } from "@/lib/spot-time";

// Tableau de bord du RESPONSABLE DE CHANTIER (2026-09-14).
//
// Vue transversale de ce dont il a réellement la charge : les contrats en mode de vérification
// OPR sur lesquels le client l'a DÉSIGNÉ (2026-10-01 : tout contrat, plus seulement au temps), les
// relevés qui attendent son constat et les jalons ou tâches qui attendent sa vérification. Rien d'autre — pas de missions
// disponibles, pas de candidatures, pas de wallet : il ne candidate pas et n'est pas payé par la
// plateforme. Lui servir un dashboard de prestataire lui aurait donné des rubriques sans objet.
//
// La désignation est la SEULE source de son périmètre : un compte responsable de chantier sans
// désignation voit un tableau vide, ce qui est exact. Le rôle ne donne aucun droit par lui-même.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;

  const contrats = await prisma.prestationContract.findMany({
    where: { siteManagerId: userId, validationMode: "opr" },
    select: {
      id: true,
      missionId: true,
      spotTimeTerms: true,
      mission: { select: { titre: true, currency: true, status: true, verifiedAt: true } },
      provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
      jalons: { orderBy: { ordre: "asc" }, select: { id: true, ordre: true, titre: true, montant: true, status: true, verifiedAt: true } },
    },
  });
  // Les relevés et soldes ne concernent que les contrats au temps.
  const terms = contrats.flatMap((c) => (c.spotTimeTerms ? [{ ...c.spotTimeTerms, contract: c }] : []));

  // Trois requêtes au total, quel que soit le nombre de chantiers (2026-09-14). Chaque chantier
  // demandait auparavant sa propre liste de relevés ET son propre solde — lequel en coûte trois à
  // lui seul : un responsable suivant vingt chantiers déclenchait quatre-vingts requêtes, et ce
  // nombre grandissait avec ses responsabilités.
  const contractIds = terms.map((t) => t.contractId);
  const [tousReleves, soldes] = await Promise.all([
    prisma.attendance.findMany({
      where: { contractId: { in: contractIds } },
      orderBy: { periodStart: "desc" },
      select: {
        id: true,
        contractId: true,
        periodStart: true,
        periodEnd: true,
        declaredQuantity: true,
        approvedQuantity: true,
        status: true,
      },
    }),
    escrowBalancesFor(contractIds),
  ]);

  const relevesParContrat = new Map<string, typeof tousReleves>();
  for (const r of tousReleves) {
    const liste = relevesParContrat.get(r.contractId) ?? [];
    liste.push(r);
    relevesParContrat.set(r.contractId, liste);
  }

  const chantiers = terms.map((t) => {
      const pures = {
        rateUnit: t.rateUnit,
        rate: t.rate,
        maxQuantity: t.maxQuantity,
        maxAmount: t.maxAmount,
        overtimeAllowed: t.overtimeAllowed,
        overtimeRate: t.overtimeRate,
      };
      const releves = relevesParContrat.get(t.contractId) ?? [];
      const balance = soldes.get(t.contractId);
      const available = balance?.available ?? 0;

      // En OPR, « à constater » = soumis par le prestataire, pas encore vérifiés.
      const enAttente = releves.filter((r) => r.status === "submitted");
      const valides = releves.filter((r) => r.status === "approved");
      const consomme = valides.reduce((s, r) => s + (r.approvedQuantity ?? 0), 0);

      return {
        missionId: t.contract.missionId,
        missionTitre: t.contract.mission.titre,
        missionStatus: t.contract.mission.status,
        currency: t.contract.mission.currency,
        worker: {
          id: t.contract.provider.id,
          name:
            [t.contract.provider.firstname, t.contract.provider.lastname]
              .filter(Boolean)
              .join(" ")
              .trim() || "Travailleur",
          avatarUrl: t.contract.provider.avatarPath ? `/api/users/${t.contract.provider.id}/avatar` : null,
        },
        terms: pures,
        consumedQuantity: consomme,
        remainingQuantity: Math.max(0, t.maxQuantity - consomme),
        // L'alerte du §19 est l'information la plus utile de cet écran : c'est le responsable de
        // chantier qui verra l'équipe s'arrêter, et c'est donc à lui de prévenir à temps.
        funding: fundingAlert(pures, available),
        available,
        // Relevés en litige : le responsable doit les voir, ce sont eux qui immobilisent des
        // fonds sur son chantier.
        disputedCount: releves.filter((r) => r.status === "disputed").length,
        pending: enAttente.map((r) => ({
          id: r.id,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          declaredQuantity: r.declaredQuantity,
          approvedQuantity: r.approvedQuantity,
          status: r.status,
          amount: attendanceAmount(pures, r.declaredQuantity),
        })),
      };
    });

  // Jalons et tâches à vérifier (tout contrat) : livrable soumis, pas encore transmis au client.
  // Un contrat sans jalon se vérifie au niveau de la mission entière.
  type AVerifier = { missionId: string; missionTitre: string; currency: string; jalonId: string | null; titre: string; montant: number | null };
  const aVerifier = contrats.flatMap((c): AVerifier[] => {
    const base = { missionId: c.missionId, missionTitre: c.mission.titre, currency: c.mission.currency };
    if (c.jalons.length > 0) {
      return c.jalons
        .filter((j) => j.status === "livrable_soumis" && !j.verifiedAt)
        .map((j) => ({ ...base, jalonId: j.id, titre: `Jalon ${j.ordre} — ${j.titre}`, montant: j.montant }));
    }
    if (c.spotTimeTerms) return [];
    return c.mission.status === "livrable_soumis" && !c.mission.verifiedAt
      ? [{ ...base, jalonId: null, titre: "Livrable de la mission", montant: null }]
      : [];
  });
  // Missions suivies sans relevés (jalons/tâches) : listées pour que le responsable y accède.
  const missionsSansReleves = contrats
    .filter((c) => !c.spotTimeTerms)
    .map((c) => ({ missionId: c.missionId, missionTitre: c.mission.titre, missionStatus: c.mission.status }));

  return NextResponse.json({
    chantiers,
    missions: missionsSansReleves,
    toVerify: aVerifier,
    toVerifyCount: aVerifier.length,
    pendingCount: chantiers.reduce((s, c) => s + c.pending.length, 0),
    // Chantiers dont le séquestre ne couvre plus grand-chose : ce qu'il faut remonter au client
    // avant l'arrêt, pas après.
    lowFundsCount: chantiers.filter((c) => c.funding.low).length,
  });
}
