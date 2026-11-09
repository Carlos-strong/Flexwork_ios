import Link from 'next/link'
import { countryFlag } from '@/lib/country-flag'
import { countryName } from '@/lib/world-countries'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'
import { getLatestGigs } from '@/lib/latest-gigs'
import { publishedAgo } from '@/lib/latest-missions'

// « Nouveaux services publiés » — composant serveur alimenté par la BASE, pendant de
// LatestMissions.tsx. Seuls les libellés sont éditables (/backoffice/content, section
// `latest_gigs`) ; l'ordre est celui de getLatestGigs : badge « Vérifié » d'abord, puis récence.
//
// Une carte ouvre le Gig dans le catalogue client (/client/offres?gig=…). Non connecté, le
// visiteur passe par /signin et y revient.
//
// Bouton « Commander » (2026-11-03) : même destination — la fiche du Gig, où se trouve le
// bouton d'achat. Il n'achète rien lui-même : un paiement se confirme sur l'écran qui en
// montre le prix et les conditions. Montage carte/lien : voir LatestMissions.tsx.
export default async function LatestGigs() {
  const [gigs, config] = await Promise.all([getLatestGigs(6), getPublishedFrontendConfig()])
  const section = resolveSection(config, 'latest_gigs')
  if (!section) return null

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="page-shell">
        {section.subtitle && (
          <p className="text-sm font-medium uppercase tracking-[0.12em] text-[#E85A24] mb-3">{section.subtitle}</p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8 lg:mb-10">
          <h2 className="text-[30px] md:text-[40px] leading-[1.1] font-semibold text-[#0A1931]">
            {section.title ?? 'Nouveaux services publiés'}
          </h2>
          {gigs.length > 0 && section.ctaText && (
            <Link href={section.ctaLink ?? '/client/offres'} className="text-base font-semibold text-[#E85A24] hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>

        {gigs.length === 0 ? (
          <div className="bg-[#F7F7F5] rounded-2xl p-8 lg:p-12 text-center">
            <p className="text-xl font-medium text-[#0A1931]">Aucun service publié pour l&apos;instant</p>
            <p className="mt-2 text-gray-600 max-w-prose mx-auto">
              Prestataire vérifié ? Proposez une prestation à prix fixe : les clients l&apos;achètent en quelques clics, paiement sous séquestre.
            </p>
            <Link
              href="/devenir-prestataire"
              className="inline-block mt-6 bg-[#FF6B35] hover:bg-[#E85A24] text-white px-6 py-3 rounded-lg font-semibold transition"
            >
              Proposer un service
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {gigs.map((g) => (
              <li key={g.id}>
                <div className="group relative h-full flex flex-col rounded-xl bg-[#F7F7F5] border border-transparent p-5 hover:border-[#FF6B35]/40 hover:bg-white hover:shadow-sm transition">
                  <span className="self-start rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0A1931] truncate max-w-full">{g.domaine}</span>
                  <h3 className="mt-3 text-[17px] font-semibold leading-snug text-[#0A1931] group-hover:text-[#E85A24] transition line-clamp-2">
                    {/* La carte ouvre la page PUBLIQUE du service (2026-11-08) — regarder ne demande
                        pas de compte. « Commander » garde le chemin direct vers la commande. */}
                    <Link
                      href={`/services/${encodeURIComponent(g.id)}?returnTo=%2F`}
                      className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      {g.titre}
                    </Link>
                  </h3>

                  <div className="mt-3 flex items-center gap-2.5 min-w-0">
                    {g.provider.avatarSrc ? (
                      // Avatar servi par une route de l'application, pas un fichier statique : <img>
                      // comme PersonCard, next/image n'y apporterait rien.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.provider.avatarSrc} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-[#0A1931] text-white text-[11px] font-bold grid place-items-center shrink-0" aria-hidden>
                        {g.provider.initials}
                      </span>
                    )}
                    <span className="text-[13px] font-medium text-[#0A1931] truncate">{g.provider.name}</span>
                    {g.provider.country && (
                      <span role="img" aria-label={countryName(g.provider.country) ?? g.provider.country} title={countryName(g.provider.country) ?? g.provider.country} className="text-[16px] leading-none shrink-0">
                        {countryFlag(g.provider.country)}
                      </span>
                    )}
                    {g.provider.badgeVerified && (
                      <span className="shrink-0 rounded-full bg-[#E8F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#008751]">✓ Vérifié</span>
                    )}
                  </div>

                  <p className="mt-2 text-[13px] text-gray-500">
                    Livré sous {g.delaiJours} jour{g.delaiJours > 1 ? 's' : ''}
                    {' · '}
                    <time dateTime={g.createdAt.toISOString()}>{publishedAgo(g.createdAt)}</time>
                    {' · '}
                    {g.commandes} commande{g.commandes > 1 ? 's' : ''}
                  </p>
                  <div className="mt-auto pt-4 flex items-center justify-between gap-3">
                    <span className="text-[15px] font-semibold text-[#0A1931]">
                      {g.hasPackages && <span className="text-[12px] font-normal text-gray-500">À partir de </span>}
                      {g.prixLabel}
                    </span>
                    <Link
                      href={`/client/offres?gig=${encodeURIComponent(g.id)}`}
                      aria-label={`Commander — ${g.titre}`}
                      className="relative z-10 shrink-0 rounded-lg bg-[#FF6B35] hover:bg-[#E85A24] px-4 py-2 text-[13px] font-semibold text-white transition"
                      style={{ textDecoration: 'none' }}
                    >
                      Commander
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
