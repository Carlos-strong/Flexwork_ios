"use client";

// Briques partagées des onglets du profil prestataire (2026-09-23).
//
// Extraites quand le formulaire d'une seule page est devenu cinq onglets : sans ça, chacun
// des cinq recopiait ses styles, ses messages d'erreur et son bandeau de sauvegarde — et
// cinq copies finissent par diverger à la première retouche.

import type { ReactNode } from "react";

/** Profil prestataire tel que le renvoie GET /api/profile (tous les champs sont optionnels). */
export type ProviderProfile = {
  id: string;
  mainDomain: string;
  secondaryDomain?: string | null;
  indicativeRate?: number | null;
  portfolioUrls?: string[];
  cvUrl?: string | null;
  tags?: string[];
  description?: string | null;
  tarifUnite?: string | null;
  zonePays?: string | null;
  zoneVille?: string | null;
  zoneRayonKm?: number | null;
  // Onglet 3 — niveau et années (le reste de l'onglet vient des déclarations)
  declaredLevel?: string | null;
  declaredExperienceYears?: number | null;
  // Onglet 1
  title?: string | null;
  providerKind?: string | null;
  // Métier du catalogue (2026-09-23) — la clé, distincte de `mainDomain` qui n'en est que le
  // libellé. C'est elle qui permet de rouvrir la cascade sur le métier déjà choisi.
  metierId?: string | null;
  // Onglet 4
  workModes?: string[];
  coverageZones?: string[];
  availability?: string | null;
  // Onglet 5
  currency?: string | null;
  // Formulaire prestataire aligné sur le modèle (2026-09-23)
  overview?: string | null;
  quartier?: string | null;
  deplacement?: string[];
  modeContact?: string | null;
  // Badge
  badgeStatus?: string | null;
};

export type ProviderIdentity = {
  firstname: string | null;
  lastname: string | null;
  fullName: string;
  avatarUrl: string | null;
};

export const inputClass =
  "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
export const labelClass = "block text-[13px] font-medium text-zinc-700 mb-1.5";
export const btnPrimary =
  "h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition disabled:opacity-50";
export const btnSecondary =
  "h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 transition";

// Messages des refus renvoyés par POST /api/profile — repris tels quels de l'ancien
// formulaire d'une page, pour que le passage en onglets ne perde aucun message clair.
export const PROFILE_ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "Votre session a expiré — reconnectez-vous puis réessayez.",
  invalid_payload:
    "Une valeur saisie n'est pas acceptée : vérifiez le métier, les compétences et le tarif indicatif (positif s'il est renseigné).",
  profile_below_minimum_age:
    "Ce profil ne peut pas être activé : l'âge minimum requis pour cette filière n'est pas atteint.",
  // Un âge INCONNU n'est pas un âge insuffisant : la date de naissance est relevée sur la pièce
  // par l'équipe KYC, jamais saisie par l'intéressé. Le dire change tout — l'un se règle en
  // ouvrant son dossier, l'autre ne se règle pas.
  kyc_required_for_age:
    "Votre identité doit d'abord être vérifiée : la date de naissance est relevée sur votre pièce d'identité par l'équipe KYC.",
  // Identité déjà vérifiée, date manquante : ne pas renvoyer l'intéressé vers un dossier qui
  // n'attend plus rien de lui.
  birth_date_missing:
    "Votre identité est vérifiée, mais la date de naissance n'a pas été relevée sur votre pièce. Elle est obligatoire pour cette filière : signalez-le au support.",
  not_found: "Compte introuvable — reconnectez-vous puis réessayez.",
  // Le métier a été retiré ou renommé dans le catalogue entre l'ouverture de l'onglet et
  // l'enregistrement : le seul geste utile est d'en choisir un autre.
  metier_not_found:
    "Ce métier n'existe plus dans le catalogue. Rechargez la page puis choisissez un autre métier.",
  main_domain_required:
    "Choisissez votre métier principal — sans lui, votre profil ne peut être rapproché d'aucune mission.",
};

/** Message affiché quand la requête n'a pas pu partir ou n'a pas reçu de réponse. */
export const NETWORK_ERROR_MESSAGE =
  "Connexion impossible — vérifiez votre réseau, puis réessayez. Rien n'a été enregistré.";

// Champs de `profileSchema` → ce que l'utilisateur doit corriger. `invalid_payload` arrive avec
// `details.fieldErrors` : le nommer évite le message fourre-tout qui citait le tarif indicatif
// sur un onglet qui n'en affiche pas.
const PROFILE_FIELD_HINTS: Record<string, string> = {
  mainDomain: "le métier principal",
  metierId: "le métier principal",
  tags: "les compétences (120 caractères au plus chacune, 10 au total)",
  indicativeRate: "le tarif indicatif (un montant positif)",
  description: "la bio courte (2 000 caractères au plus)",
  overview: "la présentation détaillée (5 000 caractères au plus)",
  title: "le titre professionnel (120 caractères au plus)",
  zoneVille: "la ville (100 caractères au plus)",
  zoneRayonKm: "le rayon d'intervention (entre 1 et 500 km)",
  coverageZones: "les zones couvertes",
};

/**
 * Traduit une réponse d'échec de POST /api/profile en message affichable. `body` est le JSON
 * lu (ou `{}` si la réponse n'en était pas) : un code connu donne son message, `invalid_payload`
 * nomme les champs refusés, le reste retombe sur un message selon le statut.
 */
export function profileErrorMessage(
  body: { error?: string; details?: { fieldErrors?: Record<string, unknown> } },
  status: number,
): string {
  if (body.error === "invalid_payload") {
    const hints = Object.keys(body.details?.fieldErrors ?? {})
      .map((field) => PROFILE_FIELD_HINTS[field])
      .filter((hint, i, all): hint is string => !!hint && all.indexOf(hint) === i);
    return hints.length > 0
      ? `Une valeur saisie n'est pas acceptée — vérifiez ${hints.join(", ")}.`
      : "Une valeur saisie n'est pas acceptée. Vérifiez les champs de cet onglet.";
  }
  if (body.error && PROFILE_ERROR_MESSAGES[body.error]) return PROFILE_ERROR_MESSAGES[body.error];
  if (status >= 500) return "Erreur serveur inattendue — réessayez dans un instant.";
  return "Échec de l'enregistrement.";
}

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelClass}>
        {label} {required && <span className="text-[#E8112D]">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}

/** Bandeau de résultat d'une sauvegarde d'onglet — succès comme échec. */
export function SaveBanner({ message }: { message: { text: string; ok: boolean } | null }) {
  if (!message) return null;
  return (
    <div
      className={`rounded-xl px-4 py-3 text-[13px] ${
        message.ok
          ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
          : "bg-red-50 border border-red-200 text-red-800"
      }`}
    >
      {message.text}
    </div>
  );
}

/** Pied de carte : bouton d'enregistrement + bandeau, identique sur les cinq onglets. */
export function SaveRow({
  saving,
  message,
  label = "Enregistrer",
}: {
  saving: boolean;
  message: { text: string; ok: boolean } | null;
  label?: string;
}) {
  return (
    <div className="pt-1 space-y-3">
      <button type="submit" disabled={saving} className={btnPrimary}>
        {saving ? "Enregistrement..." : label}
      </button>
      <SaveBanner message={message} />
    </div>
  );
}

/** Carte d'une section d'onglet — même enveloppe pour toutes, pour que la page se lise d'un bloc. */
export function ProfileCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-[20px] border border-gray-100 p-6">
      <h2 className="text-[15px] font-semibold text-[#0A1931]">{title}</h2>
      {description && <p className="mt-1 text-[12px] text-zinc-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
