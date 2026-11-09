"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
  const router = useRouter();
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

    if (res.ok) {
      // Enregistré : retour automatique au tableau de bord (2026-10-06). Le bouton reste
      // désactivé pendant la transition — pas de double envoi — et `refresh` fait relire au
      // tableau de bord son pourcentage de complétion, qui vient de changer.
      setMsg({ text: "Profil enregistré — retour au tableau de bord…", ok: true });
      router.push("/client/dashboard");
      router.refresh();
      return;
    }
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    setMsg({ text: SAVE_ERROR_MESSAGES[body.error] ?? "Échec de l'enregistrement.", ok: false });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-[14px] text-zinc-500">Chargement...</div>
      </div>
    );
  }

  // Formulaire au format standard (2026-10-06) : en-tête avec retour au tableau de bord, UNE
  // carte dont les sections sont séparées par un filet, et une barre d'actions en pied de carte
  // — collée au bas de l'écran sur mobile, pour qu'« Enregistrer » reste à portée de pouce.
  // Le message d'enregistrement s'affiche dans cette barre, là où l'utilisateur vient de cliquer.
  const inputClass = "w-full h-11 px-3.5 rounded-lg border border-zinc-300 bg-white text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-11 px-6 rounded-full bg-[#008751] text-white text-[14px] font-semibold hover:bg-[#006e43] transition disabled:opacity-50";
  const btnSecondary = "h-10 px-4 rounded-full border border-zinc-300 bg-white text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 transition";
  const labelClass = "block text-[13px] font-medium text-zinc-700 mb-1.5";
  const section = "px-5 py-6 sm:px-8 sm:py-7";
  const sectionTitle = "text-[16px] font-semibold text-zinc-900";
  const sectionHint = "mt-1 text-[13px] text-zinc-500";
  const alertClass = (ok: boolean) =>
    `px-4 py-3 rounded-lg text-[13px] font-medium ${ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`;

  const completion = data?.completion;
  const isOrganisation = clientType !== "" && clientType !== "particulier";

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6 sm:py-10">
      <div className="mx-auto fluid-form [--fw:720px]">
        {/* En-tête */}
        <Link href="/client/dashboard" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 hover:text-zinc-900 transition">
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Tableau de bord
        </Link>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-[#0A1931]">Mon profil</h1>
            <p className="mt-1 text-[14px] text-zinc-500">
              Ces informations aident les prestataires à comprendre qui vous êtes. Rien n&apos;est obligatoire.
            </p>
          </div>
          {/* Complétion — calculée par le serveur (src/lib/client-profile-completion.ts),
              jamais recalculée ici : deux barèmes finiraient par diverger. */}
          {completion && (
            <div className="shrink-0 sm:w-44">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="font-medium text-zinc-600">Profil complété</span>
                <span className="font-bold text-[#008751]">{completion.percent} %</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-zinc-200 overflow-hidden">
                <div className="h-full rounded-full bg-[#008751] transition-all" style={{ width: `${completion.percent}%` }} />
              </div>
            </div>
          )}
        </div>
        {completion && completion.missing.length > 0 && (
          <p className="mt-3 text-[12px] text-zinc-500">
            Il reste à renseigner : {completion.missing.map((m) => m.label.toLowerCase()).join(", ")}.
          </p>
        )}

        {/* Carte unique */}
        <div className="mt-6 bg-white rounded-2xl border border-zinc-200 shadow-sm divide-y divide-zinc-100">
          {/* Photo — envoyée à part (API avatar), d'où sa place hors du <form>. */}
          <section className={section}>
            <h2 className={sectionTitle}>Photo de profil</h2>
            <p className={sectionHint}>Visible dans le menu et sur vos missions. JPG, PNG ou WEBP — 2 Mo max.</p>
            {avatarMsg && <div className={`mt-4 ${alertClass(avatarMsg.ok)}`}>{avatarMsg.text}</div>}
            <div className="mt-4 flex items-center gap-4">
              <Avatar
                src={identity?.avatarUrl}
                initials={identity ? initialsOf(identity.firstname, identity.lastname) : "?"}
                size={64}
                gradient="from-[#008751] to-[#FCD116]"
              />
              <div className="flex flex-wrap items-center gap-3">
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
          </section>

          <form onSubmit={handleSubmit} className="divide-y divide-zinc-100">
            {/* Informations */}
            <section className={section}>
              <div className="flex items-center justify-between gap-3">
                <h2 className={sectionTitle}>Informations</h2>
                <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaratif</span>
              </div>
              <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
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
                {/* Organisation — masquée pour un particulier, qui n'en a pas. Les deux champs
                    sortent aussi du barème de complétion dans ce cas. */}
                {isOrganisation && (
                  <>
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
                  </>
                )}
              </div>
            </section>

            {/* Localisation */}
            <section className={section}>
              <h2 className={sectionTitle}>Localisation</h2>
              <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
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
                <div>
                  <label htmlFor="locality" className={labelClass}>Quartier</label>
                  <input id="locality" type="text" name="locality" defaultValue={data?.user.locality ?? ""} placeholder="Fidjrossè" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="address" className={labelClass}>Adresse complète</label>
                  <input id="address" type="text" name="address" defaultValue={data?.user.address ?? ""} placeholder="Rue 12.34, maison Adjovi" className={inputClass} />
                </div>
              </div>
            </section>

            {/* Préférences */}
            <section className={section}>
              <h2 className={sectionTitle}>Préférences</h2>
              <fieldset className="mt-5">
                <legend className={labelClass}>Langues</legend>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((lang) => {
                    const active = languages.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleLanguage(lang)}
                        aria-pressed={active}
                        className={`h-9 px-3.5 rounded-full text-[13px] font-medium border transition ${
                          active
                            ? "bg-[#008751] border-[#008751] text-white"
                            : "bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="mt-5 sm:w-1/2 sm:pr-2">
                <label htmlFor="currency" className={labelClass}>Devise</label>
                <select id="currency" name="currency" defaultValue={data?.profile?.currency ?? "XOF"} className={inputClass}>
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </section>

            {/* Barre d'actions — collée au bas de l'écran sur mobile. */}
            <div className="sticky bottom-0 z-10 rounded-b-2xl bg-white/95 backdrop-blur px-5 py-4 sm:static sm:px-8 sm:py-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              {msg && <div className={`sm:mr-auto ${alertClass(msg.ok)}`} role="status">{msg.text}</div>}
              <Link href="/client/dashboard" className="hidden sm:inline-flex h-11 items-center px-5 rounded-full text-[14px] font-medium text-zinc-600 hover:bg-zinc-100 transition">
                Annuler
              </Link>
              <button type="submit" disabled={saving} className={btnPrimary + " w-full sm:w-auto"}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
