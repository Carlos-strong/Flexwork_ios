"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ADMIN_ROLE_META, modulesForRole } from "@/lib/admin-roles";
import { useAdminRole } from "@/components/admin/admin-role-context";
import { AdminCard, AdminPageHeader, KpiStrip, fetchJson, formatXof, type Kpi } from "@/components/admin/admin-ui";

type Supervision = { users: number; missions: number; activeMissions: number; backlog: number; adminActions24h: number };
type MediationTotals = { held: number; funded: number; released: number };
type ContentOverview = {
  release: { version: number; publishedAt: string } | null;
  counts: { categories: number; metiers: number; services: number; sectionsTotal: number; menuItems: number };
};

/**
 * Dashboard du Back Office — gabarit de flexwork_job : une bande de KPI, puis les rubriques de
 * l'espace en tuiles, chacune avec ce qu'elle couvre.
 *
 * Les KPI de flexwork_job (« CA plateforme », « Commissions ») ne sont pas repris : la
 * plateforme ne facture rien dans le schéma v3 — le PSP détient les fonds, aucun modèle de
 * facturation n'existe. On affiche ce qui se mesure : l'activité, le séquestre, le contenu.
 */
export default function BackOfficeDashboard() {
  const role = useAdminRole();
  const [supervision, setSupervision] = useState<Supervision | null>(null);
  const [money, setMoney] = useState<MediationTotals | null>(null);
  const [content, setContent] = useState<ContentOverview | null>(null);

  useEffect(() => {
    if (!role) return;
    if (role === "superviseur") {
      fetchJson<{ supervision: Supervision | null; mediation: MediationTotals | null }>("/api/admin/dashboard").then((r) => {
        if (r.ok) {
          setSupervision(r.data.supervision);
          setMoney(r.data.mediation);
        }
      });
    }
    if (role === "superviseur" || role === "frontend") {
      fetchJson<ContentOverview>("/api/admin/frontend/overview").then((r) => r.ok && setContent(r.data));
    }
  }, [role]);

  if (!role) return null;

  const kpis: Kpi[] = [];
  if (supervision) {
    kpis.push(
      { icon: "👥", label: "Utilisateurs", value: supervision.users.toLocaleString("fr-FR") },
      { icon: "📋", label: "Missions", value: supervision.missions.toLocaleString("fr-FR"), hint: `${supervision.activeMissions} actives` },
    );
  }
  if (money) {
    kpis.push({ icon: "🔒", label: "Sous séquestre", value: formatXof(money.held), tone: "green", hint: "détenu par le PSP" });
  }
  if (content) {
    kpis.push(
      { icon: "🗂️", label: "Catégories", value: content.counts.categories, hint: `${content.counts.metiers} métiers · ${content.counts.services} services` },
      {
        icon: "🖼️",
        label: "Contenu publié",
        value: content.release ? `v${content.release.version}` : "—",
        hint: content.release ? new Date(content.release.publishedAt).toLocaleDateString("fr-FR") : "jamais publié",
        tone: "blue",
      },
    );
  }

  const tiles = modulesForRole(role, "backoffice").filter((m) => m.id !== "bo-dashboard");

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Back Office"
        subtitle={`Paramétrage et contrôle de la plateforme — rubriques ouvertes au rôle « ${ADMIN_ROLE_META[role].label} ».`}
      />

      {kpis.length > 0 && <KpiStrip items={kpis} />}

      <AdminCard title="Rubriques">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className="rounded-[12px] border border-[#E2E0D9] bg-[#FAFAF8] p-4 transition hover:border-[#C3D1F8] hover:bg-[#EEF2FD]"
              style={{ textDecoration: "none" }}
            >
              <div className="text-[22px] leading-none">{m.icon}</div>
              <div className="mt-2 text-[14px] font-semibold text-[#1A1916]">{m.label}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-[#5A5750]">{m.hint}</div>
            </Link>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
