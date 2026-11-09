"use client";

// Onglet 2 — Domaines (30 % du profil prestataire, le poids le plus lourd).
//
// C'est l'onglet qui fait exister le rapprochement. `Profile.mainDomain` porte le LIBELLÉ du
// métier choisi dans la taxonomie, exactement comme `Mission.domaine` côté client : sans cette
// symétrie, `domain-match.ts` compare deux champs libres par recherche de sous-chaîne, ce qui
// est asymétrique (un profil « Plomberie sanitaire » n'atteint pas une mission « Plomberie »).
// Les compétences (`tags`) puisent dans le même catalogue que les `Mission.tags`.
//
// Critères du barème : métier + au moins 3 compétences.
//
// ── Un détail qui n'est plus un oubli (2026-09-23) ──────────────────────────────────────
//
// La CATÉGORIE (BTP, Services…) n'était pas persistée : seul le libellé du métier l'était, si
// bien qu'un profil existant ne savait plus dans quelle catégorie ranger son métier et que la
// cascade se rouvrait vide. `Profile.metierId` comble ce trou : la clé du métier est
// enregistrée, et l'onglet remonte la cascade jusqu'à sa catégorie au chargement.
// Les profils antérieurs gardent leur libellé seul — lui non plus n'est jamais effacé :
// `mainDomain` n'est remplacé que si un métier est réellement choisi, sinon rouvrir cet
// onglet pour ajouter un service retirerait le métier du profil.

import { useCallback, useEffect, useState } from "react";
import {
  TaxonomyCascade,
  resolveMetierSelection,
  type RiskLevelValue,
  type TaxonomySelection,
} from "@/components/mission/TaxonomyCascade";
import { MAX_COMPETENCES, MAX_COMPETENCE_LENGTH } from "@/lib/provider-options";
import { MIN_COMPETENCES } from "@/lib/provider-profile-completion";
import {
  ProfileCard,
  SaveRow,
  btnSecondary,
  inputClass,
  NETWORK_ERROR_MESSAGE,
  profileErrorMessage,
  type ProviderProfile,
} from "@/components/profile/profile-shared";

export function DomainesTab({
  profile,
  onSaved,
}: {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
}) {
  const [mainDomain, setMainDomain] = useState(profile?.mainDomain ?? "");
  // Compétences listées par le CATALOGUE pour le métier courant, remontées par la cascade.
  // Elles servent à distinguer celles du catalogue de celles ajoutées à la main : sans cette
  // distinction, un ajout n'apparaîtrait nulle part — la cascade n'affiche que son catalogue.
  const [catalogueCompetences, setCatalogueCompetences] = useState<string[]>([]);
  const [competenceDraft, setCompetenceDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Les compétences déjà déclarées sont restituées telles quelles : la cascade les remontera
  // dès qu'un métier sera sélectionné, mais un profil existant ne doit pas les perdre entre-temps.
  const [taxonomy, setTaxonomy] = useState<TaxonomySelection>({
    categorieId: "",
    categorieLabel: "",
    metierId: "",
    metierLabel: "",
    competences: profile?.tags ?? [],
  });

  const competences = taxonomy.competences;

  // Toute modification efface le bandeau du dernier enregistrement : un « Une valeur n'est pas
  // acceptée » resté affiché après la correction laisse croire que le problème demeure, et un
  // « Domaines enregistrés » ne vaut plus pour des choix qui ne le sont pas encore.
  // `useCallback` : TaxonomyCascade est mémoïsé, une fonction recréée à chaque rendu le ferait
  // se redessiner à chaque frappe dans le champ « Compétences proposées ».
  const updateTaxonomy = useCallback((next: TaxonomySelection) => {
    setTaxonomy(next);
    setMsg(null);
  }, []);

  // Ce qui a été ajouté À LA MAIN : ce que le catalogue du métier ne liste pas.
  const addedCompetences = competences.filter((c) => !catalogueCompetences.includes(c));

  // ── Rouvrir sur le métier déjà choisi ───────────────────────────────────────────────
  //
  // Le profil ne connaît que l'IDENTIFIANT du métier ; la cascade demande d'abord une
  // catégorie. On remonte donc l'arbre (déjà en cache, aucune requête de plus) pour rétablir
  // la sélection complète. Si le métier a disparu du catalogue, on ne touche à rien : le
  // libellé enregistré reste affiché sous la cascade, et l'enregistrement d'un autre onglet
  // ne le perdra pas.
  const savedMetierId = profile?.metierId ?? "";
  const savedTags = (profile?.tags ?? []).join("\u0000");
  useEffect(() => {
    if (!savedMetierId) return;
    let cancelled = false;
    resolveMetierSelection(savedMetierId, savedTags ? savedTags.split("\u0000") : [])
      .then((selection) => {
        if (!cancelled && selection) setTaxonomy(selection);
      })
      .catch(() => {
        // Échec réseau : la cascade reste vide mais fonctionnelle, et le métier enregistré
        // est toujours rappelé juste au-dessus. On ne dégrade pas l'onglet pour un confort
        // d'affichage.
      });
    return () => {
      cancelled = true;
    };
    // `savedTags` est une chaîne : elle ne change d'identité que si les compétences changent
    // réellement, là où le tableau `profile.tags` en changerait à chaque rendu.
  }, [savedMetierId, savedTags]);

  // ── Assurance obligatoire (A9) ──────────────────────────────────────────────────────────
  //
  // L'obligation est réelle : sans assurance RC Pro enregistrée, `candidature-guard` refuse la
  // candidature (`insurance_required`) et `escrow` refuse le séquestre
  // (`effective_insurance_required`). Le prestataire ne l'apprenait qu'au pire moment — au clic
  // sur « candidater », après avoir lu la mission en entier. L'annoncer ici transforme un refus
  // en une information. Aucun droit n'est ouvert ni fermé par cet affichage.
  //
  // Le palier vient de la CASCADE, qui le tient du métier lui-même (`Metier.riskLevel`, saisi par
  // l'administrateur dans la taxonomie). C'est la donnée exacte qui décidera, à la publication,
  // si une assurance est exigée — là où un appel séparé à une autre table pouvait annoncer autre
  // chose que la règle appliquée. Il est connu dès la SÉLECTION, y compris pour un métier déjà
  // enregistré et restitué au chargement.
  const [riskLevel, setRiskLevel] = useState<RiskLevelValue | null>(null);
  // La règle du modèle est « exigée si et seulement si le palier est élevé »
  // (modele-skillafrica-v3 §7.2) — on ne réécrit pas la condition ici, on la lit.
  const insuranceRequired = riskLevel === "high";

  // Les compétences proposées ici s'AJOUTENT à celles du catalogue : elles ne les remplacent
  // pas et partagent le même plafond, parce qu'elles déclarent exactement la même chose.
  //
  // Tant qu'aucun métier n'est choisi, l'ajout est refusé : les compétences déclarées
  // appartiennent à un métier, et changer de métier les efface — laisser saisir avant, ce
  // serait accepter un texte pour le perdre au clic suivant.
  function addCompetence() {
    const value = competenceDraft.trim();
    if (!value || !taxonomy.metierId || competences.length >= MAX_COMPETENCES) return;
    // Même règle que le serveur : « calcul » ne s'ajoute pas à « Calcul » déjà déclarée.
    const key = value.toLocaleLowerCase("fr");
    if (!competences.some((c) => c.toLocaleLowerCase("fr") === key)) {
      updateTaxonomy({ ...taxonomy, competences: [...competences, value] });
    }
    setCompetenceDraft("");
  }

  function removeCompetence(value: string) {
    updateTaxonomy({ ...taxonomy, competences: competences.filter((c) => c !== value) });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    // `try/finally` : une requête qui ne part pas (réseau coupé, serveur arrêté) lève une
    // exception au lieu de rendre une réponse. Sans ce filet, `setSaving(false)` n'était jamais
    // atteint et le bouton restait figé sur « Enregistrement... » jusqu'au rechargement.
    try {
      await save();
    } catch {
      setMsg({ text: NETWORK_ERROR_MESSAGE, ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Le métier de la cascade FAIT FOI ; à défaut, le métier déjà enregistré est renvoyé
        // tel quel. Jamais de chaîne vide ici : `mainDomain` est la clé du rapprochement, et
        // l'effacer retirerait le profil de tous les résultats.
        mainDomain: taxonomy.metierLabel || mainDomain,
        // La clé du métier accompagne le libellé : c'est elle qui permet de rouvrir la
        // cascade ici même, et le serveur en dérive `mainDomain` — un libellé qui ne
        // correspondrait pas au catalogue ne peut donc pas être enregistré. `undefined`
        // (aucun métier choisi ni enregistré) est omis du JSON, et la colonne reste intacte.
        metierId: taxonomy.metierId || savedMetierId || undefined,
        // Une SEULE liste : les compétences choisies au catalogue et celles ajoutées à la main
        // y sont réunies. C'est ce qui rend le mot « proposées » exact, et ce qui évite deux
        // notions concurrentes pour la même déclaration.
        tags: competences,
      }),
    });
    if (res.ok) {
      const saved: ProviderProfile = await res.json();
      setMainDomain(saved.mainDomain ?? "");
      onSaved(saved);
      // L'enregistrement réussit dès le métier choisi, mais l'onglet n'est VALIDÉ au barème
      // qu'à MIN_COMPETENCES compétences. Le dire ici, au moment où l'on regarde le résultat,
      // plutôt que de laisser découvrir que la coche de l'onglet ne s'est pas allumée.
      const missing = MIN_COMPETENCES - (saved.tags?.length ?? 0);
      setMsg({
        text:
          missing > 0
            ? `Domaines enregistrés. Ajoutez encore ${missing} compétence${missing > 1 ? "s" : ""} pour valider cet onglet.`
            : "Domaines enregistrés.",
        ok: true,
      });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({ text: profileErrorMessage(data, res.status), ok: false });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ProfileCard
        title="Domaine, métier et compétences"
        description="Choisis dans le même catalogue que les missions : c'est ce qui rend le rapprochement exact plutôt qu'approximatif."
      >
        {/* Le métier courant sert de repli si la cascade n'est pas retouchée. */}
        <input type="hidden" value={mainDomain} readOnly />
        {mainDomain && !taxonomy.metierLabel && (
          <p className="mb-3 text-[12px] text-zinc-500">
            Métier enregistré : <span className="font-medium text-[#0A1931]">{mainDomain}</span>. Resélectionnez-le
            ci-dessous pour le modifier ou choisir vos compétences.
          </p>
        )}
        <TaxonomyCascade
          value={taxonomy}
          onChange={updateTaxonomy}
          inputClass={inputClass}
          labelClass="block text-[13px] font-medium text-zinc-700 mb-1.5"
          competencesLabel="Compétences déclarées"
          maxCompetences={MAX_COMPETENCES}
          onCatalogueCompetences={setCatalogueCompetences}
          onMetierRisk={setRiskLevel}
        />

        {insuranceRequired && (
          <div role="note" className="mt-4 rounded-xl border border-amber-200 bg-[#FEF3C7] p-3.5">
            <p className="text-[13px] font-semibold text-amber-900">🚨 Assurance obligatoire pour ce métier</p>
            <p className="mt-1 text-[12px] leading-5 text-zinc-700">
              Ce métier est classé à risque élevé. Une assurance RC Pro effective sera exigée{" "}
              <span className="font-medium">avant de candidater</span> et{" "}
              <span className="font-medium">avant tout séquestre</span> : sans elle, la candidature est
              refusée. Renseignez-la dans l&apos;onglet Expérience.
            </p>
          </div>
        )}
      </ProfileCard>

      <ProfileCard
        title="Compétences proposées"
        description="Ajoutez ce que le catalogue du métier ne liste pas. Elles rejoignent vos compétences déclarées et comptent dans le même plafond."
      >
        <div className="flex gap-2">
          <input
            value={competenceDraft}
            onChange={(e) => setCompetenceDraft(e.target.value)}
            onKeyDown={(e) => {
              // Entrée ajoute la compétence au lieu de soumettre l'onglet : dans un champ de
              // liste, la touche doit faire ce que l'utilisateur attend d'une liste.
              if (e.key === "Enter") {
                e.preventDefault();
                addCompetence();
              }
            }}
            maxLength={MAX_COMPETENCE_LENGTH}
            disabled={!taxonomy.metierId}
            className={`${inputClass} disabled:bg-zinc-50 disabled:text-zinc-400`}
            placeholder={taxonomy.metierId ? "Installation électrique résidentielle" : "Choisissez d'abord un métier"}
          />
          <button
            type="button"
            onClick={addCompetence}
            disabled={!competenceDraft.trim() || !taxonomy.metierId || competences.length >= MAX_COMPETENCES}
            className={`${btnSecondary} whitespace-nowrap disabled:opacity-50`}
          >
            Ajouter
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">
          {competences.length} / {MAX_COMPETENCES} compétences déclarées au total
        </p>
        {addedCompetences.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {addedCompetences.map((value) => (
              <li key={value}>
                <button
                  type="button"
                  onClick={() => removeCompetence(value)}
                  title="Retirer cette compétence"
                  className="h-9 px-3 rounded-full text-[13px] font-medium border border-[#008751] bg-[#008751] text-white"
                >
                  {value} ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </ProfileCard>

      <SaveRow saving={saving} message={msg} />
    </form>
  );
}
