"use client";

// Écran P4 — Choix du rôle (décision « Option C »).
//
// ── Ce que cet écran change ─────────────────────────────────────────────────────────────
//
// Le rôle est CLIENT par défaut, et il l'est pour tout le monde. Devenir prestataire est une
// ACTION explicite, pas un état déduit : un compte qui a ouvert un formulaire par curiosité
// n'a pas demandé à candidater. Avant cette route, il n'existait aucun chemin — `role`
// n'était écrit qu'à la création du compte, et un client qui voulait proposer ses services
// devait ouvrir un SECOND compte, avec une seconde vérification d'identité.
//
// ── Ce que cet écran ne promet pas ──────────────────────────────────────────────────────
//
// Ouvrir l'espace prestataire n'accorde AUCUNE vérification : le KYC reste à faire, et c'est
// lui — pas ce choix — qui autorise à candidater. Le texte le dit, pour qu'un utilisateur ne
// découvre pas le KYC au moment de sa première candidature.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PROVIDER_ROLES, PROVIDER_ROLE_LABELS } from "@/lib/provider-options";

// Les libellés viennent de la source unique (PROVIDER_ROLE_LABELS) ; seules les descriptions
// vivent ici. Elles décrivent une FAÇON D'EXERCER, pas un métier : « Prestataire indépendant »
// ne dit plus « digital », et « Entreprise » ne dit plus « BTP » (renommage 2026-09-24).
const ROLE_DESCRIPTIONS: Record<string, string> = {
  expert_digital: "Vous travaillez à votre compte : conseil, études, développement, design, rédaction — à distance ou en hybride.",
  expert_btp_autres: "Vous engagez une structure : chantiers, études et suivi de travaux, expertise technique, avec une équipe.",
  artisan: "Plomberie, électricité, maçonnerie, peinture, carrelage — interventions sur site.",
  manoeuvre: "Aide, manutention, préparation de chantier — contrats au temps ou à la journée.",
};

const BECOME_ERRORS: Record<string, string> = {
  unauthenticated: "Votre session a expiré — reconnectez-vous.",
  invalid_payload: "Choisissez le type d'activité qui vous correspond.",
  already_provider: "Votre espace prestataire est déjà ouvert.",
  profile_below_minimum_age: "L'âge minimum requis pour cette filière n'est pas atteint.",
  // Un âge INCONNU n'est pas un âge insuffisant (2026-09-24). La date de naissance n'est
  // saisissable par personne côté utilisateur : elle est relevée sur la pièce d'identité par
  // l'équipe KYC. Sur les trois filières chantier, ce refus est donc la PREMIÈRE marche à
  // franchir — il doit dire quoi faire, et où.
  kyc_required_for_age:
    "Votre identité doit d'abord être vérifiée : la date de naissance est relevée sur votre pièce d'identité par l'équipe KYC. Ouvrez votre dossier — la filière s'activera ensuite.",
  // Identité DÉJÀ vérifiée, date manquante : renvoyer vers le dossier n'aurait aucun sens, il
  // n'y a plus rien à y déposer.
  birth_date_missing:
    "Votre identité est vérifiée, mais la date de naissance n'a pas été relevée sur votre pièce. Elle est obligatoire pour cette filière : signalez-le au support pour qu'elle soit complétée.",
};

// Vers où envoyer celui dont l'identité manque. Sans ce lien, le refus est une impasse : rien
// dans la navigation ne mène au dossier depuis cet écran.
const BECOME_ERROR_LINKS: Record<string, string> = {
  kyc_required_for_age: "/kyc",
};

export function BecomeProviderForm({ returnTo = null }: { returnTo?: string | null } = {}) {
  const router = useRouter();
  const [providerType, setProviderType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean; href?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!providerType) {
      setMsg({ text: "Choisissez le type d'activité qui vous correspond.", ok: false });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    const res = await fetch("/api/profile/become-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerType }),
    });
    if (res.ok) {
      // Direction l'onglet Domaines : c'est lui qui crée le profil, et donc la clé de
      // rapprochement dont tout le reste dépend. Présentation se remplit très bien après.
      // Arrivé ici depuis une mission (« Candidater » sur l'accueil) : retour sur la mission.
      // Navigation complète, pas router.push : la session en mémoire porte encore le rôle
      // client, et la page mission n'afficherait pas le formulaire de candidature.
      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }
      router.push("/profile?tab=domaines&bienvenue=1");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    setMsg({
      text: BECOME_ERRORS[data.error] ?? "Échec de l'activation. Réessayez dans un instant.",
      ok: false,
      href: BECOME_ERROR_LINKS[data.error],
    });
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto fluid-form [--fw:720px] space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1931]">Bienvenue sur FlexWork 👋</h1>
          <p className="mt-1 text-[13px] text-zinc-500">Votre compte est prêt.</p>
        </div>

        {/* L'état actuel est affiché AVANT toute action : « vous êtes client » n'est pas une
            étape à franchir, c'est un point de départ qui reste valable si l'on ne fait rien. */}
        <div className="bg-white rounded-[20px] border border-gray-100 p-5">
          <p className="text-[13px] text-zinc-500">Vous êtes actuellement :</p>
          <p className="mt-1 inline-flex items-center rounded-full bg-[#0A1931] px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-white">
            Client (par défaut)
          </p>
          <p className="mt-3 text-[12px] text-zinc-500">
            Vous pouvez publier des missions et acheter des offres dès maintenant — c&apos;est déjà possible.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-white rounded-[20px] border border-gray-100 p-6">
            <h2 className="text-[15px] font-semibold text-[#0A1931]">Souhaitez-vous proposer vos services ?</h2>
            <p className="mt-1 text-[12px] text-zinc-500">
              Ouvrir l&apos;espace prestataire vous permet de candidater aux missions et de publier des offres. Cela
              n&apos;accorde aucune vérification : votre dossier d&apos;identité reste à compléter, et c&apos;est lui qui
              vous autorise à postuler.
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="text-[13px] font-medium text-zinc-700 mb-2">
                Type d&apos;activité <span className="text-[#E8112D]">*</span>
              </legend>
              {PROVIDER_ROLES.map((role) => (
                <label
                  key={role}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                    providerType === role ? "border-[#008751] bg-[#008751]/5" : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="providerType"
                    value={role}
                    checked={providerType === role}
                    onChange={() => setProviderType(role)}
                    className="mt-0.5 accent-[#008751]"
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-[#0A1931]">
                      {PROVIDER_ROLE_LABELS[role] ?? role}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-zinc-500">{ROLE_DESCRIPTIONS[role]}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition disabled:opacity-50"
              >
                {submitting ? "Activation..." : "Activer l'espace prestataire"}
              </button>
              <Link
                href="/client/dashboard"
                className="h-10 px-5 rounded-full bg-white border border-zinc-200 text-[13px] font-medium text-zinc-600 flex items-center hover:bg-zinc-50"
                style={{ textDecoration: "none" }}
              >
                Plus tard — rester client
              </Link>
            </div>
            {msg && (
              <div className={`mt-3 rounded-xl px-4 py-3 text-[12px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
                <p>{msg.text}</p>
                {msg.href && (
                  <Link href={msg.href} className="mt-2 inline-block font-semibold underline">
                    Vérifier mon identité →
                  </Link>
                )}
              </div>
            )}
          </div>
        </form>

        <p className="text-[12px] text-zinc-500">
          ⓘ Vous pourrez revenir sur cet écran à tout moment depuis « Devenir prestataire » dans votre navigation.
        </p>
      </div>
    </div>
  );
}
