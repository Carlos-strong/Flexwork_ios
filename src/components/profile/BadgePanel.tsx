"use client";

// Écran P7 — Badge « Vérifié ».
//
// ── Ce que cet écran répare ─────────────────────────────────────────────────────────────
//
// La demande partait bien (POST /api/declarations/badge), mais AUCUN code n'écrivait jamais
// `accorde` ni `refuse` : la demande restait « en attente » indéfiniment, une seconde demande
// était refusée pour cause de demande en cours, et l'utilisateur n'avait aucun écran pour
// savoir où en était son dossier. Une impasse définitive présentée comme un état transitoire.
//
// L'instruction existe désormais côté Admin KYC (POST /api/admin/kyc/badges/[userId]/decision),
// et cet écran affiche la décision — accordée, refusée avec son motif, ou en instruction.
//
// ── Ce que le badge n'est pas ───────────────────────────────────────────────────────────
//
// Il n'ouvre ni mission ni paiement. Il dit qu'un diplôme d'État déclaré a été regardé par
// quelqu'un : c'est tout, et c'est déjà beaucoup.

import { useEffect, useState } from "react";
import Link from "next/link";

type BadgeState = {
  badgeStatus: "non_demande" | "en_attente" | "accorde" | "refuse";
  badgeRequestedAt?: string | null;
  badgeDecidedAt?: string | null;
  badgeRefusalReason?: string | null;
  eligible?: boolean;
};

const STATUS_DISPLAY: Record<string, { label: string; className: string; icon: string }> = {
  non_demande: { label: "Non demandé", className: "bg-zinc-100 text-zinc-600", icon: "—" },
  en_attente: { label: "En attente d'instruction", className: "bg-amber-100 text-amber-800", icon: "⏳" },
  accorde: { label: "Badge accordé", className: "bg-[#008751]/10 text-[#008751]", icon: "✅" },
  refuse: { label: "Demande refusée", className: "bg-red-100 text-red-700", icon: "✕" },
};

const BENEFITS = [
  "Crédibilité renforcée auprès des clients",
  "Mise en avant dans les résultats de recherche",
  "Accès aux missions signalées comme premium",
];

const BADGE_ERRORS: Record<string, string> = {
  unauthenticated: "Votre session a expiré — reconnectez-vous.",
  profile_required: "Complétez d'abord votre profil prestataire (onglet Domaines).",
  badge_already_requested: "Votre demande est déjà en cours d'instruction.",
  badge_already_granted: "Votre badge est déjà accordé.",
  state_diploma_required:
    "Le badge exige au moins un diplôme d'État déclaré. Ajoutez-le dans vos déclarations, puis renouvelez la demande.",
};

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function BadgePanel() {
  const [state, setState] = useState<BadgeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function load() {
    const res = await fetch("/api/declarations/badge");
    setState(res.ok ? ((await res.json()) as BadgeState) : { badgeStatus: "non_demande" });
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function requestBadge() {
    setSubmitting(true);
    setMsg(null);
    const res = await fetch("/api/declarations/badge", { method: "POST" });
    setSubmitting(false);
    if (res.ok) {
      await load();
      setMsg({ text: "Demande enregistrée. Un administrateur KYC va instruire votre diplôme d'État.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({ text: BADGE_ERRORS[data.error] ?? data.message ?? "Échec de la demande.", ok: false });
  }

  if (loading) {
    return <div className="rounded-[20px] border border-gray-100 bg-white p-6 text-[13px] text-zinc-500">Chargement...</div>;
  }

  const status = state?.badgeStatus ?? "non_demande";
  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.non_demande;
  const canRequest = (status === "non_demande" || status === "refuse") && state?.eligible !== false;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-[20px] border border-gray-100 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[#0A1931]">Statut du badge</h2>
          <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${display.className}`}>
            {display.icon} {display.label}
          </span>
        </div>

        <dl className="mt-4 grid sm:grid-cols-2 gap-3 text-[12px]">
          <div>
            <dt className="text-zinc-400">Demande déposée le</dt>
            <dd className="text-[#0A1931]">{formatDate(state?.badgeRequestedAt)}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Décision rendue le</dt>
            <dd className="text-[#0A1931]">{formatDate(state?.badgeDecidedAt)}</dd>
          </div>
        </dl>

        {status === "refuse" && state?.badgeRefusalReason && (
          <p className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[12px] text-red-700">
            Motif du refus : {state.badgeRefusalReason}
          </p>
        )}

        {status === "en_attente" && (
          <p className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-800">
            Un administrateur KYC instruit votre demande. Elle porte sur votre diplôme d&apos;État déclaré — vous n&apos;avez
            rien d&apos;autre à faire.
          </p>
        )}

        {status === "accorde" && (
          <p className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[12px] text-emerald-800">
            Votre badge apparaît sur votre profil public et sur vos candidatures.
          </p>
        )}

        {status !== "en_attente" && status !== "accorde" && state?.eligible === false && (
          <p className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-800">
            Il manque un <span className="font-semibold">diplôme d&apos;État</span> déclaré pour que votre demande soit
            recevable — c&apos;est le pivot du badge : un diplôme purement déclaratif ne vaut que ce que son auteur en dit.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {canRequest && (
            <button
              type="button"
              onClick={requestBadge}
              disabled={submitting || state?.eligible === false}
              className="h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition disabled:opacity-50"
            >
              {submitting ? "Envoi..." : status === "refuse" ? "Renouveler ma demande" : "Demander le badge"}
            </button>
          )}
          <Link
            href="/declarations#qualifications"
            className="h-10 px-5 rounded-full bg-white border border-zinc-200 text-[13px] font-medium text-zinc-600 flex items-center hover:bg-zinc-50"
            style={{ textDecoration: "none" }}
          >
            Voir mes déclarations
          </Link>
        </div>
        {msg && (
          <p className={`mt-3 rounded-xl px-4 py-3 text-[12px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="bg-white rounded-[20px] border border-gray-100 p-6">
        <h2 className="text-[15px] font-semibold text-[#0A1931]">Ce que le badge apporte</h2>
        <ul className="mt-3 space-y-2">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-[13px] text-zinc-600">
              <span className="mt-0.5 text-[#008751]">•</span>
              {benefit}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-[12px] text-zinc-500">
          Le badge ne remplace pas la vérification d&apos;identité, et il ne conditionne ni les missions ni les
          paiements : seul le KYC décide de ce à quoi vous avez accès.
        </p>
      </div>
    </div>
  );
}
