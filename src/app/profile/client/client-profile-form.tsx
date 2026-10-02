"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { COUNTRIES } from "@/lib/countries";

// Profil client — pendant de /profile (prestataire), qui demandait jusqu'ici un « Domaine
// principal » obligatoire à tout le monde, client compris. Un client n'a pas de domaine
// d'intervention : il a une profession, un type, éventuellement une organisation.
//
// Les champs sont répartis sur deux tables (ClientProfile et User), mais le formulaire n'en
// montre rien : un seul enregistrement, une seule transaction côté API.

type Completion = {
  percent: number;
  done: number;
  total: number;
  missing: { key: string; label: string }[];
};

type ClientProfileData = {
  profile: {
    profession: string | null;
    clientType: string | null;
    company: string | null;
    sector: string | null;
    languages: string[];
    currency: string;
  } | null;
  user: {
    firstname: string | null;
    lastname: string | null;
    country: string | null;
    city: string | null;
    locality: string | null;
    address: string | null;
    avatarPath: string | null;
  };
  completion: Completion;
};

type Identity = { firstname: string | null; lastname: string | null; fullName: string; avatarUrl: string | null };

const CLIENT_TYPES = [
  { value: "particulier", label: "Particulier" },
  { value: "entreprise", label: "Entreprise" },
  { value: "association", label: "Association" },
  { value: "administration", label: "Administration" },
];

// Secteurs d'activité de l'ORGANISATION — délibérément distincts de la taxonomie métier
// (Catégorie → Métier → Service), qui décrit le travail demandé et non l'activité du donneur
// d'ordre. Confondre les deux ferait d'un hôpital qui commande une réfection de plomberie un
// client « du secteur Plomberie ».
const SECTORS = [
  "Administration et secteur public",
  "Agriculture et agroalimentaire",
  "Associatif et ONG",
  "BTP et immobilier",
  "Commerce et distribution",
  "Éducation et formation",
  "Énergie et mines",
  "Finance et assurance",
  "Hôtellerie et restauration",
  "Industrie et manufacture",
  "Logistique et transport",
  "Numérique et télécoms",
  "Santé et action sociale",
  "Services aux entreprises",
  "Tourisme et culture",
  "Autre",
];

const LANGUAGES = ["Français", "Anglais", "Fon", "Yoruba", "Goun", "Bariba", "Dendi", "Mina", "Wolof", "Haoussa", "Portugais", "Arabe"];

const CURRENCIES = [
  { value: "XOF", label: "F CFA (XOF)" },
  { value: "NGN", label: "Naira (NGN)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "Dollar (USD)" },
];

const SAVE_ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "Votre session a expiré — reconnectez-vous puis réessayez.",
  invalid_payload: "Certains champs sont invalides — vérifiez la longueur des textes saisis.",
  not_found: "Compte introuvable — reconnectez-vous puis réessayez.",
};

const initialsOf = (firstname: string | null, lastname: string | null) =>
  `${firstname?.trim()?.charAt(0) ?? ""}${lastname?.trim()?.charAt(0) ?? ""}`.toUpperCase() || "?";

export default function ClientProfileForm() {
  const [data, setData] = useState<ClientProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Champs contrôlés : le type de client pilote l'affichage du bloc Organisation, et les
  // langues sont une sélection multiple — un formulaire non contrôlé ne suffirait pas.
  const [clientType, setClientType] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profile/client")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ClientProfileData | null) => {
        setData(d);
        setClientType(d?.profile?.clientType ?? "");
        setLanguages(d?.profile?.languages ?? []);
      })
      .finally(() => setLoading(false));
    fetch("/api/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setIdentity);
  }, []);

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarUploading(true);
    setAvatarMsg(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/profile/avatar", { method: "POST", body: formData });
    setAvatarUploading(false);
    if (res.ok) {
      const body = await res.json();
      setIdentity((prev) => (prev ? { ...prev, avatarUrl: body.avatarUrl } : prev));
      setAvatarMsg({ text: "Photo de profil mise à jour.", ok: true });
      // La photo compte dans la complétion : on la recharge pour que la jauge suive.
      void refreshCompletion();
    } else {
      const body = await res.json().catch(() => ({}));
      setAvatarMsg({
        text:
          body.error === "unsupported_file_type" ? "Format non supporté — JPG, PNG ou WEBP uniquement."
          : body.error === "file_too_large" ? "Fichier trop volumineux — 2 Mo maximum."
          : "Échec de l'envoi de la photo.",
        ok: false,
      });
    }
  }

  async function handleAvatarRemove() {
    setAvatarUploading(true);
    setAvatarMsg(null);
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    setAvatarUploading(false);
    if (res.ok) {
      setIdentity((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
      setAvatarMsg({ text: "Photo de profil retirée.", ok: true });
      void refreshCompletion();
    } else {
      setAvatarMsg({ text: "Échec de la suppression.", ok: false });
    }
  }

  async function refreshCompletion() {
    const res = await fetch("/api/profile/client");
    if (res.ok) setData(await res.json());
  }

  function toggleLanguage(lang: string) {
    setLanguages((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const form = new FormData(e.currentTarget);

    // Un champ vidé est envoyé comme chaîne vide, jamais omis : omettre voudrait dire
    // « ne touche pas », ce qui empêcherait d'effacer une valeur (voir la route PUT).
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const payload: Record<string, unknown> = {
      profession: text("profession"),
      clientType: clientType || undefined,
      company: clientType === "particulier" ? "" : text("company"),
      sector: clientType === "particulier" ? "" : text("sector"),
      languages,
      currency: text("currency") || "XOF",
      country: text("country") || undefined,
      city: text("city"),
      locality: text("locality"),
      address: text("address"),
    };

    const res = await fetch("/api/profile/client", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);

    if (res.ok) {
      setData(await res.json());
      setMsg({ text: "Profil enregistré.", ok: true });
    } else {
      const body = await res.json().catch(() => ({}));
      setMsg({ text: SAVE_ERROR_MESSAGES[body.error] ?? "Échec de l'enregistrement.", ok: false });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-[14px] text-zinc-500">Chargement...</div>
      </div>
    );
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition disabled:opacity-50";
  const btnSecondary = "h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 transition";
  const labelClass = "block text-[13px] font-semibold text-zinc-700 mb-1.5";
  const card = "bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden";
  const cardHead = "px-6 py-4 border-b border-zinc-100";

  const completion = data?.completion;
  const isOrganisation = clientType !== "" && clientType !== "particulier";

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[700px] space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1931]">Mon profil</h1>
          <p className="text-[13px] text-zinc-500 mt-1">
            Ces informations aident les prestataires à comprendre qui vous êtes. Rien n&apos;est obligatoire.
          </p>
        </div>

        {/* Complétion — calculée par le serveur (src/lib/client-profile-completion.ts),
            jamais recalculée ici : deux barèmes finiraient par diverger. */}
        {completion && (
          <div className={card}>
            <div className="px-6 py-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[13px] font-semibold text-zinc-700">Profil complété</span>
                <span className="text-[15px] font-bold text-[#008751]">{completion.percent} %</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full rounded-full bg-[#008751] transition-all" style={{ width: `${completion.percent}%` }} />
              </div>
              {completion.missing.length > 0 && (
                <p className="mt-3 text-[12px] text-zinc-500">
                  Il reste à renseigner : {completion.missing.map((m) => m.label.toLowerCase()).join(", ")}.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Photo de profil */}
        <div className={card}>
          <div className={cardHead}>
            <h2 className="text-[15px] font-bold text-zinc-900">Photo de profil</h2>
          </div>
          {avatarMsg && (
            <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-[13px] font-medium ${avatarMsg.ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {avatarMsg.text}
            </div>
          )}
          <div className="px-6 py-5 flex items-center gap-5">
            <Avatar
              src={identity?.avatarUrl}
              initials={identity ? initialsOf(identity.firstname, identity.lastname) : "?"}
              size={72}
              gradient="from-[#008751] to-[#FCD116]"
            />
            <div className="flex-1 space-y-2">
              <p className="text-[12px] text-zinc-500">
                Visible dans le menu et sur vos missions. JPG, PNG ou WEBP — 2 Mo max.
              </p>
              <div className="flex items-center gap-3">
                <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarSelect} className="hidden" />
                <button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} className={btnSecondary + " disabled:opacity-50"}>
                  {avatarUploading ? "Envoi..." : identity?.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
                </button>
                {identity?.avatarUrl && (
                  <button type="button" disabled={avatarUploading} onClick={handleAvatarRemove} className="text-[13px] font-medium text-red-600 hover:underline disabled:opacity-50">
                    Retirer
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Informations */}
          <div className={card}>
            <div className={`${cardHead} flex items-center justify-between`}>
              <h2 className="text-[15px] font-bold text-zinc-900">Informations</h2>
              <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaratif</span>
            </div>
            {msg && (
              <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-[13px] font-medium ${msg.ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`}>
                {msg.text}
              </div>
            )}
            <div className="px-6 py-5 grid md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="profession" className={labelClass}>Profession</label>
                <input id="profession" type="text" name="profession" defaultValue={data?.profile?.profession ?? ""} placeholder="Ex : Directeur d'exploitation" className={inputClass} />
              </div>
              <div>
                <label htmlFor="clientType" className={labelClass}>Type de client</label>
                <select id="clientType" name="clientType" value={clientType} onChange={(e) => setClientType(e.target.value)} className={inputClass}>
                  <option value="">Non précisé</option>
                  {CLIENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Organisation — masqué pour un particulier, qui n'en a pas. Les deux champs
              sortent aussi du barème de complétion dans ce cas. */}
          {isOrganisation && (
            <div className={card}>
              <div className={cardHead}>
                <h2 className="text-[15px] font-bold text-zinc-900">Organisation</h2>
              </div>
              <div className="px-6 py-5 grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="company" className={labelClass}>Nom de l&apos;organisation</label>
                  <input id="company" type="text" name="company" defaultValue={data?.profile?.company ?? ""} placeholder="Ex : SOBEBRA" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="sector" className={labelClass}>Secteur d&apos;activité</label>
                  <select id="sector" name="sector" defaultValue={data?.profile?.sector ?? ""} className={inputClass}>
                    <option value="">Non précisé</option>
                    {SECTORS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Localisation */}
          <div className={card}>
            <div className={cardHead}>
              <h2 className="text-[15px] font-bold text-zinc-900">Localisation</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="country" className={labelClass}>Pays</label>
                  <select id="country" name="country" defaultValue={data?.user.country ?? "BJ"} className={inputClass}>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="city" className={labelClass}>Ville</label>
                  <input id="city" type="text" name="city" defaultValue={data?.user.city ?? ""} placeholder="Cotonou" className={inputClass} />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="locality" className={labelClass}>Quartier</label>
                  <input id="locality" type="text" name="locality" defaultValue={data?.user.locality ?? ""} placeholder="Fidjrossè" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="address" className={labelClass}>Adresse complète</label>
                  <input id="address" type="text" name="address" defaultValue={data?.user.address ?? ""} placeholder="Rue 12.34, maison Adjovi" className={inputClass} />
                </div>
              </div>
            </div>
          </div>

          {/* Préférences */}
          <div className={card}>
            <div className={cardHead}>
              <h2 className="text-[15px] font-bold text-zinc-900">Préférences</h2>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <span className={labelClass}>Langues</span>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((lang) => {
                    const active = languages.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleLanguage(lang)}
                        aria-pressed={active}
                        className={`h-9 px-4 rounded-full text-[13px] font-medium border transition ${
                          active
                            ? "bg-[#008751] border-[#008751] text-white"
                            : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:w-1/2">
                <label htmlFor="currency" className={labelClass}>Devise</label>
                <select id="currency" name="currency" defaultValue={data?.profile?.currency ?? "XOF"} className={inputClass}>
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
