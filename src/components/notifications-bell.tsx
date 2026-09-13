"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { onBadgesShouldRefresh, refreshBadges } from "@/lib/badge-sync";
import { Bell } from "lucide-react";
// Libellés partagés — la cloche porte désormais TOUS les types d'événements (compte,
// mission, messagerie), plus seulement les deux valeurs KYC d'origine (2026-09-09).
import { notificationLabel } from "@/lib/notification-labels";
import { useSession } from "next-auth/react";

type NotificationItem = { id: string; type: string; message: string; missionId: string | null; readAt: string | null; createdAt: string };

// Cloche de notifications in-app — montée dans le header commun à toutes les pages
// authentifiées (dashboard, nav.tsx, header AfriLance). Synchronisée PAR UTILISATEUR :
// le fil et le compteur non lu dépendent de l'utilisateur de la session courante.
export function NotificationsBell() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchDedupe("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // réseau indisponible ou changé — silencieux, le polling réessayera
    }
  }, []);

  // Quand l'utilisateur change (connexion, déconnexion, bascule de compte), on vide le
  // fil ET le compteur puis on recharge pour ne jamais afficher les notifications d'un
  // autre compte. Le polling 30s est recréé à chaque changement d'utilisateur.
  useEffect(() => {
    setItems([]);
    setUnreadCount(0);
    if (!userId) return;
    load();
    const interval = setInterval(load, 30000);
    // Resynchronisation immédiate quand une action ailleurs sur la page signale un changement
    // (voir src/lib/badge-sync.ts) — au lieu d'attendre jusqu'à 30s.
    const unsubscribe = onBadgesShouldRefresh(load);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [userId, load]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      try {
        await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
      } catch {
        // réseau indisponible — on met à jour l'UI malgré tout, le prochain polling synchronisera
      }
      setUnreadCount(0);
      setItems(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      // Signale la lecture aux autres badges (sidebar) — sans effet aujourd'hui (aucun badge
      // sidebar ne dépend des notifications in-app) mais évite qu'un futur type de
      // notification lié à un badge (ex: paiement) reste désynchronisé après lecture.
      refreshBadges();
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggleOpen} aria-label="Notifications"
        className="relative w-9 h-9 grid place-items-center rounded-full hover:bg-zinc-100 transition-colors">
        <Bell size={18} className="text-zinc-600" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#E8112D] text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-2xl border border-zinc-200 shadow-lg z-50">
          <div className="px-4 py-3 border-b border-zinc-100 text-[13px] font-bold text-zinc-900">Notifications</div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-zinc-400">Aucune notification.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {items.map(n => (
                <li key={n.id} className={`px-4 py-3 ${!n.readAt ? "bg-[#f0fdf4]" : ""}`}>
                  <div className="text-[11px] font-bold text-[#008751] mb-0.5">{notificationLabel(n.type)}</div>
                  <div className="text-[12px] text-zinc-700 leading-snug">{n.message}</div>
                  <div className="text-[10px] text-zinc-400 mt-1">{new Date(n.createdAt).toLocaleString("fr-FR")}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
