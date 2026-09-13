"use client";

/**
 * Workspace « Validation Client » dans le chrome par défaut de l'app (sidebar + navbar
 * client, DashboardLayout), rendu épuré (2026-09-03) — SANS le bandeau d'étapes ni la barre
 * d'onglets de la maquette VJR. Composant partagé (règle R03), réutilisé par :
 * Réutilisé par missions/[id]/page.tsx pour le CLIENT PROPRIÉTAIRE d'une mission engagée
 * (la page mission du client affiche directement la vue de validation au lieu du détail
 * générique — correspondance du pattern prestataire missions/[id]/deliverable). L'ancienne
 * route missions/[id]/validation-client redirige désormais vers /missions/[id].
 * Contenu = ValidationClientView (composant AUTONOME qui charge ses propres données) :
 * cette vue ne fournit que le chrome et le conteneur de contenu.
 */

import { useEffect, useState } from "react";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { useUserIdentity } from "@/components/user-identity";
import { ValidationClientView } from "@/components/validation-client/ValidationClientView";
import MissionTracker from "@/components/mission-tracker";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { fetchDedupe } from "@/lib/fetch-dedupe";

const FALLBACK_USER: DashboardUser = {
  initials: "CL",
  name: "Client",
  role: "Cliente",
  avatarGradient: "from-[#FF7A00] to-[#E8112D]",
};

type Interlocutor = { id: string; name: string; avatarPath: string | null };

export default function ClientValidationWorkspace({ missionId }: { missionId: string }) {
  // Badges du sidebar pilotés par les événements réels (messages, propositions, paiements,
  // missions à action) — même hook que les autres pages client.
  const badgeCounts = useSidebarBadges("client");
  // Identité réelle partagée — chargée UNE fois au niveau racine (UserIdentityProvider), pas
  // à chaque montage ; photo via /api/users/me (avatarUrl null si absente → initiales).
  const identity = useUserIdentity();
  const user: DashboardUser = identity
    ? { ...FALLBACK_USER, name: identity.name, initials: identity.initials, avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { ...FALLBACK_USER, avatarUrl: null };

  // Interlocuteur de la bulle de messagerie : le prestataire du contrat de CETTE mission —
  // non ambigu (contrat déjà généré, un seul prestataire engagé), contrairement au détail
  // générique pré-engagement (missions/[id]/page.tsx) qui doit deviner via les candidatures.
  // Absente jusqu'ici de ce workspace (signalé 2026-09-04) : le client n'avait aucun moyen de
  // discuter avec le prestataire pendant les phases de validation (financement, livrable à
  // valider…) sans quitter la page pour la messagerie complète.
  const [interlocutor, setInterlocutor] = useState<Interlocutor | null>(null);
  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}/contract`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c?.provider) return;
        const name = [c.provider.firstname, c.provider.lastname].filter(Boolean).join(" ") || "Prestataire";
        setInterlocutor({ id: c.provider.id, name, avatarPath: c.provider.avatarPath ?? null });
      })
      .catch(() => {});
  }, [missionId]);

  return (
    <DashboardLayout
      mode="client"
      user={user}
      navItems={CLIENT_NAV}
      activeNav="missions"
      onNavChange={() => {}}
      badgeCounts={badgeCounts}
      title="Validation Client"
    >
      <div className="max-w-[1000px] mx-auto space-y-4">
        <MissionTracker missionId={missionId} />
        <ValidationClientView missionId={missionId} />
      </div>
      {interlocutor && identity?.id && (
        <MessageBubble
          missionId={missionId}
          currentUserId={identity.id}
          interlocutorId={interlocutor.id}
          interlocutorName={interlocutor.name}
          interlocutorAvatarPath={interlocutor.avatarPath}
        />
      )}
    </DashboardLayout>
  );
}
