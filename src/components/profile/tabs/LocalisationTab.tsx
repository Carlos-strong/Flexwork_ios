"use client";

// Onglet 4 — Localisation (15 % du profil prestataire).
//
// Critères du barème : pays + ville + rayon + disponibilité. Les modes de travail et les zones
// couvertes sont là mais HORS barème — exiger un champ facultatif le rendrait obligatoire par
// la bande, et un prestataire à distance n'a rien à dire sur les zones qu'il couvre.
//
// La ville est un texte libre : la plateforme n'a pas de référentiel de villes, et en inventer
// un incomplet (Cotonou, Porto-Novo, et rien d'autre) obligerait un prestataire de Parakou à
// choisir entre une ville fausse et pas de ville du tout.

import { useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import { AVAILABILITIES, DEPLACEMENTS, MAX_COVERAGE_ZONES, WORK_MODES } from "@/lib/provider-options";
import {
  Field,
  ProfileCard,
  SaveRow,
  btnSecondary,
  inputClass,
  PROFILE_ERROR_MESSAGES,
  type ProviderProfile,
} from "@/components/profile/profile-shared";

export function LocalisationTab({
  profile,
  onSaved,
}: {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
}) {
  const [zonePays, setZonePays] = useState(profile?.zonePays ?? "BJ");
  const [zoneVille, setZoneVille] = useState(profile?.zoneVille ?? "");
  const [zoneRayonKm, setZoneRayonKm] = useState(profile?.zoneRayonKm ? String(profile.zoneRayonKm) : "");
  // Quartier : le complément de `zoneVille` à l'échelle où les interventions se situent
  // réellement — on ne traverse pas une ville pour un dépannage.
  const [quartier, setQuartier] = useState(profile?.quartier ?? "");
  const [deplacement, setDeplacement] = useState<string[]>(profile?.deplacement ?? []);
  const [workModes, setWorkModes] = useState<string[]>(profile?.workModes ?? []);
  const [coverageZones, setCoverageZones] = useState<string[]>(profile?.coverageZones ?? []);
  const [zoneDraft, setZoneDraft] = useState("");
  const [availability, setAvailability] = useState(profile?.availability ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function toggleWorkMode(value: string) {
    setWorkModes((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function addZone() {
    const value = zoneDraft.trim();
    if (!value || coverageZones.length >= MAX_COVERAGE_ZONES) return;
    if (!coverageZones.includes(value)) setCoverageZones([...coverageZones, value]);
    setZoneDraft("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zonePays,
        zoneVille: zoneVille.trim(),
        // `undefined` quand le champ est vide : `zoneRayonKm` est un entier positif en base,
        // et envoyer 0 serait refusé par le schéma (à raison — un rayon nul n'est pas une
        // zone d'intervention).
        zoneRayonKm: zoneRayonKm ? Number(zoneRayonKm) : undefined,
        workModes,
        coverageZones,
        quartier: quartier.trim(),
        deplacement,
        availability: availability || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(await res.json());
      setMsg({ text: "Localisation enregistrée.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({
      text:
        PROFILE_ERROR_MESSAGES[data.error] ??
        (res.status >= 500 ? "Erreur serveur inattendue — réessayez dans un instant." : "Échec de l'enregistrement."),
      ok: false,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ProfileCard
        title="Zone d'intervention"
        description="Pays et ville de rattachement, et jusqu'où vous vous déplacez."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Pays" htmlFor="zonePays">
            <select id="zonePays" value={zonePays} onChange={(e) => setZonePays(e.target.value)} className={inputClass}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ville" htmlFor="zoneVille">
            <input
              id="zoneVille"
              value={zoneVille}
              onChange={(e) => setZoneVille(e.target.value)}
              maxLength={100}
              className={inputClass}
              placeholder="Cotonou"
            />
          </Field>

          <Field label="Rayon d'intervention (km)" htmlFor="zoneRayonKm" hint="Laissez vide si vous intervenez sans limite.">
            <input
              id="zoneRayonKm"
              type="number"
              min={1}
              max={500}
              value={zoneRayonKm}
              onChange={(e) => setZoneRayonKm(e.target.value)}
              className={inputClass}
              placeholder="20"
            />
          </Field>

          <Field label="Quartier" htmlFor="quartier" hint="Facultatif — précise où vous intervenez dans la ville.">
            <input
              id="quartier"
              value={quartier}
              onChange={(e) => setQuartier(e.target.value)}
              maxLength={120}
              className={inputClass}
              placeholder="Fidjrossè"
            />
          </Field>
        </div>
      </ProfileCard>

      <ProfileCard title="Modes de travail" description="Comment vous acceptez d'intervenir. Aligné sur les modes proposés par les missions.">
        <div className="flex flex-wrap gap-2">
          {WORK_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleWorkMode(option.value)}
              aria-pressed={workModes.includes(option.value)}
              className={`h-9 px-4 rounded-full text-[13px] font-medium border transition ${
                workModes.includes(option.value)
                  ? "bg-[#008751] border-[#008751] text-white"
                  : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </ProfileCard>

      <ProfileCard
        title="Déplacement"
        description="Comment vous vous rendez sur place. Déclaratif : cela informe le client, cela ne conditionne aucun droit."
      >
        <div className="flex flex-wrap gap-2">
          {DEPLACEMENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setDeplacement((prev) =>
                  prev.includes(option.value) ? prev.filter((v) => v !== option.value) : [...prev, option.value]
                )
              }
              aria-pressed={deplacement.includes(option.value)}
              className={`h-9 px-4 rounded-full text-[13px] font-medium border transition ${
                deplacement.includes(option.value)
                  ? "bg-[#008751] border-[#008751] text-white"
                  : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </ProfileCard>

      <ProfileCard title="Zones couvertes" description="Les villes où vous vous déplacez régulièrement, en plus de votre ville principale.">
        <div className="flex gap-2">
          <input
            value={zoneDraft}
            onChange={(e) => setZoneDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addZone();
              }
            }}
            maxLength={100}
            className={inputClass}
            placeholder="Porto-Novo"
          />
          <button
            type="button"
            onClick={addZone}
            disabled={!zoneDraft.trim() || coverageZones.length >= MAX_COVERAGE_ZONES}
            className={`${btnSecondary} whitespace-nowrap disabled:opacity-50`}
          >
            Ajouter
          </button>
        </div>
        {coverageZones.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {coverageZones.map((zone) => (
              <li key={zone} className="flex items-center gap-2 rounded-full bg-zinc-50 px-3 py-1.5 text-[13px] text-zinc-700">
                {zone}
                <button
                  type="button"
                  onClick={() => setCoverageZones(coverageZones.filter((z) => z !== zone))}
                  className="text-red-500 hover:underline"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </ProfileCard>

      <ProfileCard title="Disponibilité" description="Déclaratif : vous pourrez le changer à tout moment.">
        <Field label="Disponibilité" htmlFor="availability">
          <select
            id="availability"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            className={inputClass}
          >
            <option value="">Non précisée</option>
            {AVAILABILITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </ProfileCard>

      <SaveRow saving={saving} message={msg} />
    </form>
  );
}
