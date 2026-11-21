import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getPublicMission } from "@/lib/public-mission";
import { PublicMissionView, type PublicMissionViewer } from "@/components/mission/PublicMissionView";

// Page publique d'une mission (2026-11-11) — destination de « Ouvrir la mission » depuis le
// tableau de bord client et Mes Missions, au format de la maquette « fiche mission ».
//
// Ouverte à tous, comme la fiche que voit un visiteur sur /missions/[id] : mêmes données filtrées
// (getPublicMission — ni nom du client, ni cahier des charges, ni pièces jointes). Le serveur
// reconnaît le CLIENT PROPRIÉTAIRE et lui ajoute, à lui seul, son nom, sa ville et son nombre
// de missions publiées, avec les actions de gestion des candidatures.
//
// Le PROPRIÉTAIRE la voit quel que soit le statut (2026-11-11 : « Ouvrir la mission » y mène
// pour toutes ses missions), contrat et jalons compris. Pour tous les autres, une mission qui
// n'est plus publique (engagée, clôturée…) n'a pas de page publique : un membre connecté est
// renvoyé vers /missions/[id], un visiteur reçoit une 404 — comme GET /api/missions/[id]/public.

type Params = { params: { id: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const m = await getPublicMission(params.id);
  return m ? { title: `${m.titre} — Mission publique`, description: m.description.slice(0, 160) } : {};
}

export default async function PublicMissionPage({ params }: Params) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  // Le propriétaire voit sa fiche quel que soit le statut de la mission (vue propriétaire).
  const owned = userId
    ? await prisma.mission.findFirst({ where: { id: params.id, clientId: userId }, select: { id: true } })
    : null;
  const mission = await getPublicMission(params.id, owned && userId ? { ownerId: userId } : {});

  if (!mission) {
    if (userId) redirect(`/missions/${encodeURIComponent(params.id)}`);
    notFound();
  }

  let viewer: PublicMissionViewer = { kind: userId ? "member" : "visitor" };
  if (owned && userId) {
    const [user, missionsPubliees] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { firstname: true, lastname: true, city: true } }),
      // Missions publiées : les engagements (missions enfants d'une annonce) ne comptent pas.
      prisma.mission.count({ where: { clientId: userId, status: { not: "brouillon" }, parentMissionId: null } }),
    ]);
    viewer = {
      kind: "owner",
      fullName: [user?.firstname?.trim(), user?.lastname?.trim()].filter(Boolean).join(" ") || "Vous",
      city: user?.city?.trim() || null,
      missionsPubliees,
    };
  }

  return <PublicMissionView mission={mission} viewer={viewer} />;
}
