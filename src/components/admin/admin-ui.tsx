"use client";

import Link from "next/link";

/**
 * Briques d'écran de l'administration, au gabarit de `flexwork_job` : titre en 22 px à
 * interlettrage serré, sous-titre en `#5A5750`, cartes blanches `rounded-[16px]` bordées de
 * `#E2E0D9`, bande de KPI d'un seul tenant. Les écrans les composent au lieu de recopier leurs
 * classes, pour que les deux espaces gardent le même visage.
 */

export function AdminPageHeader({
  icon,
  title,
  subtitle,
  actions,
  readOnly,
}: {
  icon?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Affiche la mention de consultation (§13 : lire n'est pas agir). */
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1A1916]">
          {icon ? `${icon} ` : ""}
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-[14px] text-[#5A5750]">{subtitle}</p>}
        {readOnly && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-[#E2E0D9] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#5A5750]">
            👁 Consultation — aucun geste ne vous est ouvert ici
          </span>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AdminCard({
  title,
  subtitle,
  action,
  children,
  id,
  padded = true,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  padded?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-6 overflow-hidden rounded-[16px] border border-[#E2E0D9] bg-white shadow-sm">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E0D9] px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold text-[#1A1916]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] text-[#5A5750]">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export type Kpi = {
  icon: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red";
  href?: string;
};

const TONES: Record<NonNullable<Kpi["tone"]>, { bg: string; fg: string; hint: string }> = {
  neutral: { bg: "bg-white", fg: "text-[#1A1916]", hint: "text-[#9C9A95]" },
  green: { bg: "bg-[#E6F5EE]", fg: "text-[#1A7A4A]", hint: "text-[#1A7A4A]/80" },
  blue: { bg: "bg-[#EEF2FD]", fg: "text-[#2D5BE3]", hint: "text-[#2D5BE3]/80" },
  amber: { bg: "bg-[#FEF3C7]", fg: "text-[#B45309]", hint: "text-[#B45309]/80" },
  red: { bg: "bg-[#FDEDEC]", fg: "text-[#B42318]", hint: "text-[#B42318]/80" },
};

/** Bande de KPI d'un seul tenant — la signature du tableau de bord de flexwork_job. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="flex flex-col items-stretch overflow-hidden rounded-[16px] border border-[#E2E0D9] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] sm:flex-row">
      {items.map((kpi) => {
        const tone = TONES[kpi.tone ?? "neutral"];
        const body = (
          <>
            <span className="mb-1 text-[18px]">{kpi.icon}</span>
            <span className={`text-center text-[12px] font-medium ${kpi.tone && kpi.tone !== "neutral" ? tone.fg : "text-[#5A5750]"}`}>
              {kpi.label}
            </span>
            <span className={`mt-1 text-[16px] font-bold tabular-nums ${tone.fg}`}>{kpi.value}</span>
            {kpi.hint && <span className={`mt-0.5 text-center text-[10px] ${tone.hint}`}>{kpi.hint}</span>}
          </>
        );
        const cls = `flex flex-1 flex-col items-center justify-center border-b border-[#E2E0D9] p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${tone.bg}`;
        return kpi.href ? (
          <Link key={kpi.label} href={kpi.href} className={`${cls} transition-colors hover:brightness-[0.98]`} style={{ textDecoration: "none" }}>
            {body}
          </Link>
        ) : (
          <div key={kpi.label} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function AdminNotice({
  tone = "blue",
  children,
}: {
  tone?: "blue" | "amber" | "green" | "red";
  children: React.ReactNode;
}) {
  const styles = {
    blue: "bg-[#EEF2FD] border-[#C3D1F8] text-[#2D5BE3]",
    amber: "bg-[#FEF3C7] border-[#FCD89A] text-[#B45309]",
    green: "bg-[#E6F5EE] border-[#9FD4B4] text-[#1A7A4A]",
    red: "bg-[#FDEDEC] border-[#F5C2BE] text-[#B42318]",
  }[tone];
  return <div className={`rounded-[12px] border p-3 text-[13px] font-medium ${styles}`}>{children}</div>;
}

export function AdminEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[#E2E0D9] bg-[#FAFAF8] px-4 py-8 text-center text-[13px] text-[#5A5750]">
      {children}
    </div>
  );
}

/** Classes des tableaux, alignées sur ceux de flexwork_job. */
export const tableHead = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#5A5750]";
export const tableCell = "px-4 py-3 text-[13px] text-[#1A1916]";

export const btnPrimary =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#2D5BE3] px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
export const btnSecondary =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E0D9] bg-white px-3.5 text-[13px] font-medium text-[#5A5750] transition hover:bg-[#FAFAF8] disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#F5C2BE] bg-white px-3.5 text-[13px] font-semibold text-[#B42318] transition hover:bg-[#FDEDEC] disabled:cursor-not-allowed disabled:opacity-50";
export const inputBase =
  "h-10 w-full rounded-lg border border-[#E2E0D9] bg-white px-3 text-[13px] text-[#1A1916] outline-none focus:border-[#2D5BE3] focus:ring-2 focus:ring-[#2D5BE3]/15";

export function formatXof(amount: number): string {
  return `${Math.round(amount).toLocaleString("fr-FR")} XOF`;
}

export async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}
