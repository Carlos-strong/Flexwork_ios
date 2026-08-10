"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Bell } from "lucide-react";

type NotificationItem = { id: string; type: string; message: string; readAt: string | null; createdAt: string };

const TYPE_LABEL: Record<string, string> = {
  kyc_verifie: "Identité vérifiée",
  kyc_rejete: "KYC rejeté",
};

// Cloche de notifications in-app (dashboard) — montée dans le header commun à toutes les
// pages authentifiées, plutôt que dupliquée dans chaque dashboard/[role]/page.tsx.
export function NotificationsBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // réseau indisponible ou changé — silencieux, le polling réessayera
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

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
                  <div className="text-[11px] font-bold text-[#008751] mb-0.5">{TYPE_LABEL[n.type] ?? n.type}</div>
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
