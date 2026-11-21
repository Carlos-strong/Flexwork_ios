"use client";

import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useEffect, useState } from "react";

type LogEntry = { id: string; createdAt: string; admin: { email: string }; action: string; targetType: string; targetId: string; justification: string };

// Journal d'audit immuable — aligné sur formulaires-flexwork-tous-profils.html.
// Deux journaux : badge_history (transitions de badge) + admin_audit_log (actions admin).
// Append-only, hash chaîné SHA-256, échantillon aléatoire 5% du mois.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx et missions/[id]/proposals/page.tsx (palette #1A1916/#E2E0D9/#2D5BE3) — logique
// et appel API strictement inchangés.
export default function AdminAuditPage() {
  const [data, setData] = useState<{ total: number; sample: LogEntry[] } | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  return (
    <div className="text-[#191224]">
      <div className="space-y-5">
        <AdminPageHeader
          icon="📋"
          title="Audit"
          subtitle="Journal append-only à hash chaîné : qui a fait quoi, sous quelle justification. Rien ne s’y efface."
        />

        <div className="bg-white border border-[#E7E2F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E7E2F0] flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-[13px] font-semibold font-mono">admin_audit_log</h3>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#EFEAF8] text-[#6B6478] text-[11px] font-semibold">{data ? `${data.total} actions ce mois` : "…"}</span>
          </div>
          <p className="px-4 lg:px-5 pt-3 text-[12.5px] text-[#6B6478]">
            Échantillon aléatoire de 5% des actions du mois, tiré à chaque chargement. Append-only, lecture seule.
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#6B6478] uppercase bg-[#F6F5FA] border-y border-[#E7E2F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Heure</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Admin</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Action</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Cible</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Justification</th>
                </tr>
              </thead>
              <tbody>
                {data?.sample.map((entry) => (
                  <tr key={entry.id} className="border-b border-[#EFEAF8] last:border-0">
                    <td className="py-2.5 px-4 lg:px-5 text-[#6B6478] whitespace-nowrap">{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
                    <td className="py-2.5 px-3 text-[#6B6478]">{entry.admin.email}</td>
                    <td className="py-2.5 px-3 text-[#6B6478]">{entry.action}</td>
                    <td className="py-2.5 px-3 text-[#6B6478]">{entry.targetType} #{entry.targetId.slice(0, 8)}</td>
                    <td className="py-2.5 px-4 lg:px-5 text-[#6B6478]">{entry.justification}</td>
                  </tr>
                ))}
                {data?.sample.length === 0 && (
                  <tr><td colSpan={5} className="py-6 px-4 lg:px-5 text-center text-[#9A93A8]">Aucune action ce mois-ci.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
