"use client";

// Fiche publique d'une mission (2026-11-09) — affichée à un visiteur NON connecté sur
// /missions/[id]. Données filtrées par le serveur (src/lib/public-mission.ts) : jamais le nom du
// client, ni le cahier des charges, ni les pièces jointes. Candidater exige de se connecter (ou
// de s'inscrire) : on y retourne ensuite, formulaire de candidature ouvert (`?candidater=1`).

import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { countryFlag } from "@/lib/country-flag";
import { countryName } from "@/lib/world-countries";
import { PROFESSIONAL_TYPE_LABELS } from "@/lib/provider-options";
import { withCallbackUrl } from "@/lib/safe-callback";
import type { PublicMission } from "@/lib/public-mission";

const MODE_LABEL = { presentiel: "Sur site", distance: "À distance", hybride: "Hybride" } as const;
const fmt = (n: number) => n.toLocaleString("fr-FR");

function budgetLabel(m: PublicMission) {
  if (!m.isQuote) return `${fmt(m.budget)} ${m.currency}`;
  if (m.budgetMin && m.budgetMax) return `${fmt(m.budgetMin)} – ${fmt(m.budgetMax)} ${m.currency}`;
  return "Sur devis";
}

export function PublicMissionView({ mission: m }: { mission: PublicMission }) {
  const applyHref = withCallbackUrl("/signin", `/missions/${m.id}?candidater=1`);
  const signupHref = withCallbackUrl("/signup", `/missions/${m.id}?candidater=1`);
  const lieu = m.mode === "distance" ? MODE_LABEL.distance : [MODE_LABEL[m.mode], m.ville, countryName(m.pays) ?? m.pays].filter(Boolean).join(" · ");
  const full = m.maxCandidatures !== null && m.candidatures >= m.maxCandidatures;
  const applyLabel = m.isQuote ? "Envoyer un devis" : "Candidater";

  const facts: { label: string; value: string }[] = [
    { label: "Lieu", value: lieu },
    ...(m.dateDebut ? [{ label: "Début", value: new Date(m.dateDebut).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) }] : []),
    { label: "Délai", value: `${m.delaiJours} jour${m.delaiJours > 1 ? "s" : ""}` },
    ...(m.professionalType ? [{ label: "Profil recherché", value: PROFESSIONAL_TYPE_LABELS[m.professionalType] ?? m.professionalType }] : []),
    ...(m.requiredLevel ? [{ label: "Niveau", value: m.requiredLevel }] : []),
    {
      label: "Candidatures",
      value: m.maxCandidatures !== null ? `${m.candidatures} sur ${m.maxCandidatures}` : String(m.candidatures),
    },
  ];

  return (
    <main className="min-h-screen bg-[#F8FAF9]">
      <div className="mx-auto max-w-[1080px] px-4 py-6 md:py-10">
        <BackLink href="/" label="Retour à l'accueil" />

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
          <article className="min-w-0 rounded-2xl border border-[#E2E8F0] bg-white p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#F7F7F5] px-2.5 py-1 text-[11px] font-semibold text-[#0A1931]">
                {m.icon && <span aria-hidden className="mr-1">{m.icon}</span>}
                {m.metier}
              </span>
              {m.urgent && <span className="rounded-full bg-[#FFF1EB] px-2 py-0.5 text-[11px] font-semibold text-[#E85A24]">Urgent</span>}
              <span className="text-[12px] text-zinc-500">Publiée {m.publishedAgo}</span>
            </div>
            <h1 className="mt-3 text-[22px] md:text-[26px] font-bold leading-tight text-[#0A1931]">{m.titre}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium text-[#0A1931]">Client</span>
              {m.clientCountry && (
                <span role="img" aria-label={`Client : ${countryName(m.clientCountry) ?? m.clientCountry}`} className="text-[16px] leading-none">
                  {countryFlag(m.clientCountry)}
                </span>
              )}
              {m.clientVerified ? (
                <span className="rounded-full bg-[#E8F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#008751]">✓ Identité vérifiée</span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Identité non vérifiée</span>
              )}
            </div>

            <h2 className="mt-6 text-[15px] font-bold text-[#0A1931]">Description du besoin</h2>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-zinc-700">{m.description}</p>

            {m.competences.length > 0 && (
              <>
                <h2 className="mt-6 text-[15px] font-bold text-[#0A1931]">Compétences recherchées</h2>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {m.competences.map((c) => (
                    <li key={c} className="rounded-full bg-[#f0faf5] px-2.5 py-0.5 text-[12px] font-medium text-[#008751]">
                      {c}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="mt-6 rounded-xl bg-[#F7F7F5] px-4 py-3 text-[12.5px] leading-relaxed text-zinc-600">
              Le cahier des charges, les documents joints et l&apos;identité du client sont communiqués aux prestataires
              connectés qui candidatent.
            </p>
          </article>

          <aside className="h-fit space-y-3 lg:sticky lg:top-4">
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
              <p className="text-[12px] font-medium uppercase tracking-wide text-zinc-500">{m.isQuote ? "Budget indicatif" : "Budget"}</p>
              <p className="mt-1 text-[24px] font-bold text-[#0A1931]">{budgetLabel(m)}</p>
              <dl className="mt-4 space-y-2 text-[13px]">
                {facts.map((f) => (
                  <div key={f.label} className="flex justify-between gap-3">
                    <dt className="text-zinc-500">{f.label}</dt>
                    <dd className="text-right font-medium text-[#0A1931]">{f.value}</dd>
                  </div>
                ))}
              </dl>
              {full ? (
                <p className="mt-5 rounded-xl bg-zinc-100 px-4 py-3 text-center text-[13px] text-zinc-600">
                  Le nombre maximal de candidatures est atteint.
                </p>
              ) : (
                <>
                  <a
                    href={applyHref}
                    className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-[#FF6B35] text-[14px] font-semibold text-white hover:bg-[#E85A24]"
                    style={{ textDecoration: "none" }}
                  >
                    {applyLabel}
                  </a>
                  <p className="mt-2 text-center text-[12px] text-zinc-500">
                    Connexion requise.{" "}
                    <a href={signupHref} className="font-semibold text-[#008751] hover:underline">
                      Créer un compte
                    </a>
                  </p>
                </>
              )}
            </div>
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 text-[12.5px] leading-relaxed text-zinc-600">
              <span className="font-semibold text-[#0A1931]">Paiement sous séquestre.</span> Les fonds sont bloqués par FlexWork et
              versés au prestataire après validation du travail.
            </div>
            <Link href="/missions/new" className="block text-center text-[13px] font-medium text-[#008751] hover:underline">
              Vous avez un besoin ? Publier une mission
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
