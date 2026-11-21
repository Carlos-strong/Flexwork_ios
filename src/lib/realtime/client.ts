"use client";

import { useEffect } from "react";
import { refreshBadges } from "@/lib/badge-sync";

// Côté navigateur du temps réel (2026-10-01) : UNE connexion EventSource par onglet, partagée par
// tous les composants qui la demandent (compteur de références), branchée sur le bus existant
// `refreshBadges` — la cloche et les badges du tableau de bord se resynchronisent déjà dessus.
//
// Tant que le flux est ouvert, les sondages passent de 30 s à 5 min (`realtimeConnected`) ; ils
// reprennent leur rythme si le flux tombe (proxy qui coupe, serveur redémarré), le temps que le
// navigateur se reconnecte. Le flux ne remplace pas la resynchronisation au focus de l'onglet.

let source: EventSource | null = null;
let users = 0;
let connected = false;

export function realtimeConnected(): boolean {
  return connected;
}

function open() {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  source = new EventSource("/api/realtime/stream");
  // `ready` à chaque (re)connexion : on rattrape ce qui a pu être manqué pendant la coupure.
  source.addEventListener("ready", () => {
    connected = true;
    refreshBadges();
  });
  source.addEventListener("refresh", () => refreshBadges());
  source.onerror = () => {
    // Le navigateur se reconnecte seul (`retry`) ; d'ici là, les sondages reprennent.
    connected = false;
  };
}

function close() {
  source?.close();
  source = null;
  connected = false;
}

/** Ouvre le flux temps réel tant qu'un utilisateur est connecté et que le composant est monté. */
export function useRealtime(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    users++;
    open();
    return () => {
      users--;
      if (users === 0) close();
    };
  }, [userId]);
}
