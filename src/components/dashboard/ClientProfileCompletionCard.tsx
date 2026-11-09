"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Carte de complétion du profil client — écran S5 des wireframes.
//
// Le pourcentage vient du serveur (GET /api/profile/client → src/lib/client-profile-
// completion.ts). Il n'est pas recalculé ici : la page /profile/client affiche le même
// barème, et deux calculs parallèles finiraient par diverger.
//
// La carte disparaît d'elle-même à 100 % : une fois le profil complet, elle n'a plus rien à
// dire et ne doit pas occuper le haut du tableau de bord indéfiniment.

const DISMISS_KEY = "flexwork.client-profile-card.dismissed";

type Completion = { percent: number; missing: { key: string; label: string }[] };

export function ClientProfileCompletionCard() {
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [dismissed, setDismissed] = useState(true); // masqué tant qu'on n'a rien chargé

  useEffect(() => {
    // sessionStorage peut lever (navigation privée, cookies bloqués) : un refus de lecture
    // ne doit pas empêcher la carte de s'afficher.
    let alreadyDismissed = false;
    try {
      alreadyDismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      alreadyDismissed = false;
    }
    setDismissed(alreadyDismissed);

    fetch("/api/profile/client")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCompletion(d?.completion ?? null))
      .catch(() => setCompletion(null));
  }, []);

  function handleDismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Pas de stockage disponible : la carte réapparaîtra au prochain chargement, ce qui
      // reste préférable à une erreur.
    }
  }

  if (!completion || dismissed || completion.percent >= 100) return null;

  return (
    <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden mb-6">
      <div className="px-5 py-5">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-semibold text-[15px] text-[#0A1931]">Profil complété</h3>
          <span className="text-[15px] font-bold text-[#008751]">{completion.percent} %</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full bg-[#008751] transition-all" style={{ width: `${completion.percent}%` }} />
        </div>
        <p className="mt-3 text-[12px] text-zinc-500">
          {completion.missing.length > 0
            ? `Il reste à renseigner : ${completion.missing.map((m) => m.label.toLowerCase()).join(", ")}.`
            : "Complétez votre profil pour des recommandations plus pertinentes."}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Link
            href="/profile/client"
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
