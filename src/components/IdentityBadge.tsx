import { ShieldCheck } from "lucide-react";

// Badge de vérification — modèle v3 (modele-skillafrica-v3-Flexwork.md §9-10) : UN SEUL
// badge de vérification existe, dérivé du KYC : « IDENTITE_VERIFIEE ». Tout le reste
// (qualifications, assurance, expérience) est déclaratif et affiché comme non vérifié.
// Ce composant ne rend JAMAIS de badge de compétence « vérifié » (A8/A11 ont supprimé la
// certification plateforme et les badges de niveau).
export function IdentityBadge({
  verified,
  size = "md",
}: {
  verified: boolean;
  size?: "sm" | "md";
}) {
  if (verified) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[#008751]/10 border border-[#008751]/25 font-semibold ${
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-[12px]"
        } text-[#008751]`}
      >
        <ShieldCheck className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        Identité vérifiée
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-zinc-100 border border-zinc-200 font-medium ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-[12px]"
      } text-zinc-500`}
    >
      <ShieldCheck className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      Non vérifiée
    </span>
  );
}

// Libellé de statut déclaratif (assurance/qualification) — toujours « Déclaré (non vérifié) »,
// jamais « Vérifié » (formulations interdites du modèle v3 §4.3).
export function DeclaredBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-[12px] font-medium text-amber-800">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {label}
    </span>
  );
}
