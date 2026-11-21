"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Send, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { refreshBadges } from "@/lib/badge-sync";

// Candidatures en attente de la vérification d'identité (2026-11-09) — pendant prestataire
// de PendingPublicationsCard (missions du client).
//
// Un prestataire non vérifié qui envoie une candidature la retrouve ici, enregistrée
// (src/lib/proposal-drafts.ts). Il ne la valide qu'une fois : à la validation de son KYC, elle
// part d'elle-même au client (sendPendingApplications). D'ici là, il peut la modifier ou la
// supprimer. Ne restent ici, une fois vérifié, que les envois automatiques refusés (garant
// manquant, mission fermée…), avec leur raison : corriger, puis « Envoyer » à nouveau.
// La carte n'apparaît que s'il y a au moins une candidature en attente.

type Draft = {
  id: string;
  kind: "proposal" | "devis";
  payload: Record<string, unknown>;
  lastError: string | null;
  updatedAt: string;
  endpoint: string;
  missionOpen: boolean;
  mission: { id: string; titre: string; currency: string };
};
type State = { kycVerified: boolean; kycStatus: string | null; items: Draft[] };

const SEND_ERRORS: Record<string, string> = {
  kyc_not_verified: "Votre identité n'est pas encore vérifiée.",
  already_applied: "Vous avez déjà candidaté à cette mission.",
  mission_not_open: "Cette mission n'est plus ouverte aux candidatures.",
  mission_expired: "Cette mission a expiré.",
  self_dealing_forbidden: "Vous ne pouvez pas candidater à votre propre mission.",
};

/** Le formulaire de la candidature, pré-rempli avec le brouillon. */
function editHref(d: Draft): string {
  return d.kind === "devis" ? `/missions/${d.mission.id}/devis` : `/missions/${d.mission.id}?candidater=1`;
}

function summary(d: Draft): string {
  if (d.kind === "devis") {
    const lines = Array.isArray(d.payload.lineItems) ? d.payload.lineItems.length : 0;
    return `Devis détaillé · ${lines} ligne${lines > 1 ? "s" : ""}`;
  }
  const montant = typeof d.payload.montant === "number" ? d.payload.montant : 0;
  return `Candidature · ${montant.toLocaleString("fr-FR")} ${d.mission.currency}`;
}

export function PendingApplicationsCard() {
  const [state, setState] = useState<State | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string; profileHref?: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/proposal-drafts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: State | null) => d && setState(d))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function send(d: Draft) {
    setRowError(null);
    setSent(null);
    setSending(d.id);
    let res: Response;
    try {
      res = await fetch(d.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d.payload) });
    } catch {
      setSending(null);
      setRowError({ id: d.id, text: "Connexion au serveur impossible. Réessayez." });
      return;
    }
    setSending(null);
    if (res.ok) {
      setSent(d.mission.titre);
      refreshBadges();
      load();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    // Profil incomplet (garant, assurance) : l'action est sur le profil, avec retour ici.
    const profileHref =
      data.error === "garant_required" || data.error === "insurance_required"
        ? `/profile?tab=experience&returnTo=${encodeURIComponent(d.kind === "devis" ? `/missions/${d.mission.id}/devis` : `/missions/${d.mission.id}`)}`
        : undefined;
    setRowError({ id: d.id, text: data.message ?? SEND_ERRORS[data.error ?? ""] ?? "Échec de l'envoi.", profileHref });
  }

  async function remove(d: Draft) {
    if (!window.confirm(`Supprimer la candidature en brouillon pour « ${d.mission.titre} » ?`)) return;
    const res = await fetch(`/api/proposal-drafts/${d.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) load();
  }

  if (!state || (state.items.length === 0 && !sent)) return null;
  const verified = state.kycVerified;

  return (
    <section aria-labelledby="pending-applications-title" className="bg-white rounded-[20px] border border-gray-100 overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
        {verified ? <ShieldCheck aria-hidden className="w-4 h-4 text-[#047857]" /> : <ShieldAlert aria-hidden className="w-4 h-4 text-amber-600" />}
        <h3 id="pending-applications-title" className="font-semibold text-[15px] text-[#191224]">
          {verified ? "Candidatures à reprendre" : "Candidatures en attente d'envoi"}
        </h3>
      </div>

      <div className="px-5 pt-4">
        {verified ? (
          // Seulement s'il reste quelque chose à corriger : une mission fermée n'a rien à reprendre.
          state.items.some((d) => d.missionOpen) && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              Votre identité est vérifiée, mais ces candidatures n&apos;ont pas pu partir automatiquement. Corrigez ce qui est
              indiqué, puis envoyez-les.
            </p>
          )
        ) : (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            {state.kycStatus === "rejete"
              ? "Votre vérification d'identité a été refusée : renvoyez vos justificatifs. Vos candidatures partiront automatiquement dès sa validation."
              : state.kycStatus === "en_attente"
                ? "Votre vérification d'identité est en cours d'examen. Vos candidatures partiront automatiquement au client dès sa validation ; vous pouvez les modifier d'ici là."
                : "Vérifiez votre identité : vos candidatures partiront automatiquement au client dès sa validation. Vous pouvez les modifier d'ici là."}{" "}
            <Link href="/kyc" className="font-semibold underline">
              {state.kycStatus === "en_attente" ? "Voir ma vérification" : "Vérifier mon identité"}
            </Link>
          </p>
        )}
        {sent && (
          <p role="status" className="mt-3 text-[13px] font-medium text-emerald-700">
            Candidature envoyée : « {sent} ».
          </p>
        )}
      </div>

      <ul className="divide-y divide-gray-50 mt-2">
        {state.items.map((d) => (
          <li key={d.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={editHref(d)} className="text-[13.5px] font-medium text-[#191224] hover:underline">
                  {d.mission.titre}
                </Link>
                <p className="text-[12px] text-zinc-500">
                  {summary(d)} · enregistrée le {new Date(d.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                </p>
                {!d.missionOpen ? (
                  <p className="mt-1 text-[12px] text-red-600">
                    Cette mission n&apos;est plus ouverte : la candidature ne peut plus partir. Vous pouvez la supprimer.
                  </p>
                ) : (
                  d.lastError && <p className="mt-1 text-[12px] text-red-600">Envoi refusé : {d.lastError}.</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.missionOpen && (
                  <Link
                    href={editHref(d)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-4 text-[12.5px] font-medium text-[#191224] hover:bg-gray-50"
                  >
                    <Pencil aria-hidden className="w-3.5 h-3.5" />
                    Modifier
                  </Link>
                )}
                {/* Envoi manuel : seulement pour reprendre un envoi automatique refusé. */}
                {verified && d.missionOpen && (
                  <button
                    type="button"
                    onClick={() => void send(d)}
                    disabled={sending === d.id}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#4C1D95] px-4 text-[12.5px] font-semibold text-white hover:bg-[#3B1578] disabled:opacity-40"
                  >
                    <Send aria-hidden className="w-3.5 h-3.5" />
                    {sending === d.id ? "Envoi…" : "Envoyer"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(d)}
                  aria-label={`Supprimer la candidature en brouillon pour « ${d.mission.titre} »`}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-zinc-500 hover:bg-gray-50"
                >
                  <Trash2 aria-hidden className="w-4 h-4" />
                </button>
              </div>
            </div>
            {rowError?.id === d.id && (
              <p role="alert" className="mt-2 text-[12.5px] text-red-600">
                {rowError.text}
                {rowError.profileHref && (
                  <>
                    {" "}
                    <Link href={rowError.profileHref} className="font-semibold underline">
                      Compléter mon profil
                    </Link>
                  </>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
