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
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bioLength = description.trim().length;

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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ProfileCard
        title="Photo de profil"
        description="Elle apparaît sur vos candidatures, vos offres et votre profil public."
      >
        <div className="flex items-center gap-4">
          <Avatar src={identity?.avatarUrl ?? null} initials={initialsOf(identity)} size={64} />
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
              <button type="button" disabled={avatarBusy} className={btnSecondary} onClick={handleAvatarRemove}>
                Retirer
              </button>
            )}
          </div>
        </div>
        {avatarMsg && <p className={`mt-3 text-[12px] ${avatarMsg.ok ? "text-emerald-700" : "text-red-600"}`}>{avatarMsg.text}</p>}
      </ProfileCard>

      <ProfileCard title="Type de prestataire" description="Déclaratif : cela change la façon dont vous vous présentez, pas vos droits.">
        <div className="grid sm:grid-cols-2 gap-2">
          {PROVIDER_KINDS.map((option) => (
            <label
              key={option.value}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-[13px] cursor-pointer transition ${
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
                className="accent-[#008751]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </ProfileCard>

      <ProfileCard title="Titre et présentation">
        <div className="space-y-4">
          <Field
            label="Titre professionnel"
            htmlFor="title"
            hint="Ce que le client lit en premier. Ex. : Électricien certifié"
          >
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className={inputClass}
              placeholder="Électricien certifié"
            />
          </Field>

          <Field label="Bio courte" htmlFor="description">
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition"
              placeholder="Votre expérience, vos méthodes, ce que vous aimez faire."
            />
          </Field>
          {/* Le seuil est celui du barème serveur : l'afficher évite qu'un utilisateur croie
              avoir rempli la section avec un mot, et découvre le contraire dans le pourcentage. */}
          <p className={`text-[11px] ${bioLength >= 40 ? "text-emerald-600" : "text-zinc-400"}`}>
            {bioLength} / 40 caractères minimum pour valider cette section
          </p>
        </div>
      </ProfileCard>

      <ProfileCard
        title="Présentation détaillée"
        description="Ce que vous développez au-delà de la bio : votre méthode, vos réalisations, votre façon de travailler."
      >
        {/* Le modèle en demande 500 caractères pour un profil abouti — mais l'exiger d'emblée
            découragerait : le barème de complétion ne s'appuie pas sur ce champ, et le
            compteur suffit à montrer où l'on en est. */}
        <Field
          label="Présentation détaillée"
          htmlFor="overview"
          hint="Le modèle recommande 500 caractères pour un profil abouti. Commencez court, complétez plus tard."
        >
          <textarea
            id="overview"
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            maxLength={5000}
            rows={6}
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition"
            placeholder="Décrivez votre approche, vos réalisations, votre méthode de travail — sans liens ni listes."
          />
        </Field>
        <p className="mt-1 text-[11px] text-zinc-400">{overview.trim().length} / 5000</p>
      </ProfileCard>

      <SaveRow saving={saving} message={msg} />
    </form>
  );
}

function initialsOf(identity: ProviderIdentity | null): string {
  const a = identity?.firstname?.trim()?.charAt(0) ?? "";
  const b = identity?.lastname?.trim()?.charAt(0) ?? "";
  return (`${a}${b}`.toUpperCase()) || "?";
}
