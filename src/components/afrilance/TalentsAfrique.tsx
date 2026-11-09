import Link from 'next/link'
import { PersonCard } from '@/components/person-card'
import { getFeaturedProviders } from '@/lib/featured-providers'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'
import {
  PROVIDER_ROLE_LABEL,
  providerDisplayName,
  providerInitials,
  providerPriceLabel,
} from '@/lib/provider-display'

// Section « Talents » de la page d'accueil — composant serveur alimenté par la BASE, plus
// par les 4 profils d'exemple codés en dur (Aïcha M., Kwame O., Fatou D., Yao K. et leurs
// notes/avis inventés) qui figuraient ici jusqu'au 2026-09-09. C'est exactement l'usage
// prévu par PersonCard, dont le commentaire d'en-tête réserve la carte aux « vraies données
// (jamais les 4 profils d'exemple de la page d'accueil) ».
//
// Sans prestataire éligible, on affiche une invitation à s'inscrire plutôt que de remplir la
// grille avec des profils fictifs : une vitrine vide est honnête, une vitrine inventée non.
export default async function TalentsAfrique() {
  // Seuls les LIBELLÉS de la section sont éditables. Les profils affichés restent ceux que
  // getFeaturedProviders sélectionne en base sur des critères vérifiables ; aucun écran
  // d'administration ne permet d'en épingler un à la main, ce qui serait une mise en avant
  // sur critère non publié — règle de conformité n°5.
  const [talents, config] = await Promise.all([getFeaturedProviders(6), getPublishedFrontendConfig()])
  const section = resolveSection(config, 'featured_talents')

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="page-shell">
        <p className="text-sm font-medium uppercase tracking-[0.12em] text-[#E85A24] mb-3">{section?.subtitle ?? 'Made in Africa'}</p>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8 lg:mb-10">
          <h2 className="text-[30px] md:text-[40px] leading-[1.1] font-semibold text-[#0A1931]">{section?.title ?? 'Talents d’Afrique 🌍'}</h2>
          {talents.length > 0 && section?.ctaText && (
            <Link href={section.ctaLink ?? '/recherche'} className="text-base font-semibold text-[#E85A24] hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>

        {talents.length === 0 ? (
          <div className="bg-[#F7F7F5] rounded-2xl p-8 lg:p-12 text-center">
            <p className="text-xl font-medium text-[#0A1931]">Les premiers profils arrivent</p>
            <p className="mt-2 text-gray-600 max-w-prose mx-auto">
              Aucun prestataire n&apos;a encore terminé sa vérification d&apos;identité. Créez votre profil pour
              faire partie des premiers talents visibles sur FlexWork.
            </p>
            <Link
              href="/signup"
              className="inline-block mt-6 bg-[#FF6B35] hover:bg-[#E85A24] text-white px-6 py-3 rounded-lg font-semibold transition"
            >
              Devenir prestataire
            </Link>
          </div>
        ) : (
          // Même grille que « Dernières missions » et « Nouveaux services » : 6 cartes, 3 colonnes.
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {talents.map((t) => (
              <li key={t.id}>
              <PersonCard
                name={providerDisplayName(t)}
                countryCode={t.country}
                avatarSrc={t.avatarPath ? `/api/users/${t.id}/avatar` : null}
                initials={providerInitials(t)}
                roleLabel={PROVIDER_ROLE_LABEL[t.role] ?? t.role}
                domain={t.mainDomain}
                city={t.zoneVille}
                rating={t.averageRating}
                reviewCount={t.reviewCount}
                priceLabel={providerPriceLabel(t.indicativeRate, t.tarifUnite)}
                href={`/profil/${t.id}?returnTo=%2F`}
              />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
