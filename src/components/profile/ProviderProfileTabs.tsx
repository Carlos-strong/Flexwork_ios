"use client";

// Profil professionnel prestataire en 5 ONGLETS (2026-09-23).
//
// ── Ce que remplace ce shell ────────────────────────────────────────────────────────────
//
// L'ancien formulaire prestataire tenait sur une page unique de sept cents lignes, avec quatre
// cartes et un seul bouton « Enregistrer » en bas : il fallait faire défiler tout le profil
// pour changer un tarif, et une erreur de validation dans la première carte bloquait
// l'enregistrement des quatre. Cinq onglets, cinq enregistrements indépendants — l'un échoue,
// les autres sont déjà enregistrés.
//
// ── Ce que le pourcentage est, et n'est pas ─────────────────────────────────────────────
//
// Il vient du SERVEUR (`GET /api/profile/completion`), jamais d'un calcul local : deux barèmes
// divergeraient à la première évolution. Il est INFORMATIF — il ne débloque rien et ne bloque
// rien (modele-skillafrica-v3 §9 : seul le KYC conditionne des actions précises). Un
// prestataire à 40 % peut candidater dès que son identité est vérifiée.
//
// Une section vaut son poids ENTIER ou rien (20 / 30 / 20 / 15 / 15) : c'est la « Répartition »
// du tableau de bord, où l'on lit d'un coup d'œil ce qui est acquis et ce qui reste.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProviderIdentity, ProviderProfile } from "@/components/profile/profile-shared";
import { PresentationTab } from "@/components/profile/tabs/PresentationTab";
import { DomainesTab } from "@/components/profile/tabs/DomainesTab";
import { ExperienceTab } from "@/components/profile/tabs/ExperienceTab";
import { LocalisationTab } from "@/components/profile/tabs/LocalisationTab";
import { ConfigurationTab } from "@/components/profile/tabs/ConfigurationTab";

type CompletionSection = {
  key: string;
  label: string;
  weight: number;
  done: boolean;
  items: { key: string; label: string; done: boolean }[];
};

type Completion = {
  percent: number;
  done: number;
  total: number;
  sections: CompletionSection[];
  missing: string[];
  hasProfile: boolean;
};

type TabKey = "presentation" | "domaines" | "experience" | "localisation" | "configuration";

// Les clés sont celles des sections du barème : l'onglet, la barre de progression et le
// pourcentage parlent ainsi de la même chose, sans table de correspondance.
const TABS: { key: TabKey; label: string }[] = [
  { key: "presentation", label: "Présentation" },
  { key: "domaines", label: "Domaines" },
  { key: "experience", label: "Expérience" },
  { key: "localisation", label: "Localisation" },
  { key: "configuration", label: "Configuration" },
];

function isTabKey(value: string | null): value is TabKey {
  return !!value && TABS.some((t) => t.key === value);
}

export default function ProviderProfileTabs({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab ?? null) ? (initialTab as TabKey) : "presentation");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [identity, setIdentity] = useState<ProviderIdentity | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadCompletion = useCallback(async () => {
    const res = await fetch("/api/profile/completion");
    if (res.ok) setCompletion(await res.json());
  }, []);

  // Enregistrer un onglet change le barème : le pourcentage et la coche de l'onglet doivent
  // suivre DANS le même geste (2026-09-24).
  //
  // Trois onglets sur cinq ne le faisaient pas — Présentation, Localisation et Configuration
  // se contentaient de remplacer le profil. Le prestataire remplissait une section entière,
  // lisait « enregistré », et voyait le pourcentage ne pas bouger : le seul retour visible
  // restait la coche de l'onglet… qui ne se mettait pas à jour non plus, puisque c'est le
  // barème qui la porte. Il fallait recharger la page pour voir le progrès — sur un écran dont
  // le pourcentage est précisément ce qui motive à continuer.
  const handleSaved = useCallback(
    (p: ProviderProfile) => {
      setProfile(p);
      void loadCompletion();
    },
    [loadCompletion],
  );

  useEffect(() => {
    Promise.all([
      // 404 = pas encore de profil. Ce n'est pas une erreur : un compte fraîchement promu
      // prestataire n'a rien enregistré, et l'onglet Présentation doit pouvoir s'ouvrir.
      fetch("/api/profile").then(async (r) => (r.ok ? ((await r.json()) as ProviderProfile) : null)),
      fetch("/api/users/me").then(async (r) => (r.ok ? ((await r.json()) as ProviderIdentity) : null)),
    ])
      .then(([p, i]) => {
        setProfile(p);
        setNotFound(!p);
        setIdentity(i);
      })
      .finally(() => setLoading(false));
    void loadCompletion();
  }, [loadCompletion]);

  // L'onglet actif est reflété dans l'URL : sans ça, un rechargement ramènerait toujours à
  // « Présentation », et un lien vers l'onglet Domaines serait impossible à partager.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }, [tab]);

  const activeSection = useMemo(
    () => completion?.sections.find((s) => s.key === tab),
    [completion, tab],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-[14px] text-zinc-500">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[820px] space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1931]">Compléter mon profil prestataire</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Chaque onglet s&apos;enregistre séparément. Rien ici ne bloque votre candidature : seul le KYC conditionne
            votre droit à postuler.
          </p>
        </div>

        {/* Barre de progression + répartition par onglet, identiques à la carte du tableau de bord. */}
        {completion && (
          <div className="bg-white rounded-[20px] border border-gray-100 p-5">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[13px] font-semibold text-[#0A1931]">Profil prestataire</span>
              <span className="text-[15px] font-bold text-[#008751]">{completion.percent} %</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-[#008751] transition-all" style={{ width: `${completion.percent}%` }} />
            </div>
            <ul className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {completion.sections.map((section) => (
                <li key={section.key}>
                  <button
                    type="button"
                    onClick={() => setTab(section.key as TabKey)}
                    className="flex w-full items-center justify-between gap-2 text-[12px] text-zinc-600 hover:text-[#0A1931]"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{section.done ? "✅" : "⬜"}</span>
                      {section.label}
                    </span>
                    <span className={section.done ? "font-semibold text-[#008751]" : "text-zinc-400"}>{section.weight} %</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notFound && tab !== "domaines" && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
            Votre profil n&apos;existe pas encore. Commencez par l&apos;onglet{" "}
            <button type="button" onClick={() => setTab("domaines")} className="font-semibold underline">
              Domaines
            </button>{" "}
            : le métier principal est la clé qui permet de vous rapprocher des missions.
          </div>
        )}

        {/* Onglets */}
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Sections du profil">
          {TABS.map((t) => {
            const section = completion?.sections.find((s) => s.key === t.key);
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap h-10 px-4 rounded-full text-[13px] font-medium border transition ${
                  active
                    ? "bg-[#0A1931] border-[#0A1931] text-white"
                    : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {section?.done && <span className="mr-1.5" aria-hidden>✓</span>}
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Critères manquants de l'onglet actif — dit précisément quoi faire, plutôt que de
            laisser deviner ce que « 20 % » attend. */}
        {activeSection && !activeSection.done && (
          <p className="text-[12px] text-zinc-500">
            Pour valider <span className="font-medium text-[#0A1931]">{activeSection.label}</span> ({activeSection.weight} %) :{" "}
            {activeSection.items.filter((i) => !i.done).map((i) => i.label.toLowerCase()).join(", ")}.
          </p>
        )}

        {tab === "presentation" && (
          <PresentationTab profile={profile} identity={identity} onSaved={handleSaved} onIdentity={setIdentity} />
        )}
        {tab === "domaines" && (
          // `key` : changer de profil chargé doit réinitialiser la cascade, sinon la sélection
          // d'un métier survivrait à un rechargement de profil et s'appliquerait à un autre.
          <DomainesTab
            key={profile?.id ?? "nouveau"}
            profile={profile}
            onSaved={(p) => {
              setProfile(p);
              setNotFound(false);
              void loadCompletion();
            }}
          />
        )}
        {tab === "experience" && (
          <ExperienceTab profile={profile} onSaved={setProfile} onCompletionChanged={() => void loadCompletion()} />
        )}
        {tab === "localisation" && <LocalisationTab profile={profile} onSaved={handleSaved} />}
        {tab === "configuration" && <ConfigurationTab profile={profile} onSaved={handleSaved} />}

        {/* Le tableau de bord et le badge sont deux sorties utiles depuis le profil. */}
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            href="/dashboard/provider"
            className="h-10 px-5 rounded-full border border-zinc-200 bg-white text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 flex items-center"
          >
            Retour au tableau de bord
          </Link>
          <Link
            href="/badge"
            className="h-10 px-5 rounded-full border border-zinc-200 bg-white text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 flex items-center"
          >
            Badge « Vérifié »
          </Link>
        </div>
      </div>
    </div>
  );
}
