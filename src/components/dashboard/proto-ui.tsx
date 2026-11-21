// Briques de mise en page du modèle UI/UX « Marketplace Escrow » (2026-11-11), partagées par
// les pages clés (tableaux de bord client et prestataire, Mes Missions) :
//   PageHero      sur-titre violet + grand titre Sora + sous-titre + actions
//   StatTile      icône émeraude, valeur Sora, libellé discret
//   FilterChips   filtres en pilules (actif = encre, inactif = blanc filet)
//   MissionCard   carte à en-tête dégradé (catégorie, lieu/échéance), statut, montant,
//                 progression, deux actions
// Purement visuelles : elles ne lisent ni n'écrivent aucune donnée.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Clock, MapPin } from "lucide-react";

export function PageHero({ kicker, title, subtitle, actions }: { kicker: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <p className="kicker">{kicker}</p>
        <h1 className="font-display font-extrabold leading-[1.05] text-[#191224] mt-1" style={{ fontSize: "clamp(28px, 4vw, 44px)" }}>{title}</h1>
        {subtitle && <p className="mt-2 text-sm max-w-[620px] text-[#6B6478]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const pill = "inline-flex items-center justify-center gap-2 rounded-full font-bold transition";
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${pill} px-4 py-3 text-[14px] bg-[#4C1D95] text-white hover:bg-[#3B1578]`} style={{ textDecoration: "none" }}>
      {children} <ArrowRight className="w-4 h-4" aria-hidden />
    </Link>
  );
}
export function OutlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${pill} px-4 py-3 text-[14px] bg-white border border-[#E7E2F0] text-[#191224] hover:border-[#4C1D95] hover:text-[#4C1D95]`} style={{ textDecoration: "none" }}>
      {children}
    </Link>
  );
}

export function StatTile({ icon, value, label, sub, onClick }: { icon: ReactNode; value: ReactNode; label: string; sub?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[#047857] [&>svg]:w-6 [&>svg]:h-6" aria-hidden>{icon}</div>
      <div className="font-display font-extrabold mt-1 text-[#191224] leading-tight" style={{ fontSize: "clamp(20px, 3vw, 28px)" }}>{value}</div>
      <div className="text-[12px] text-[#6B6478]">{label}</div>
      {sub && <div className="text-[11px] text-[#9A93A8] mt-1">{sub}</div>}
    </>
  );
  const cls = "rounded-2xl p-3 sm:p-4 border border-[#E7E2F0] bg-white text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:border-[#4C1D95] transition-colors`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function FilterChips({ options, value, onChange, counts }: { options: string[]; value: string; onChange: (v: string) => void; counts?: Record<string, number> }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrer">
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o)}
            className={`px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${active ? "bg-[#191224] text-white" : "bg-white border border-[#E7E2F0] text-[#191224] hover:border-[#4C1D95]"}`}
          >
            {o}
            {counts && <span className={`ml-1.5 text-xs ${active ? "text-white/70" : "text-[#9A93A8]"}`}>{counts[o] ?? 0}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Couleur d'en-tête stable par catégorie — les quatre teintes des cartes du prototype.
const HEADER_COLORS = ["#4C1D95", "#047857", "#B45309", "#1D4ED8", "#6D28D9"];
export function categoryColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return HEADER_COLORS[Math.abs(h) % HEADER_COLORS.length];
}

// Teintes des badges de statut du prototype.
export type Tone = "success" | "warning" | "danger" | "info" | "muted";
export const TONE_CLASS: Record<Tone, string> = {
  success: "bg-[#E7F7EF] text-[#047857]",
  warning: "bg-[#FFF6E3] text-[#B45309]",
  danger: "bg-[#FEECEB] text-[#B42318]",
  info: "bg-[#F0EAFF] text-[#4C1D95]",
  muted: "bg-[#EFEAF8] text-[#6B6478]",
};
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function MissionCard({
  href,
  title,
  category,
  place,
  deadline,
  badges,
  amount,
  meta,
  progress,
  footer,
  primaryLabel = "Ouvrir la mission",
  secondary,
}: {
  href: string;
  title: string;
  category: string;
  place?: string | null;
  deadline?: string | null;
  badges?: ReactNode;
  amount: ReactNode;
  meta?: ReactNode;
  progress?: number | null;
  footer?: ReactNode;
  primaryLabel?: string;
  secondary?: { href: string; label: string } | null;
}) {
  const color = categoryColor(category || title);
  return (
    <article className="rounded-3xl overflow-hidden border border-[#E7E2F0] bg-white pop flex flex-col">
      <div className="h-24 p-4 flex justify-between items-start gap-2" style={{ background: `linear-gradient(120deg, ${color}, #0f766e)` }}>
        <span className="text-white text-xs font-bold bg-black/25 px-2 py-1 rounded-full truncate max-w-[60%] capitalize">{category ? category.replace(/[-_]+/g, " ") : "Mission"}</span>
        {(place || deadline) && (
          <span className="flex gap-1.5">
            {place && (
              <span className="text-white text-xs font-bold bg-black/25 px-2 py-1 rounded-full flex items-center gap-1 whitespace-nowrap">
                <MapPin className="w-3 h-3" aria-hidden />
                {place}
              </span>
            )}
            {deadline && (
              <span className="text-white text-xs font-bold bg-black/25 px-2 py-1 rounded-full flex items-center gap-1 whitespace-nowrap">
                <Clock className="w-3 h-3" aria-hidden />
                {deadline}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        {badges && <div className="flex flex-wrap gap-2">{badges}</div>}
        <h3 className="font-display font-bold mt-2 leading-snug text-[#191224] line-clamp-2">{title}</h3>
        <div className="flex justify-between items-center gap-2 mt-3 text-sm">
          <span className="font-extrabold text-[#047857] whitespace-nowrap">{amount}</span>
          {meta && <span className="text-[#6B6478] truncate">{meta}</span>}
        </div>
        {progress != null && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-2 rounded-full bg-[#EFEAF8]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progression">
              <div className="h-2 rounded-full bg-[#047857]" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-[#6B6478]">{progress}%</span>
          </div>
        )}
        {footer && <div className="mt-3">{footer}</div>}
        <div className="flex gap-2 mt-auto pt-4">
          <Link href={href} className="flex-1 py-2.5 rounded-full font-bold text-white text-sm text-center bg-[#4C1D95] hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
            {primaryLabel}
          </Link>
          {secondary && (
            <Link href={secondary.href} className="px-3 py-2.5 rounded-full border border-[#E7E2F0] text-sm font-bold text-[#191224] hover:border-[#4C1D95]" style={{ textDecoration: "none" }}>
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
