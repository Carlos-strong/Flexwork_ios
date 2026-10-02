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
//   - la carte ne disparaît PAS à 100 %. Contrairement au client, un profil prestataire
//     complet reste la porte d'entrée vers le badge et le compte de versement, deux choses
//     qui ne comptent pas dans le pourcentage mais qui décident d'être payé. Elle se replie
//     plutôt en une ligne discrète.

const DISMISS_KEY = "flexwork.provider-profile-card.dismissed";

type Completion = {
  percent: number;
  done: number;
  total: number;
  sections: { key: string; label: string; weight: number; done: boolean }[];
  missing: string[];
};

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

  if (!completion || dismissed) return null;

  const complete = completion.percent >= 100;

  return (
    <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden mb-6">
      <div className="px-5 py-5">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-semibold text-[15px] text-[#0A1931]">
            {complete ? "Profil prestataire complet" : "Profil prestataire"}
          </h3>
          <span className="text-[15px] font-bold text-[#008751]">{completion.percent} %</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full bg-[#008751] transition-all" style={{ width: `${completion.percent}%` }} />
        </div>

        {!complete && (
          <>
            <p className="mt-3 text-[12px] font-medium text-zinc-400 uppercase tracking-wider">Répartition</p>
            <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {completion.sections.map((section) => (
                <li key={section.key} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="flex items-center gap-2 text-zinc-600">
                    <span aria-hidden>{section.done ? "✅" : "⬜"}</span>
                    {section.label}
                  </span>
                  <span className={section.done ? "font-semibold text-[#008751]" : "text-zinc-400"}>{section.weight} %</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-zinc-500">
              {completion.missing.length > 0
                ? `Il reste à renseigner : ${completion.missing.slice(0, 4).map((m) => m.toLowerCase()).join(", ")}${
                    completion.missing.length > 4 ? "…" : "."
                  }`
                : "Complétez votre profil pour recevoir des missions pertinentes."}
            </p>
          </>
        )}

        {/* Le rappel qui reste même à 100 % : ni le badge ni le compte de versement ne
            comptent dans le pourcentage, mais sans eux on n'est pas payé. */}
        {complete && (
          <p className="mt-3 text-[12px] text-zinc-500">
            Il vous reste le badge « Vérifié » et votre compte de versement Mobile Money — deux étapes hors pourcentage,
            mais nécessaires pour être payé.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={complete ? "/badge" : "/profile"}
            className="h-9 px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold flex items-center hover:brightness-110"
            style={{ textDecoration: "none" }}
          >
            {complete ? "Voir mon badge" : "Compléter mon profil"}
          </Link>
          <Link
            href="/kyc/financier"
            className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 flex items-center hover:bg-gray-50"
            style={{ textDecoration: "none" }}
          >
            Compte de versement
          </Link>
          {!complete && (
            <button
              type="button"
              onClick={handleDismiss}
              className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50"
            >
              Plus tard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
