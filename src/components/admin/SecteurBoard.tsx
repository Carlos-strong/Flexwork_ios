"use client";

import { useState } from "react";
import { SECTEURS } from "@/lib/secteur";

// Classement des catégories par secteur de la marketplace (2026-09-28) — DIGITAL / BTP /
// SERVICES, chacun avec la liste de ses catégories, comme l'éditeur du frontend se représente
// l'entrée de la marketplace.
//
// Deux gestes, et seulement deux :
//   · « Ajouter » rattache une catégorie existante au secteur. Une catégorie déjà rangée
//     ailleurs peut y être déplacée : une catégorie n'a qu'UN secteur, le déplacement est dit
//     explicitement dans la liste (« — actuellement BTP ») pour qu'il ne soit jamais involontaire ;
//   · « ✕ » la RETIRE du secteur : elle redevient « non classée ». Ce n'est PAS une suppression —
//     ses métiers, ses services et les missions qui la citent restent intacts. Supprimer une
//     catégorie reste un geste distinct, dans l'arborescence plus bas, avec sa confirmation.
//
// Le composant n'écrit rien lui-même : il remonte l'intention (`onAssign`) à la page, qui porte
// déjà l'appel, l'affichage de l'erreur et le rechargement de la taxonomie.

export interface SecteurBoardCategorie {
  id: string;
  libelle: string;
  icon?: string;
  secteur?: string | null;
}

const COLUMN_TONE: Record<string, { head: string; chip: string }> = {
  digital: { head: "bg-[#E0F2FE] text-[#0369A1]", chip: "border-[#BAE6FD]" },
  btp: { head: "bg-[#FEF3C7] text-[#B45309]", chip: "border-[#FDE68A]" },
  services: { head: "bg-[#DCFCE7] text-[#15803D]", chip: "border-[#BBF7D0]" },
};

export default function SecteurBoard({
  categories,
  readOnly,
  onAssign,
}: {
  categories: SecteurBoardCategorie[];
  readOnly: boolean;
  onAssign: (categorie: SecteurBoardCategorie, secteur: string | null) => Promise<void>;
}) {
  // Catégorie choisie dans le menu « Ajouter » de chaque colonne.
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const unclassified = categories.filter((c) => !c.secteur);
  const labelOf = (value: string | null | undefined) => SECTEURS.find((s) => s.value === value)?.label;

  const run = async (key: string, categorie: SecteurBoardCategorie, secteur: string | null) => {
    setBusy(key);
    try {
      await onAssign(categorie, secteur);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[16px] font-semibold text-[#1A1916]">Secteurs de la marketplace</h3>
        <p className="text-[13px] text-[#5A5750]">
          Chaque catégorie appartient à un seul secteur. Retirer une catégorie d&apos;un secteur la remet en « non classée »
          — elle n&apos;est pas supprimée.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SECTEURS.map((s) => {
          const members = categories.filter((c) => c.secteur === s.value);
          // Les non classées d'abord : ce sont elles qui attendent un rangement.
          const candidates = categories
            .filter((c) => c.secteur !== s.value)
            .sort((a, b) => Number(Boolean(a.secteur)) - Number(Boolean(b.secteur)) || a.libelle.localeCompare(b.libelle, "fr"));
          const chosen = candidates.find((c) => c.id === pick[s.value]);
          const tone = COLUMN_TONE[s.value];

          return (
            <div key={s.value} className="rounded-[16px] border border-[#E2E0D9] bg-white shadow-sm overflow-hidden flex flex-col">
              <div className={`px-4 py-3 flex items-center justify-between ${tone.head}`}>
                <span className="text-[13px] font-bold uppercase tracking-wide">{s.label}</span>
                <span className="text-[12px] font-semibold">{members.length}</span>
              </div>
              <p className="px-4 pt-2 text-[11.5px] text-[#9C9A95]">{s.hint}</p>

              <ul className="px-3 py-2 space-y-1.5 flex-1 max-h-72 overflow-y-auto">
                {members.length === 0 && <li className="px-1 py-2 text-[12.5px] text-[#9C9A95]">Aucune catégorie.</li>}
                {members.map((c) => (
                  <li key={c.id} className={`flex items-center gap-2 rounded-[10px] border ${tone.chip} px-3 py-1.5 text-[13px] text-[#1A1916]`}>
                    <span className="flex-1 min-w-0 truncate">
                      {c.icon && <span className="mr-1.5">{c.icon}</span>}
                      {c.libelle}
                    </span>
                    {!readOnly && (
                      <button
                        onClick={() => run(`rm-${c.id}`, c, null)}
                        disabled={busy !== null}
                        className="text-[12px] text-[#9C9A95] hover:text-[#C0392B] disabled:opacity-40"
                        title={`Retirer « ${c.libelle} » du secteur ${s.label} (elle redevient non classée)`}
                        aria-label={`Retirer ${c.libelle} du secteur ${s.label}`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {!readOnly && (
                <div className="p-3 border-t border-[#E2E0D9] flex gap-2">
                  <select
                    value={pick[s.value] ?? ""}
                    onChange={(e) => setPick((p) => ({ ...p, [s.value]: e.target.value }))}
                    className="flex-1 min-w-0 rounded-[10px] border border-[#E2E0D9] bg-white px-2 py-2 text-[12px] text-[#1A1916] outline-none focus:border-[#2D5BE3]"
                    aria-label={`Catégorie à ajouter au secteur ${s.label}`}
                  >
                    <option value="">Ajouter une catégorie…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.libelle}
                        {c.secteur ? ` — actuellement ${labelOf(c.secteur)}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      if (!chosen) return;
                      await run(`add-${s.value}`, chosen, s.value);
                      setPick((p) => ({ ...p, [s.value]: "" }));
                    }}
                    disabled={!chosen || busy !== null}
                    className="rounded-[10px] bg-[#2D5BE3] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1F4DD4] disabled:opacity-50"
                  >
                    {busy === `add-${s.value}` ? "…" : "Ajouter"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unclassified.length > 0 && (
        <div className="rounded-[12px] border border-[#FED7AA] bg-[#FFF7ED] px-4 py-3">
          <div className="text-[13px] font-semibold text-[#9A3412]">
            {unclassified.length} catégorie(s) non classée(s) — elles n&apos;apparaissent sous aucun secteur
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unclassified.map((c) => (
              <span key={c.id} className="inline-flex items-center rounded-full border border-[#FED7AA] bg-white px-2.5 py-0.5 text-[12px] text-[#9A3412]">
                {c.icon && <span className="mr-1">{c.icon}</span>}
                {c.libelle}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
