"use client";

// Saisie d'un diplôme ou d'une certification — onglet Expérience (2026-11-07).
//
//   Diplôme       : NIVEAU (liste fixe : CAP, DT, DUT, BTS, Licence professionnelle,
//                   Ingénieur, Master professionnel) + SPÉCIALITÉ saisie → « BTS Génie civil »
//   Certification : intitulé libre + spécialité facultative
//
// La spécialité se tape librement, avec en suggestion (<datalist>) les spécialités déjà
// connues : celles saisies par d'autres prestataires (registre QualificationSpecialty) et les
// métiers du domaine. Une spécialité nouvelle rejoint le registre à l'enregistrement, côté
// serveur (POST /api/declarations) — rien à faire ici.
//
// Les champs envoyés restent ceux que lit le FormData du formulaire parent (addDiploma) :
// `qualificationName`, `specialty`, `isStateIssued`, plus `specialtyCategorieId` (domaine,
// pour classer la spécialité dans le registre).

import { useEffect, useMemo, useState } from "react";
import {
  DIPLOMA_LEVELS,
  SPECIALTY_MAX,
  cleanSpecialty,
  diplomaTitle,
  isDiplomaLevel,
  specialtySuggestions,
  type QualificationKind,
} from "@/lib/qualification-catalog";
import { Field, inputClass } from "@/components/profile/profile-shared";

type Categorie = { id: string; libelle: string; metiers: { id: string; libelle: string }[] };
type SavedSpecialty = { libelle: string; categorieId: string | null };

// Taxonomie gardée pour la session de la page : le sélecteur est remonté après chaque ajout
// (`key`), et la relire à chaque fois laissait le domaine vide le temps de la requête.
// Les spécialités, elles, sont relues : celle qu'on vient d'ajouter doit y figurer.
let taxonomyCache: Promise<Categorie[]> | null = null;
function loadTaxonomy(): Promise<Categorie[]> {
  taxonomyCache ??= fetch("/api/taxonomy")
    .then((r) => (r.ok ? r.json() : { categories: [] }))
    .then((t) => (t.categories ?? []) as Categorie[])
    .catch(() => {
      taxonomyCache = null;
      return [];
    });
  return taxonomyCache;
}

export function QualificationPicker({
  metierId,
  mainDomain,
}: {
  metierId?: string | null;
  mainDomain?: string | null;
}) {
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [saved, setSaved] = useState<SavedSpecialty[]>([]);
  const [kind, setKind] = useState<QualificationKind>("diplome");
  const [domainId, setDomainId] = useState("");
  const [level, setLevel] = useState("");
  const [certName, setCertName] = useState("");
  const [specialty, setSpecialty] = useState("");
  // Un niveau national se coche d'emblée « Diplôme d'État » ; décochable (école privée…).
  const [stateIssued, setStateIssued] = useState(false);

  useEffect(() => {
    let alive = true;
    // Deux chargements indépendants : le domaine s'affiche dès la taxonomie (en cache après
    // le premier montage), sans attendre la liste des spécialités.
    loadTaxonomy().then((cats) => {
      if (!alive) return;
      setCategories(cats);
      // Domaine par défaut : celui du métier principal.
      const own =
        cats.find((c) => c.metiers.some((m) => m.id === metierId)) ??
        cats.find((c) => c.metiers.some((m) => m.libelle === mainDomain));
      setDomainId((current) => current || own?.id || "");
    });
    fetch("/api/qualification-specialties")
      .then((r) => (r.ok ? r.json() : { specialties: [] }))
      .then((spec) => {
        if (alive) setSaved((spec.specialties ?? []) as SavedSpecialty[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [metierId, mainDomain]);

  const domain = categories.find((c) => c.id === domainId);
  const suggestions = useMemo(
    () =>
      specialtySuggestions({
        categorieId: domainId || null,
        metiers: domain?.metiers.map((m) => m.libelle) ?? [],
        saved,
      }),
    [domainId, domain, saved],
  );

  const isDiploma = kind === "diplome";
  const qualificationName = isDiploma
    ? isDiplomaLevel(level)
      ? diplomaTitle(level, specialty)
      : ""
    : certName.trim();
  const isNewSpecialty =
    !!cleanSpecialty(specialty) &&
    !suggestions.some((s) => s.localeCompare(cleanSpecialty(specialty), "fr", { sensitivity: "base" }) === 0);

  return (
    <div className="space-y-4">
      {/* 1. Type */}
      <div role="radiogroup" aria-label="Type de titre" className="grid grid-cols-2 gap-2 sm:max-w-sm">
        {(
          [
            ["diplome", "Diplôme"],
            ["certification", "Certification"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`flex h-10 items-center justify-center rounded-full border text-[13px] font-medium cursor-pointer transition-colors ${
              kind === value
                ? "border-[#0A1931] bg-[#0A1931] text-white"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            <input
              type="radio"
              name="qualificationKind"
              value={value}
              checked={kind === value}
              onChange={() => {
                setKind(value);
                setStateIssued(value === "diplome" && !!level);
              }}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* 2. Niveau (diplôme) ou intitulé (certification) */}
        {isDiploma ? (
          <Field label="Niveau du diplôme" htmlFor="diplomaLevel" required>
            <select
              id="diplomaLevel"
              className={inputClass}
              value={level}
              required
              onChange={(e) => {
                setLevel(e.target.value);
                setStateIssued(!!e.target.value);
              }}
            >
              <option value="">Choisir un niveau</option>
              {DIPLOMA_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Intitulé de la certification" htmlFor="certificationName" required>
            <input
              id="certificationName"
              className={inputClass}
              value={certName}
              onChange={(e) => setCertName(e.target.value)}
              required
              maxLength={200}
              placeholder="Ex. : Habilitation électrique"
            />
          </Field>
        )}

        {/* Domaine : classe la spécialité et oriente les suggestions. */}
        <Field label="Domaine" htmlFor="qualificationDomain">
          <select
            id="qualificationDomain"
            name="specialtyCategorieId"
            className={inputClass}
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
          >
            <option value="">Sélectionner un domaine</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* 3. Spécialité — saisie libre, suggestions du registre et des métiers du domaine. */}
      <Field
        label="Spécialité"
        htmlFor="specialty"
        required={isDiploma}
        hint={
          isNewSpecialty
            ? "Nouvelle spécialité : elle sera ajoutée à la liste à l'enregistrement."
            : "Tapez pour voir les spécialités déjà connues."
        }
      >
        <input
          id="specialty"
          name="specialty"
          list="specialty-suggestions"
          autoComplete="off"
          required={isDiploma}
          maxLength={SPECIALTY_MAX}
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className={inputClass}
          placeholder={isDiploma ? "Ex. : Génie civil" : "Facultatif"}
        />
        <datalist id="specialty-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>

      <input type="hidden" name="qualificationName" value={qualificationName} />
      {qualificationName && (
        <p className="rounded-xl bg-zinc-50 px-4 py-2.5 text-[13px] text-zinc-600">
          Intitulé enregistré : <span className="font-semibold text-[#0A1931]">{qualificationName}</span>
        </p>
      )}

      <label className="flex items-center gap-2.5 text-[13px] text-zinc-700">
        <input
          type="checkbox"
          name="isStateIssued"
          checked={stateIssued}
          onChange={(e) => setStateIssued(e.target.checked)}
          className="accent-[#008751]"
        />
        Diplôme d&apos;État
        <span className="text-[12px] text-zinc-400">— à justifier pour le badge « Vérifié »</span>
      </label>
    </div>
  );
}
