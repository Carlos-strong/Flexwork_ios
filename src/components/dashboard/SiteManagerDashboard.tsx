"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HardHat, Users, Wallet, AlertTriangle } from "lucide-react";
import DashboardLayout, { type DashboardUser, type NavItem } from "@/components/dashboard/DashboardLayout";
import Messagerie from "@/components/dashboard/Messagerie";
import { AttendancePanel } from "@/components/spot-time/attendance-panel";
import { useUserIdentity } from "@/components/user-identity";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import type { Session } from "next-auth";

// Tableau de bord du RESPONSABLE DE CHANTIER (2026-09-14, §8 du prompt S2).
//
// Volontairement dépouillé, et c'est le point : ce rôle ne candidate pas, ne soumet pas de devis
// et n'est pas payé par la plateforme. Lui servir la navigation d'un prestataire — missions
// disponibles, candidatures, wallet — lui donnerait quatre rubriques sans objet et masquerait la
// seule qui compte : les relevés que son équipe attend de le voir constater.
//
// Son périmètre est entièrement dérivé des DÉSIGNATIONS que les clients lui ont faites, contrat
// par contrat. Un compte sans désignation voit un tableau vide — c'est exact, et c'est voulu :
// le rôle seul n'ouvre aucun droit.

type RateUnit = "hour" | "day" | "month";

type Chantier = {
  missionId: string;
  missionTitre: string;
  missionStatus: string;
  currency: string;
  worker: { id: string; name: string; avatarUrl: string | null };
  terms: { rateUnit: RateUnit; rate: number; maxQuantity: number; maxAmount: number };
  consumedQuantity: number;
  remainingQuantity: number;
  funding: { remainingUnits: number; low: boolean };
  available: number;
  pending: { id: string; periodStart: string; declaredQuantity: number; amount: number }[];
};

type Summary = { chantiers: Chantier[]; pendingCount: number; lowFundsCount: number };

const UNIT_LABEL: Record<RateUnit, { one: string; many: string }> = {
  hour: { one: "heure", many: "heures" },
  day: { one: "jour", many: "jours" },
  month: { one: "mois", many: "mois" },
};

function unite(n: number, unit: RateUnit) {
  const l = UNIT_LABEL[unit];
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? l.many : l.one}`;
}

const FALLBACK_USER: DashboardUser = {
  initials: "RC",
  name: "Responsable chantier",
  role: "Responsable chantier",
  avatarGradient: "from-[#0A1931] to-[#008751]",
};

// Navigation propre au rôle — trois rubriques, pas sept.
const SITE_MANAGER_NAV: NavItem[] = [
  { id: "dashboard", label: "Mes chantiers", Icon: HardHat, href: "/dashboard/responsable-chantier" },
  { id: "equipe", label: "Équipe", Icon: Users, href: "/dashboard/responsable-chantier/equipe" },
  { id: "messages", label: "Messages", Icon: Wallet, href: "/dashboard/responsable-chantier/messages" },
];

function StatCard({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className="bg-white rounded-[16px] border border-gray-100 p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-full h-1 ${alert ? "bg-[#E8112D]" : "bg-[#008751]"}`} />
      <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{label}</div>
      <div className="text-[28px] font-bold tracking-tight text-[#0A1931]">{value}</div>
      <div className="text-[12px] text-zinc-400 mt-0.5">{sub}</div>
    </div>
  );
}

export default function SiteManagerDashboard({ initialNav = "dashboard" }: { initialNav?: string } = {}) {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter();
  const identity = useUserIdentity();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);

  const currentUserId = (session?.user as { id?: string })?.id ?? "";

  const load = useCallback(() => {
    fetchDedupe("/api/dashboard/site-manager-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#008751] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  const user: DashboardUser = identity
    ? { ...FALLBACK_USER, name: identity.name, initials: identity.initials, avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { ...FALLBACK_USER, avatarUrl: null, id: currentUserId };

  const chantiers = summary?.chantiers ?? [];

  return (
    <DashboardLayout
      mode="prestataire"
      user={user}
      navItems={SITE_MANAGER_NAV}
      activeNav={initialNav}
      onNavChange={(id) => router.push(SITE_MANAGER_NAV.find((n) => n.id === id)?.href ?? "/dashboard/responsable-chantier")}
      title="Mes chantiers"
      hideDocuments
    >
      {initialNav === "messages" ? (
        <Messagerie currentUserId={currentUserId} />
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931] tracking-tight">
              Bonjour {identity?.name ?? "Responsable"} 👷
            </h1>
            <p className="text-[13px] text-zinc-500 mt-1">
              Vous constatez la présence sur les chantiers où le client vous a désigné.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-6">
            <StatCard label="Chantiers" value={String(chantiers.length)} sub="sous votre responsabilité" />
            <StatCard
              label="À constater"
              value={String(summary?.pendingCount ?? 0)}
              sub="relevés en attente"
              alert={(summary?.pendingCount ?? 0) > 0}
            />
            <StatCard
              label="Financement bas"
              value={String(summary?.lowFundsCount ?? 0)}
              sub="chantiers à signaler"
              alert={(summary?.lowFundsCount ?? 0) > 0}
            />
          </div>

          {chantiers.length === 0 && (
            <div className="bg-white rounded-[20px] border border-gray-100 p-10 text-center">
              <p className="text-[14px] text-zinc-500">Aucun chantier ne vous est confié pour l&apos;instant.</p>
              <p className="text-[12.5px] text-zinc-400 mt-1.5">
                Un client doit vous désigner comme responsable sur un contrat au temps pour que vous
                puissiez y constater les présences.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {chantiers.map((c) => (
              <div key={c.missionId} className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[14px] text-[#0A1931]">{c.missionTitre}</h3>
                    <p className="text-[12px] text-zinc-500 mt-0.5">
                      {c.worker.name} · {c.terms.rate.toLocaleString("fr-FR")} {c.currency} /{" "}
                      {UNIT_LABEL[c.terms.rateUnit].one}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12.5px] text-zinc-500">
                      {unite(c.consumedQuantity, c.terms.rateUnit)} / {unite(c.terms.maxQuantity, c.terms.rateUnit)}
                    </div>
                    {c.pending.length > 0 && (
                      <span className="inline-flex mt-1 px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[#92400E] text-[10.5px] font-bold">
                        {c.pending.length} à constater
                      </span>
                    )}
                  </div>
                </div>

                {/* L'alerte du §19 à sa vraie place : c'est le responsable de chantier qui verra
                    l'équipe s'arrêter, donc à lui de la remonter au client avant l'arrêt. */}
                {c.funding.low && (
                  <div className="px-5 py-3 bg-[#FFFBEB] border-b border-[#FDE68A] flex items-start gap-2 text-[12.5px] text-[#92400E] leading-relaxed">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Financement bientôt épuisé.</strong> Le séquestre ne couvre plus que{" "}
                      {unite(c.funding.remainingUnits, c.terms.rateUnit)} de présence. Prévenez le client
                      pour éviter l&apos;arrêt du chantier.
                    </span>
                  </div>
                )}

                <div className="px-5 py-4">
                  <button
                    onClick={() => setOuvert(ouvert === c.missionId ? null : c.missionId)}
                    className="h-9 px-4 rounded-full bg-[#0A1931] text-white text-[12.5px] font-semibold hover:bg-black transition-colors"
                  >
                    {ouvert === c.missionId ? "Masquer les relevés" : "Voir et constater les relevés"}
                  </button>
                  <Link
                    href={`/missions/${c.missionId}`}
                    className="ml-2 text-[12.5px] text-zinc-500 hover:text-[#0A1931]"
                    style={{ textDecoration: "none" }}
                  >
                    Détail de la mission →
                  </Link>

                  {ouvert === c.missionId && (
                    <AttendancePanel missionId={c.missionId} className="mt-4" onChanged={load} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
