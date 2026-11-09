import Link from 'next/link'
import { countryFlag } from '@/lib/country-flag'
import { countryName } from '@/lib/world-countries'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'
import { getLatestMissions, publishedAgo } from '@/lib/latest-missions'

// « Dernières missions publiées » — composant serveur alimenté par la BASE, comme les talents
// (TalentsAfrique.tsx). Seuls les libellés sont éditables (/backoffice/content, section
// `latest_missions`) ; les missions affichées sont les dernières publiées, sans épinglage
// possible — une mise en avant à la main serait un critère non publié.
//
// Une carte ouvre la fiche mission — PUBLIQUE pour un visiteur non connecté depuis le 2026-11-09
// (src/components/mission/PublicMissionView.tsx) ; candidater exige toujours la connexion.
//
// Bouton « Candidater » (2026-11-03) : /missions/{id}?candidater=1. La fiche envoie le visiteur
// se connecter — ou s'inscrire, la destination suit tout le parcours d'inscription — puis
// l'y ramène avec le formulaire de candidature ouvert. La carte entière reste cliquable (le
// lien du titre la couvre) : un <a> ne peut pas en contenir un autre, d'où ce montage plutôt
// qu'une carte-lien englobante.
const MODE_LABEL = { presentiel: 'Sur site', distance: 'À distance', hybride: 'Hybride' } as const

export default async function LatestMissions() {
  const [missions, config] = await Promise.all([getLatestMissions(6), getPublishedFrontendConfig()])
  const section = resolveSection(config, 'latest_missions')
  if (!section) return null

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="page-shell">
        {section.subtitle && (
          <p className="text-sm font-medium uppercase tracking-[0.12em] text-[#E85A24] mb-3">{section.subtitle}</p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8 lg:mb-10">
          <h2 className="text-[30px] md:text-[40px] leading-[1.1] font-semibold text-[#0A1931]">
            {section.title ?? 'Dernières missions publiées'}
          </h2>
          {missions.length > 0 && section.ctaText && (
            <Link href={section.ctaLink ?? '/devenir-prestataire'} className="text-base font-semibold text-[#E85A24] hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>

        {missions.length === 0 ? (
          <div className="bg-[#F7F7F5] rounded-2xl p-8 lg:p-12 text-center">
            <p className="text-xl font-medium text-[#0A1931]">Aucune mission ouverte pour l&apos;instant</p>
            <p className="mt-2 text-gray-600 max-w-prose mx-auto">
              Décrivez votre besoin : les prestataires du métier sont prévenus dès la publication.
            </p>
            <Link
              href="/missions/new"
              className="inline-block mt-6 bg-[#FF6B35] hover:bg-[#E85A24] text-white px-6 py-3 rounded-lg font-semibold transition"
            >
              Publier une mission
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {missions.map((m) => (
              <li key={m.id}>
                <div className="group relative h-full flex flex-col rounded-xl bg-[#F7F7F5] border border-transparent p-5 hover:border-[#FF6B35]/40 hover:bg-white hover:shadow-sm transition">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="min-w-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0A1931] truncate">
                      {m.icon && <span aria-hidden className="mr-1">{m.icon}</span>}
                      {m.metier}
                    </span>
                    {m.urgent && (
                      <span className="ml-auto shrink-0 rounded-full bg-[#FFF1EB] px-2 py-0.5 text-[11px] font-semibold text-[#E85A24]">Urgent</span>
                    )}
                  </div>
                  <h3 className="mt-3 text-[17px] font-semibold leading-snug text-[#0A1931] group-hover:text-[#E85A24] transition line-clamp-2">
                    <Link
                      href={`/missions/${m.id}`}
                      className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      {m.titre}
                    </Link>
                  </h3>

                  {/* Ligne « auteur » au modèle des cartes « Nouveaux services publiés » (LatestGigs) :
                      avatar · nom · drapeau · badge. Le client n'est jamais nommé sur une vitrine
                      publique (E-04) : avatar neutre et « Client » à la place de son nom et de sa
                      photo — son pays et son statut de vérification suffisent à situer la demande. */}
                  <div className="mt-3 flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-[#0A1931] text-white grid place-items-center shrink-0" aria-hidden>
                      <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                        <circle cx="10" cy="7" r="3.2" />
                        <path d="M3.8 16.5c1.1-3 3.4-4.5 6.2-4.5s5.1 1.5 6.2 4.5" />
                      </svg>
                    </span>
                    <span className="text-[13px] font-medium text-[#0A1931] truncate">Client</span>
                    {m.clientCountry && (
                      <span
                        role="img"
                        aria-label={`Client : ${countryName(m.clientCountry) ?? m.clientCountry}`}
                        title={countryName(m.clientCountry) ?? m.clientCountry}
                        className="text-[16px] leading-none shrink-0"
                      >
                        {countryFlag(m.clientCountry)}
                      </span>
                    )}
                    {m.clientVerified ? (
                      <span className="shrink-0 rounded-full bg-[#E8F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#008751]">✓ Vérifié</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Identité non vérifiée</span>
                    )}
                  </div>

                  <p className="mt-2 text-[13px] text-gray-500">
                    {m.mode === 'distance' ? MODE_LABEL.distance : [MODE_LABEL[m.mode], m.ville].filter(Boolean).join(' · ')}
                    {' · '}
                    <time dateTime={m.createdAt.toISOString()}>{publishedAgo(m.createdAt)}</time>
                    {' · '}
                    {m.candidatures} candidature{m.candidatures > 1 ? 's' : ''}
                  </p>
                  {/* « Candidater » à la MÊME place que « Commander » sur les cartes de services
                      (LatestGigs) : en bas à droite, face au montant (2026-11-08). */}
                  <div className="mt-auto pt-4 flex items-center justify-between gap-3">
                    <span className="text-[15px] font-semibold text-[#0A1931]">{m.budgetLabel}</span>
                    <Link
                      href={`/missions/${m.id}?candidater=1`}
                      aria-label={`Candidater — ${m.titre}`}
                      className="relative z-10 shrink-0 rounded-lg bg-[#FF6B35] hover:bg-[#E85A24] px-4 py-2 text-[13px] font-semibold text-white transition"
                      style={{ textDecoration: 'none' }}
                    >
                      Candidater
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
