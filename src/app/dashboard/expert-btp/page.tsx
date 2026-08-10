"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Mission = { id: string; titre: string; budget: number; currency: string; domaine: string };

export default function ExpertBtpDashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [montant, setMontant] = useState("");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") { fetch("/api/missions").then(r => r.ok ? r.json() : { items: [] }).then(d => setMissions(d.items)); } }, [status]);

  if (status === "loading") return <div className="min-h-screen bg-zinc-50 flex items-center justify-center"><div className="text-[14px] text-zinc-500">Chargement...</div></div>;
  if (status === "unauthenticated") return null;

  async function submitProposal(missionId: string) {
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ montant: Number(montant), message: message || undefined }) });
    if (res.ok) { setFeedback("Candidature envoyée !"); setApplyingId(null); setMontant(""); setMessage(""); }
    else { const d = await res.json().catch(() => ({})); setFeedback(d.error === "kyc_not_verified" ? "KYC requis pour candidater." : "Échec."); }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        <h1 className="text-[22px] font-bold text-zinc-900 mb-1">Dashboard Expert BTP</h1>
        <p className="text-[13px] text-zinc-500 mb-6">Profil : Bac/BTS/Licence/Master · Secteur BTP · Modes devis A/B/C</p>
        {feedback && <div className="mb-4 px-4 py-3 rounded-xl bg-[#FEF9C3] border border-[#FCD116] text-[13px] font-medium">{feedback}</div>}

        <div className="grid grid-cols-3 gap-4 mb-6">
          {[{ label: "Missions dispo.", value: missions?.length ?? 0, color: "#008751" }, { label: "Candidatures", value: "—", color: "#FCD116" }, { label: "En cours", value: "—", color: "#E8112D" }].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-zinc-200 p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl grid place-items-center text-xl" style={{ backgroundColor: s.color + "15" }}>{s.color === "#008751" ? "📋" : s.color === "#FCD116" ? "📤" : "🔨"}</div>
              <div><div className="text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div><div className="text-[12px] text-zinc-500">{s.label}</div></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          {[{ label: "Secteur", href: "/profile", icon: "🏗️" }, { label: "Qualifications", href: "/declarations", icon: "📜" }, { label: "KYC", href: "/kyc", icon: "🛡️" }, { label: "Profil", href: "/profil", icon: "👤" }].map(a => (
            <Link key={a.label} href={a.href} className="bg-white rounded-2xl border border-zinc-200 p-4 text-center hover:shadow-md transition" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="text-2xl mb-2">{a.icon}</div><div className="font-semibold text-[13px]">{a.label}</div>
            </Link>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100"><h2 className="font-semibold text-[15px]">Missions BTP disponibles</h2></div>
          <table className="w-full text-[13px]">
            <thead><tr className="bg-zinc-50 text-zinc-500 text-[11px] font-semibold uppercase tracking-wider"><th className="text-left px-6 py-3">Mission</th><th className="text-left px-6 py-3">Budget</th><th className="text-left px-6 py-3">Domaine</th><th className="text-right px-6 py-3">Action</th></tr></thead>
            <tbody>
              {missions?.map(m => (
                <tr key={m.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                  <td className="px-6 py-3 font-medium">{m.titre}</td><td className="px-6 py-3">{m.budget.toLocaleString("fr-FR")} {m.currency}</td><td className="px-6 py-3">{m.domaine}</td>
                  <td className="px-6 py-3 text-right">
                    {applyingId === m.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <input type="number" placeholder="Montant" className="w-[90px] h-8 px-2 rounded-lg border border-zinc-200 text-[12px]" value={montant} onChange={e => setMontant(e.target.value)} />
                        <input type="text" placeholder="Message" className="w-[120px] h-8 px-2 rounded-lg border border-zinc-200 text-[12px]" value={message} onChange={e => setMessage(e.target.value)} />
                        <button onClick={() => submitProposal(m.id)} className="h-8 px-3 rounded-full bg-[#008751] text-white text-[12px] font-semibold">Envoyer</button>
                      </div>
                    ) : (
                      <button onClick={() => setApplyingId(m.id)} className="h-8 px-4 rounded-full bg-[#008751] text-white text-[12px] font-semibold">Candidater</button>
                    )}
                  </td>
                </tr>
              ))}
              {missions?.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-zinc-400">Aucune mission.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
