"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ── P4 — Choix de l'usage (2026-09-23) ────────────────────────────────────────────────────
//
// Dernier écran de l'inscription, après la vérification du code. Il matérialise la décision
// « Option C » : le compte vient de s'ouvrir en CLIENT (le formulaire ne demande plus aucun
// rôle), et c'est ICI — une fois le compte vérifié, jamais avant — que l'usage se déclare.
//
// Pourquoi trois cartes et pas un sélecteur de rôle à l'inscription :
//   - « client » n'est pas un choix, c'est l'état par défaut : la carte le dit (« Défaut »)
//     au lieu de le faire deviner ;
//   - « les deux » est le cas normal d'un artisan qui achète aussi des fournitures — il ne
//     doit pas avoir à créer un second compte ;
//   - un seul compte, jamais deux : c'est la règle « single account » du modèle.
//
// ⚠️ Choisir « prestataire » ou « les deux » ne renseigne PAS le rôle : il faut encore la
// filière (expert digital, artisan, manœuvre…), qui est une décision métier portée par
// /devenir-prestataire. Cet écran déclare l'intention, l'écran suivant la qualifie. Les deux
// sont donc enchaînés — pas fusionnés — et « plus tard » reste possible à tout moment depuis
// le tableau de bord.

type Usage = "client" | "provider" | "both";

const USAGES: { id: Usage; badge: string; title: string; sub: string; desc: string }[] = [
  {
    id: "client",
    badge: "Défaut",
    title: "Je cherche un prestataire",
    sub: "→ Client",
    desc: "Publiez une mission : les fonds sont séquestrés jusqu'au travail validé.",
  },
  {
    id: "provider",
    badge: "Recommandé",
    title: "Je propose mes services",
    sub: "→ Prestataire",
    desc: "Ouvrez votre espace prestataire et complétez votre profil à votre rythme.",
  },
  {
    id: "both",
    badge: "Flex",
    title: "Les deux",
    sub: "→ Double espace",
    desc: "Basculez entre l'espace client et l'espace prestataire selon la mission.",
  },
];

export default function BienvenuePage() {
  const router = useRouter();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [leaving, setLeaving] = useState(false);

  function continueTo(_usage: Usage) {
    setLeaving(true);
    // « client » mène directement au tableau de bord : rien à activer, c'est déjà l'état du
    // compte. Les deux autres passent par la qualification de la filière.
    router.push(usage === "client" ? "/client/dashboard" : "/devenir-prestataire");
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-[820px] bg-white border border-[#E2E8F0] rounded-xl p-6 md:p-8">
        <h1 className="text-[22px] font-bold text-[#0f172a]">Bienvenue sur FlexWork 👋</h1>
        <p className="mt-1 text-[13px] text-slate-600">
          Comment souhaitez-vous utiliser la plateforme ? Votre compte s&apos;ouvre en client — vous pouvez
          ouvrir l&apos;espace prestataire à tout moment, sans créer de second compte.
        </p>

        <div className="mt-6 grid md:grid-cols-3 gap-3" role="radiogroup" aria-label="Choix de l'usage">
          {USAGES.map((u) => {
            const selected = usage === u.id;
            return (
              <button
                key={u.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setUsage(u.id)}
                className={`text-left rounded-xl border p-4 transition ${
                  selected
                    ? "border-[#008751] bg-[#E6F4EE]/50 ring-2 ring-[#008751]/20"
                    : "border-[#E2E8F0] bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[#0f172a]">{u.sub}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0f172a] text-white">{u.badge}</span>
                </div>
                <div className="mt-2 text-[14px] font-semibold text-[#0f172a]">{u.title}</div>
                <div className="mt-1 text-[11px] text-slate-600">{u.desc}</div>
                {selected && (
                  <div className="mt-3 text-[11px] font-medium text-[#008751]">
                    ✓ Sélectionné — modifiable dans Paramètres
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] p-4 text-[11px] leading-5 text-slate-600">
          <span className="font-semibold text-[#0f172a]">Vous pourrez changer à tout moment.</span> Un seul compte,
          jamais deux : votre espace client et votre espace prestataire vivent sur la même identité vérifiée.
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Link href="/client/dashboard" className="h-11 px-4 inline-flex items-center rounded-xl border border-[#E2E8F0] text-sm text-slate-700 hover:bg-slate-50">
            Plus tard
          </Link>
          <button
            type="button"
            disabled={!usage || leaving}
            onClick={() => continueTo(usage!)}
            className="h-11 px-6 rounded-xl bg-[#008751] text-white text-sm font-semibold hover:bg-[#006e42] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {leaving ? "Un instant…" : "Continuer"}
          </button>
        </div>
      </div>
    </div>
  );
}
