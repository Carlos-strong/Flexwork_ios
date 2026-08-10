"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";

type Mission = { id: string; titre: string; status: string; budget: number; currency: string };

export default function ClientDashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[] | null>(null);

  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") { fetch("/api/missions").then(r => r.ok ? r.json() : { items: [] }).then(d => setMissions(d.items)); } }, [status]);

  if (status === "loading") return <div className="min-h-screen bg-zinc-50 flex items-center justify-center"><div className="text-[14px] text-zinc-500">Chargement...</div></div>;
  if (status === "unauthenticated") return null;

  // `missions === null` (encore en chargement) est distingué de `[]` (aucune mission) plus
  // bas dans le tableau — auparavant les deux rendaient un tableau vide identique, donnant
  // l'impression qu'une mission tout juste créée "disparaissait" brièvement au rechargement
  // avant de "réapparaître" une fois le fetch résolu.
  const all = missions?.length ?? 0;
  // "brouillon" n'est pas "en cours" — exclu explicitement (comptée dans "Missions" seulement).
  const enCours = missions?.filter(m => !["brouillon", "publiee", "cloturee"].includes(m.status)).length ?? 0;
  const terminees = missions?.filter(m => m.status === "cloturee").length ?? 0;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        <h1 className="text-[22px] font-bold text-zinc-900 mb-1">Dashboard Client</h1>
        <p className="text-[13px] text-zinc-500 mb-6">Gérez vos missions et trouvez le bon talent</p>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[{ label: "Missions", value: all, color: "#008751" }, { label: "En cours", value: enCours, color: "#FCD116" }, { label: "Terminées", value: terminees, color: "#E8112D" }].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-zinc-200 p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl grid place-items-center text-xl" style={{ backgroundColor: s.color + "15" }}>{s.color === "#008751" ? "📋" : s.color === "#FCD116" ? "⏳" : "✅"}</div>
              <div><div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div><div className="text-[12px] text-zinc-500">{s.label}</div></div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[{ label: "Nouvelle mission", href: "/missions/new", icon: "📝", color: "#008751" }, { label: "Trouver un talent", href: "/recherche", icon: "🔍", color: "#FCD116" }, { label: "Mes contrats", href: "/missions", icon: "📄", color: "#E8112D" }].map(a => (
            <Link key={a.label} href={a.href} className="bg-white rounded-2xl border border-zinc-200 p-5 flex items-center gap-4 hover:shadow-md hover:border-zinc-300 transition" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="w-12 h-12 rounded-xl grid place-items-center text-xl" style={{ backgroundColor: a.color + "15" }}>{a.icon}</div>
              <div className="font-semibold text-[14px]">{a.label}</div>
            </Link>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="font-semibold text-[15px]">Mes missions</h2>
            <Link href="/missions/new" className="h-9 px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#065f46] transition inline-flex items-center" style={{ textDecoration: "none" }}>+ Nouvelle</Link>
          </div>
          <table className="w-full text-[13px]">
            <thead><tr className="bg-zinc-50 text-zinc-500 text-[11px] font-semibold uppercase tracking-wider"><th className="text-left px-6 py-3">Mission</th><th className="text-left px-6 py-3">Budget</th><th className="text-left px-6 py-3">Statut</th><th className="text-right px-6 py-3">Action</th></tr></thead>
            <tbody>
              {missions === null ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-zinc-400">Chargement de vos missions...</td></tr>
              ) : missions.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-zinc-400">Aucune mission.</td></tr>
              ) : (
                missions.map(m => {
                  const st = MISSION_STATUS_STYLE[m.status as keyof typeof MISSION_STATUS_STYLE] ?? MISSION_STATUS_STYLE.brouillon;
                  return (
                    <tr key={m.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                      <td className="px-6 py-3 font-medium">{m.titre}</td><td className="px-6 py-3">{m.budget.toLocaleString("fr-FR")} {m.currency}</td>
                      <td className="px-6 py-3"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}</span></td>
                      <td className="px-6 py-3 text-right"><Link href={`/missions/${m.id}/contract`} className="h-8 px-4 rounded-full border border-zinc-200 text-[12px] font-medium hover:bg-zinc-100 transition inline-flex items-center" style={{ textDecoration: "none", color: "inherit" }}>Ouvrir</Link></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
