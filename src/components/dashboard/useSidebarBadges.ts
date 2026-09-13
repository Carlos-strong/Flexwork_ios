"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { onBadgesShouldRefresh } from "@/lib/badge-sync";

type Mode = "client" | "prestataire";

type Conversation = { lastMessage?: { sent?: boolean } | null };

/**
 * Badges du sidebar pilotés par les ÉVÉNEMENTS réels (au lieu de compteurs statiques) :
 * - messages       : conversations avec un message non lu reçu
 * - missions       : prestataire → nouvelles missions correspondant au profil ;
 *                    client → missions nécessitant une action (proposition acceptée,
 *                    livrable à valider)
 * - candidatures   : prestataire → candidatures en attente
 * - offres         : prestataire → offres formelles reçues en attente de réponse
 * - propositions   : client → propositions reçues
 * - paiements      : client → missions dont les fonds sont bloqués en séquestre
 *
 * NB : les notifications in-app (KYC, etc.) ne sont PAS un badge de sidebar — elles sont
 * portées par la cloche du navbar (NotificationsBell), synchronisée par utilisateur.
 *
 * Poll toutes les 30s (même cadence que la cloche de notifications) + au focus de
 * l'onglet. Chaque source est indépendante : un échec n'écrase pas les autres badges.
 */
export function useSidebarBadges(mode: Mode): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const next: Record<string, number> = {};

    // Messages non lus (conversations dont le dernier message est un message reçu).
    try {
      const r = await fetchDedupe("/api/messages");
      if (r.ok) {
        const d = await r.json();
        next.messages = (d.conversations ?? []).filter(
          (c: Conversation) => c.lastMessage && !c.lastMessage.sent,
        ).length;
      }
    } catch {
      /* réseau indisponible — on garde la valeur précédente */
    }

    if (mode === "prestataire") {
      // Nouvelles missions correspondantes + candidatures en attente.
      try {
        const r = await fetchDedupe("/api/dashboard/provider-summary");
        if (r.ok) {
          const d = await r.json();
          next.missions = d.newMissionsToday ?? 0;
          next.candidatures = d.stats?.pendingProposals ?? 0;
        }
      } catch {
        /* silencieux */
      }
      // Offres formelles en attente de réponse (status "envoyee").
      try {
        const r = await fetchDedupe("/api/offers");
        if (r.ok) {
          const d = await r.json();
          const items: Array<{ status: string }> = d.items ?? [];
          next.offres = items.filter((o) => o.status === "envoyee").length;
        }
      } catch {
        /* silencieux */
      }
    } else {
      // Propositions reçues, paiements en séquestre, missions nécessitant une action.
      try {
        const r = await fetchDedupe("/api/missions");
        if (r.ok) {
          const d = await r.json();
          type ClientMission = { status: string; _count?: { proposals?: number }; contract?: { jalons: { status: string }[] } | null };
          const items: ClientMission[] = d.items ?? [];
          // Sur un contrat à jalons, mission.status ne passe jamais à "livrable_soumis" —
          // seul jalon.status le fait, jalon par jalon (voir src/lib/psp-webhook.ts). Sans ce
          // repli, ce badge (et le dashboard) ratait toute mission à jalons ayant un livrable
          // réellement en attente de vérification.
          const hasPendingJalon = (m: ClientMission) => (m.contract?.jalons.length ?? 0) > 0 && m.contract!.jalons.some((j) => j.status === "livrable_soumis");
          next.propositions = items.reduce((s, m) => s + (m._count?.proposals ?? 0), 0);
          next.paiements = items.filter((m) => m.status === "fonds_sous_sequestre").length;
          next.missions = items.filter((m) =>
            m.status === "proposition_acceptee" || m.status === "livrable_soumis" || hasPendingJalon(m),
          ).length;
        }
      } catch {
        /* silencieux */
      }
    }

    setBadges(next);
  }, [mode]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Resynchronisation immédiate après une action locale (réponse à une offre, validation
    // d'un jalon, envoi d'un message…) — voir src/lib/badge-sync.ts.
    const unsubscribe = onBadgesShouldRefresh(refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);

  return badges;
}
