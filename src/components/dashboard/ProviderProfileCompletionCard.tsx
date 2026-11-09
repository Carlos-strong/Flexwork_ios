"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Carte de complétion du profil prestataire — écran P5.
//
// Le pourcentage vient du SERVEUR (`GET /api/profile/completion` →
// src/lib/provider-profile-completion.ts). Il n'est pas recalculé ici : le formulaire
// /profile affiche le même barème, et deux calculs parallèles finiraient par diverger.
//
// Pendant exact de `ClientProfileCompletionCard`, à deux différences près, qui viennent du
// barème lui-même :
//
//   - la « Répartition » est affichée section par section (20 / 30 / 20 / 15 / 15), parce
//     qu'une section vaut son poids entier ou rien : la liste dit d'un coup d'œil ce qui est
//     acquis, ce qu'un simple « 40 % » ne dit pas ;
//   - à 100 % (2026-11-08), la carte « Profil prestataire complet » disparaît : elle ne
//     disait plus rien d'utile. Elle laisse place à une NOTIFICATION qui ne donne que le
//     statut du badge « Vérifié ». Le compte de versement, lui, se vérifie depuis le Wallet
//     (WalletSection), là où l'on regarde ce qu'on doit recevoir.

const DISMISS_KEY = "flexwork.provider-profile-card.dismissed";

type Completion = {
  percent: number;
  done: number;
  total: number;
  sections: { key: string; label: string; weight: number; done: boolean }[];
  missing: string[];
};

type BadgeStatus = "non_demande" | "en_attente" | "accorde" | "refuse";

const BADGE_NOTICE: Record<
  BadgeStatus,
  { title: string; text: string; cta: string; tone: string; dot: string }
> = {
  non_demande: {
    title: "Badge « Vérifié » : non demandé",
    text: "Votre profil est complet : vous pouvez demander le badge.",
    cta: "Demander le badge",
    tone: "border-zinc-200 bg-white",
    dot: "bg-zinc-400",
  },
  en_attente: {
    title: "Badge « Vérifié » : en cours d'instruction",
    text: "Un administrateur examine votre demande.",
    cta: "Suivre ma demande",
    tone: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
  },
  accorde: {
    title: "Badge « Vérifié » : accordé",
    text: "Le badge s'affiche sur votre profil public.",
    cta: "Voir mon badge",
    tone: "border-emerald-200 bg-emerald-50",
    dot: "bg-[#008751]",
  },
  refuse: {
    title: "Badge « Vérifié » : demande refusée",
    text: "Consultez le motif, puis renouvelez votre demande.",
    cta: "Voir le motif",
    tone: "border-red-200 bg-red-50",
    dot: "bg-red-500",
  },
};

/** Profil à 100 % : seule reste cette notification, qui donne le statut du badge. */
function BadgeStatusNotice() {
  const [status, setStatus] = useState<BadgeStatus | null>(null);
  useEffect(() => {
    fetch("/api/declarations/badge")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setStatus(
          d?.badgeStatus && d.badgeStatus in BADGE_NOTICE
            ? (d.badgeStatus as BadgeStatus)
            : null,
        ),
      )
      .catch(() => setStatus(null));
  }, []);
  if (!status) return null;
  const n = BADGE_NOTICE[status];
  return (
    <div
      role="status"
      className={`mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-[16px] border px-4 py-3 ${n.tone}`}
    >
      <div className="flex flex-1 items-start gap-2.5 min-w-0">
        <span
          aria-hidden
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.dot}`}
        />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#0A1931]">{n.title}</p>
          <p className="text-[12px] text-zinc-600">{n.text}</p>
        </div>
      </div>
      <Link
        href="/badge"
        className="h-9 px-4 shrink-0 self-start sm:self-auto rounded-full bg-white border border-gray-200 text-[13px] font-medium text-[#0A1931] flex items-center hover:bg-gray-50"
        style={{ textDecoration: "none" }}
      >
        {n.cta}
      </Link>
    </div>
  );
}

export function ProviderProfileCompletionCard() {
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [dismissed, setDismissed] = useState(true); // masqué tant qu'on n'a rien chargé

  useEffect(() => {
    // sessionStorage peut lever (navigation privée, stockage bloqué) : un refus de lecture ne
    // doit pas empêcher la carte de s'afficher.
    let alreadyDismissed = false;
    try {
      alreadyDismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      alreadyDismissed = false;
    }
    setDismissed(alreadyDismissed);

    fetch("/api/profile/completion")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCompletion(d ?? null))
      .catch(() => setCompletion(null));
  }, []);

  function handleDismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Pas de stockage : la carte réapparaîtra au prochain chargement, ce qui reste
      // préférable à une erreur.
    }
  }

  if (!completion) return null;
  // Profil complet : plus de carte de complétion, seulement le statut du badge.
  if (completion.percent >= 100) return <BadgeStatusNotice />;
  if (dismissed) return null;

  return (
    <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden mb-6">
      <div className="px-5 py-5">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-semibold text-[15px] text-[#0A1931]">
            Profil prestataire
          </h3>
          <span className="text-[15px] font-bold text-[#008751]">
            {completion.percent} %
          </span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#008751] transition-all"
            style={{ width: `${completion.percent}%` }}
          />
        </div>

        <>
          <p className="mt-3 text-[12px] font-medium text-zinc-400 uppercase tracking-wider">
            Répartition
          </p>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {completion.sections.map((section) => (
              <li
                key={section.key}
                className="flex items-center justify-between gap-2 text-[12px]"
              >
                <span className="flex items-center gap-2 text-zinc-600">
                  <span aria-hidden>{section.done ? "✅" : "⬜"}</span>
                  {section.label}
                </span>
                <span
                  className={
                    section.done
                      ? "font-semibold text-[#008751]"
                      : "text-zinc-400"
                  }
                >
                  {section.weight} %
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-zinc-500">
            {completion.missing.length > 0
              ? `Il reste à renseigner : ${completion.missing
                  .slice(0, 4)
                  .map((m) => m.toLowerCase())
                  .join(", ")}${completion.missing.length > 4 ? "…" : "."}`
              : "Complétez votre profil pour recevoir des missions pertinentes."}
          </p>
        </>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/profile"
            className="h-9 px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold flex items-center hover:brightness-110"
            style={{ textDecoration: "none" }}
          >
            Compléter mon profil
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
