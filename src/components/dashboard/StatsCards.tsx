"use client";

import { STATUS_TABS, type ApiMission } from "./types";

// ---------------------------------------------------------------------------
// StatsCards — KPI cards horizontales
// ---------------------------------------------------------------------------
export type StatItem = { label: string; value: string | number; color: string; icon: string };

export function StatsCards({ stats }: { stats: StatItem[] }) {
  return (
    <div className={`grid gap-4 mb-6 ${stats.length <= 3 ? "grid-cols-3" : "grid-cols-2 md:grid-cols-4"}`}>
      {stats.map((s) => (
        <div key={s.label} className="bg-white rounded-2xl border border-zinc-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl grid place-items-center text-xl" style={{ backgroundColor: s.color + "15" }}>
            {s.icon}
          </div>
          <div>
            <div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[12px] text-zinc-500">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusTabs — filtres horizontaux par statut
// ---------------------------------------------------------------------------
export function StatusTabs({
  filter, onFilter, missions,
}: {
  filter: string;
  onFilter: (id: string) => void;
  missions: ApiMission[] | null;
}) {
  const counts: Record<string, number> = {};
  for (const t of STATUS_TABS) {
    counts[t.id] = t.id === "Tous"
      ? (missions ?? []).length
      : (missions ?? []).filter((m) => m.status === t.id).length;
  }
  return (
    <div className="mt-5 -mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto scrollbar-none">
      <div className="flex gap-2.5 w-max pb-2">
        {STATUS_TABS.map((s) => {
          const active = filter === s.id;
          return (
            <button key={s.id} onClick={() => onFilter(s.id)}
              className={`h-9 px-4 rounded-full text-[13px] font-medium inline-flex items-center gap-2 border transition-all duration-200 whitespace-nowrap ${active ? "bg-[#008751] text-white border-[#008751] shadow-[0_4px_14px_rgba(0,135,81,0.25)]" : "bg-white text-zinc-600 border-gray-100 hover:border-gray-200 hover:shadow-sm"}`}>
              {s.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-gray-100 text-zinc-600"}`}>
                {counts[s.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
