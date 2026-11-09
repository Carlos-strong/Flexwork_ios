"use client";

// Responsable chantier d'une mission en vérification OPR (2026-10-01) — carte du CLIENT.
//
// Une seule carte pour tous les contrats (jalons, tâches, relevés au temps) : la désignation vit
// sur le contrat, pas sur le mode de rémunération. Elle rappelle la règle qui compte au bon
// moment — sans responsable, le séquestre ne peut pas être financé et rien ne se vérifie — et
// prévient qu'un remplacement est tracé au contrat et notifié au prestataire.
//
// Ne rend rien en mode « Moi-même » ni pour un autre lecteur que le client : la route répond 404
// aux autres, et `validationMode: "client"` en « Moi-même ».

import { useCallback, useEffect, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";

type Manager = { id: string; name: string } | null;

const ERRORS: Record<string, string> = {
  user_not_found: "Aucun compte actif ne correspond à cet e-mail ou téléphone.",
  not_a_site_manager: "Ce compte n'est pas un compte « Responsable chantier ». La personne doit s'inscrire avec ce profil.",
  invalid_site_manager: "Ni vous-même ni le prestataire ne pouvez être désignés responsable chantier.",
  identifier_required: "Indiquez l'e-mail ou le téléphone du responsable.",
};

export function SiteManagerCard({ missionId, className = "" }: { missionId: string; className?: string }) {
  const [mode, setMode] = useState<"client" | "opr" | null>(null);
  const [manager, setManager] = useState<Manager>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDedupe(`/api/missions/${missionId}/site-manager`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setMode(d?.validationMode ?? null);
        setManager(d?.siteManager ?? null);
      })
      .catch(() => setMode(null));
  }, [missionId]);

  useEffect(load, [load]);

  async function designer(identifier: string | null) {
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await fetch(`/api/missions/${missionId}/site-manager`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: identifier === null ? null : identifier.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(ERRORS[body.error] ?? "La désignation n'a pas pu être enregistrée.");
      return;
    }
    setManager(body.siteManager ?? null);
    setInput("");
    setNotice(
      identifier === null
        ? "Responsable retiré. Désignez-en un autre : rien ne peut être vérifié sans lui."
        : "Responsable désigné. La désignation est inscrite au contrat et le prestataire en est informé."
    );
  }

  if (mode !== "opr") return null;

  return (
    <div className={`bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-[13px] font-semibold">Responsable chantier (OPR)</h2>
          <p className="text-[12px] text-[#64748B] mt-0.5">
            Il vérifie les relevés, preuves et jalons, puis vous les transmet. Vous gardez la validation définitive.
          </p>
        </div>
        {manager && (
          <span className="text-[12.5px] text-[#0f172a]">
            <strong>{manager.name}</strong>
          </span>
        )}
      </div>

      {!manager && (
        <div className="mt-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E] leading-relaxed">
          <strong>Aucun responsable désigné.</strong> Le séquestre ne peut pas être financé et aucune vérification ne
          peut avoir lieu tant qu&apos;il n&apos;est pas désigné.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          designer(input);
        }}
        className="flex gap-2 mt-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={manager ? "Remplacer : e-mail ou téléphone" : "E-mail ou téléphone du responsable"}
          className="flex-1 h-9 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="h-9 px-3.5 rounded-lg bg-[#0f172a] text-white text-[12.5px] font-semibold hover:bg-black disabled:opacity-50"
        >
          {manager ? "Remplacer" : "Désigner"}
        </button>
        {manager && (
          <button
            type="button"
            onClick={() => designer(null)}
            disabled={busy}
            className="h-9 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50"
          >
            Retirer
          </button>
        )}
      </form>
      {manager && (
        <p className="mt-2 text-[11px] text-[#94A3B8]">
          Un remplacement est inscrit au journal du contrat et notifié au prestataire.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-[#B91C1C]">{error}</p>}
      {notice && <p className="mt-2 text-[12px] text-[#00623A]">{notice}</p>}
    </div>
  );
}
