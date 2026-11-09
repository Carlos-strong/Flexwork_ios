"use client";

// Onglet 1 — Présentation (20 % du profil prestataire).
//
// Quatre critères, tous exigés pour que l'onglet compte : type de prestataire, photo de
// profil, titre professionnel, bio courte. C'est le barème arbitré, et il est appliqué
// côté serveur (src/lib/provider-profile-completion.ts) — cet écran ne fait que l'afficher.
//
// La photo n'est pas enregistrée par POST /api/profile : elle vit sur `User.avatarPath` et
// passe par /api/profile/avatar, tout de suite appliquée (pas de bouton « Enregistrer » pour
// une image, l'envoi EST l'enregistrement). Les trois autres champs partent ensemble.

import { useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { PROVIDER_KINDS } from "@/lib/provider-options";
import { LANGUAGES, LANGUAGE_LEVELS, MAX_LANGUAGES, readLanguages, type SpokenLanguage } from "@/lib/languages";
import {
  Field,
  ProfileCard,
  SaveRow,
  btnSecondary,
  inputClass,
  PROFILE_ERROR_MESSAGES,
  type ProviderIdentity,
  type ProviderProfile,
} from "@/components/profile/profile-shared";

export function PresentationTab({
  profile,
  identity,
  onSaved,
  onIdentity,
}: {
  profile: ProviderProfile | null;
  identity: ProviderIdentity | null;
  onSaved: (profile: ProviderProfile) => void;
  onIdentity: (identity: ProviderIdentity) => void;
}) {
  const [providerKind, setProviderKind] = useState(profile?.providerKind ?? "");
  const [title, setTitle] = useState(profile?.title ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  // Second texte long, distinct de la bio courte : celle-ci tient sur une carte, celui-ci
  // développe la méthode et les réalisations sur le profil complet. Un seul champ ne peut pas
  // servir les deux — court partout, il ne dit rien ; long partout, il noie les cartes.
  const [overview, setOverview] = useState(profile?.overview ?? "");
  // Langues parlées (2026-11-08) — partie de la biographie, comme la photo et la bio.
  const [languages, setLanguages] = useState<SpokenLanguage[]>(() => readLanguages(profile?.languages));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bioLength = description.trim().length;
  const overviewLength = overview.trim().length;
  // Seuil du barème serveur (src/lib/provider-profile-completion.ts) pour la bio courte.
  const BIO_MIN = 40;
  // Modifications non enregistrées : comparées à la dernière version renvoyée par le serveur
  // (`profile` est remplacé par la réponse de chaque enregistrement réussi).
  const dirty =
    providerKind !== (profile?.providerKind ?? "") ||
    title.trim() !== (profile?.title ?? "").trim() ||
    description.trim() !== (profile?.description ?? "").trim() ||
    overview.trim() !== (profile?.overview ?? "").trim() ||
    JSON.stringify(languages) !== JSON.stringify(readLanguages(profile?.languages));

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de resélectionner le même fichier ensuite
    if (!file) return;
    setAvatarBusy(true);
    setAvatarMsg(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/profile/avatar", { method: "POST", body: formData });
    setAvatarBusy(false);
    if (res.ok) {
      const data = await res.json();
      if (identity) onIdentity({ ...identity, avatarUrl: data.avatarUrl });
      setAvatarMsg({ text: "Photo de profil mise à jour.", ok: true });
    } else {
      const data = await res.json().catch(() => ({}));
      setAvatarMsg({
        text:
          data.error === "unsupported_file_type"
            ? "Format non supporté — JPG, PNG ou WEBP uniquement."
            : data.error === "file_too_large"
              ? "Fichier trop volumineux — 2 Mo maximum."
              : "Échec de l'envoi de la photo.",
        ok: false,
      });
    }
  }

  async function handleAvatarRemove() {
    setAvatarBusy(true);
    setAvatarMsg(null);
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    setAvatarBusy(false);
    if (res.ok) {
      if (identity) onIdentity({ ...identity, avatarUrl: null });
      setAvatarMsg({ text: "Photo de profil retirée.", ok: true });
    } else {
      setAvatarMsg({ text: "Échec de la suppression.", ok: false });
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Chaîne vide et `undefined` ne veulent PAS dire la même chose ici : la route fait un
        // `update({ data })`, donc une clé absente laisse la colonne intacte. Pour VIDER un
        // titre, il faut donc envoyer la chaîne vide — que le barème de complétion compte
        // comme non renseignée (il ignore les chaînes blanches).
        providerKind: providerKind || undefined,
        title: title.trim(),
        description: description.trim(),
        overview: overview.trim(),
        languages,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(await res.json());
      setMsg({ text: "Présentation enregistrée.", ok: true });
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

  // Mise en page (2026-11-07) : trois cartes au lieu de quatre. La photo et le titre forment
  // ensemble l'en-tête de la carte que voient les clients — ils sont réunis ; la présentation
  // détaillée rejoint la bio (son titre de carte répétait mot pour mot celui du champ). Chaque
  // carte porte la coche de ses critères du barème, et chaque compteur est collé à son champ.
  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
      <ProfileCard
        title="Photo et titre"
        description="Ce que le client voit en premier, sur vos candidatures, vos offres et votre profil public."
        aside={<Criterion done={!!identity?.avatarUrl && title.trim().length > 0} />}
      >
        <div className="flex items-center gap-4">
          <Avatar src={identity?.avatarUrl ?? null} initials={initialsOf(identity)} size={64} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarSelect}
              />
              <button type="button" disabled={avatarBusy} className={btnSecondary} onClick={() => fileRef.current?.click()}>
                {avatarBusy ? "Envoi..." : identity?.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
              </button>
              {identity?.avatarUrl && (
                <button
                  type="button"
                  disabled={avatarBusy}
                  className="h-10 px-3 rounded-full text-[13px] font-medium text-zinc-500 hover:text-red-600 transition"
                  onClick={handleAvatarRemove}
                >
                  Retirer
                </button>
              )}
            </div>
            {/* La photo s'applique dès l'envoi — le dire évite de la croire liée au bouton du bas. */}
            <p className="mt-1.5 text-[12px] text-zinc-500">JPG, PNG ou WEBP · 2 Mo max · enregistrée dès l&apos;envoi</p>
          </div>
        </div>
        {avatarMsg && (
          <p className={`mt-3 text-[12px] ${avatarMsg.ok ? "text-emerald-700" : "text-red-600"}`} role="status">
            {avatarMsg.text}
          </p>
        )}

        <div className="mt-5">
          <Field label="Titre professionnel" htmlFor="title" hint="Une ligne, votre métier et ce qui vous distingue.">
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className={inputClass}
              placeholder="Ex. : Électricien certifié, installations domestiques"
            />
          </Field>
        </div>
      </ProfileCard>

      <ProfileCard
        title="Type de prestataire"
        description="Déclaratif : cela change la façon dont vous vous présentez, pas vos droits."
        aside={<Criterion done={!!providerKind} />}
      >
        <div className="grid grid-cols-2 gap-2">
          {PROVIDER_KINDS.map((option) => (
            <label
              key={option.value}
              className={`flex items-center gap-2.5 px-3 sm:px-4 py-3 rounded-xl border text-[14px] leading-tight cursor-pointer transition-colors duration-200 ${
                providerKind === option.value
                  ? "border-[#008751] bg-[#008751]/5 text-[#0A1931] font-medium"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              <input
                type="radio"
                name="providerKind"
                value={option.value}
                checked={providerKind === option.value}
                onChange={() => setProviderKind(option.value)}
                className="accent-[#008751] shrink-0"
              />
              {option.label}
            </label>
          ))}
        </div>
      </ProfileCard>

      <ProfileCard title="Présentation" aside={<Criterion done={bioLength >= BIO_MIN} />}>
        <div className="space-y-5">
          <div>
            <CounterLabel htmlFor="description" label="Bio courte">
              {/* Le seuil est celui du barème serveur : l'afficher évite qu'un utilisateur croie
                  avoir rempli la section avec un mot, et découvre le contraire dans le pourcentage. */}
              <span className={bioLength >= BIO_MIN ? "text-emerald-600" : "text-zinc-400"}>
                {bioLength >= BIO_MIN ? `✓ ${bioLength} caractères` : `${bioLength} / ${BIO_MIN} min.`}
              </span>
            </CounterLabel>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              className={textareaClass}
              placeholder="En deux ou trois phrases : votre expérience et ce que vous faites le mieux."
            />
            <p className="mt-1.5 text-[12px] leading-snug text-zinc-500">Affichée sur les cartes de vos offres et candidatures.</p>
          </div>

          {/* Le modèle en demande 500 caractères pour un profil abouti — mais l'exiger d'emblée
              découragerait : le barème de complétion ne s'appuie pas sur ce champ, et le
              compteur suffit à montrer où l'on en est. */}
          <div>
            <CounterLabel htmlFor="overview" label="Présentation détaillée" optional>
              <span className={overviewLength >= 500 ? "text-emerald-600" : "text-zinc-400"}>
                {overviewLength} / 500 conseillés
              </span>
            </CounterLabel>
            <textarea
              id="overview"
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              maxLength={5000}
              rows={5}
              className={textareaClass}
              placeholder="Votre méthode, vos réalisations, votre façon de travailler — sans liens ni listes."
            />
            <p className="mt-1.5 text-[12px] leading-snug text-zinc-500">Sur votre profil complet. Commencez court, complétez plus tard.</p>
          </div>
        </div>
      </ProfileCard>

      <ProfileCard
        title="Langues parlées"
        description="Les langues dans lesquelles vous pouvez échanger avec un client et travailler."
      >
        {languages.length > 0 && (
          <ul className="mb-3 space-y-2">
            {languages.map((l, i) => (
              <li key={l.code} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[110px] text-[14px] font-medium text-[#0A1931]">
                  {LANGUAGES.find((x) => x.code === l.code)?.label ?? l.code}
                </span>
                <select
                  aria-label={`Niveau en ${LANGUAGES.find((x) => x.code === l.code)?.label ?? l.code}`}
                  value={l.niveau}
                  onChange={(e) =>
                    setLanguages((prev) => prev.map((x, j) => (j === i ? { ...x, niveau: e.target.value as SpokenLanguage["niveau"] } : x)))
                  }
                  className={`${inputClass} !w-auto`}
                >
                  {LANGUAGE_LEVELS.map((lv) => (
                    <option key={lv.value} value={lv.value}>
                      {lv.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setLanguages((prev) => prev.filter((_, j) => j !== i))}
                  className="text-[12px] text-red-500 hover:underline"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
        {languages.length < MAX_LANGUAGES ? (
          <select
            aria-label="Ajouter une langue"
            value=""
            onChange={(e) => {
              const code = e.target.value;
              if (code) setLanguages((prev) => [...prev, { code, niveau: prev.length === 0 ? "natif" : "courant" }]);
            }}
            className={`${inputClass} sm:max-w-xs`}
          >
            <option value="">+ Ajouter une langue</option>
            {LANGUAGES.filter((x) => !languages.some((l) => l.code === x.code)).map((x) => (
              <option key={x.code} value={x.code}>
                {x.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[12px] text-zinc-500">{MAX_LANGUAGES} langues maximum.</p>
        )}
      </ProfileCard>

      <SaveRow saving={saving} message={msg} dirty={dirty} sticky />
    </form>
  );
}

const textareaClass =
  "w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";

/** Libellé d'un champ texte long avec son compteur aligné à droite, au plus près de la saisie. */
function CounterLabel({
  htmlFor,
  label,
  optional,
  children,
}: {
  htmlFor: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[14px] font-medium text-zinc-700">
        {label} {optional && <span className="font-normal text-zinc-400">(facultatif)</span>}
      </label>
      <span className="shrink-0 text-[12px] tabular-nums">
        {children}
      </span>
    </div>
  );
}

/** Pastille « critère du barème rempli / à compléter », en tête de carte. */
function Criterion({ done }: { done: boolean }) {
  return done ? (
    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">✓ Complet</span>
  ) : (
    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">À compléter</span>
  );
}

function initialsOf(identity: ProviderIdentity | null): string {
  const a = identity?.firstname?.trim()?.charAt(0) ?? "";
  const b = identity?.lastname?.trim()?.charAt(0) ?? "";
  return (`${a}${b}`.toUpperCase()) || "?";
}
