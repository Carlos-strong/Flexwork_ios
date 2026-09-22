"use client";

import { useEffect, useState } from "react";
import { AdminCard, AdminPageHeader, KpiStrip, fetchJson, formatXof } from "@/components/admin/admin-ui";

type Supervision = { users: number; missions: number; activeMissions: number; backlog: number; adminActions24h: number };
type Money = { held: number; funded: number; released: number };

const EXPORTS: { dataset: string; icon: string; label: string; detail: string }[] = [
  { dataset: "missions", icon: "📋", label: "Missions", detail: "Titre, domaine, statut, budget. Le client est désigné par son identifiant." },
  { dataset: "contrats", icon: "🔄", label: "Contrats", detail: "Parties (identifiants), mode de financement, dates de signature." },
  { dataset: "signalements", icon: "🚩", label: "Signalements", detail: "Cible, motif, décision de la modération." },
  { dataset: "audit", icon: "📋", label: "Journal d’audit", detail: "10 000 dernières actions administratives, avec leur auteur et leur justification." },
];

/**
 * Reporting — rubrique du Back Office de flexwork_job (« Exports Excel, CSV, PDF »).
 *
 * Là-bas, l'écran liste des rapports écrits en dur sans rien exporter. Ici : des indicateurs
 * mesurés et quatre exports CSV réels, pensés pour s'ouvrir tels quels dans un tableur français
 * (séparateur `;`, BOM UTF-8, formules neutralisées). Pas de PDF ni d'Excel natif : aucun
 * générateur n'est en place pour ces formats, et un bouton qui ne produirait rien n'a pas sa place.
 */
export default function ReportingPage() {
  const [sup, setSup] = useState<Supervision | null>(null);
  const [money, setMoney] = useState<Money | null>(null);

  useEffect(() => {
    fetchJson<{ supervision: Supervision | null; mediation: Money | null }>("/api/admin/dashboard").then((r) => {
      if (r.ok) {
        setSup(r.data.supervision);
        setMoney(r.data.mediation);
      }
    });
  }, []);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="📈"
        title="Reporting"
        subtitle="Indicateurs consolidés et exports. Chaque export est journalisé : extraire des données en masse est un geste."
        readOnly
      />

      <KpiStrip
        items={[
          { icon: "👥", label: "Utilisateurs", value: sup ? sup.users.toLocaleString("fr-FR") : "…" },
          { icon: "📋", label: "Missions", value: sup ? sup.missions.toLocaleString("fr-FR") : "…", hint: sup ? `${sup.activeMissions} actives` : undefined },
          { icon: "📥", label: "Versé au séquestre", value: money ? formatXof(money.funded) : "…", tone: "blue" },
          { icon: "📤", label: "Libéré", value: money ? formatXof(money.released) : "…", tone: "green" },
          { icon: "📝", label: "Actions admin", value: sup ? sup.adminActions24h : "…", hint: "sur 24 h" },
        ]}
      />

      <AdminCard
        title="Exports CSV"
        subtitle="Identifiants plutôt qu’adresses : un fichier sort de la plateforme et se transmet, il n’emporte que ce qu’il faut pour être recoupé."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {EXPORTS.map((e) => (
            <a
              key={e.dataset}
              href={`/api/admin/reporting/${e.dataset}`}
              download
              className="flex items-start gap-3 rounded-[12px] border border-[#E2E0D9] bg-[#FAFAF8] p-4 transition hover:border-[#C3D1F8] hover:bg-[#EEF2FD]"
              style={{ textDecoration: "none" }}
            >
              <span className="text-[20px] leading-none">{e.icon}</span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[#1A1916]">{e.label} · CSV</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[#5A5750]">{e.detail}</span>
              </span>
            </a>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
