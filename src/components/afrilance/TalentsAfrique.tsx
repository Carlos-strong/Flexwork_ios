import Link from 'next/link'
import { PersonCard } from '@/components/person-card'
import { getFeaturedProviders } from '@/lib/featured-providers'
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
  const talents = await getFeaturedProviders(4)

  return (
    <section className="py-16 lg:py-20 bg-[#FFF8F0]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-1 w-12 bg-gradient-to-r from-[#FF6B35] to-[#F7C948] rounded-full"></div>
          <p className="text-sm font-extrabold tracking-widest text-[#FF6B35] uppercase">Made in Africa</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8 lg:mb-10">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold">Talents d&apos;Afrique 🌍</h2>
          {talents.length > 0 && (
            <Link href="/recherche" className="text-base font-bold text-[#FF6B35] hover:underline">
              Voir tous les prestataires →
            </Link>
          )}
        </div>

        {talents.length === 0 ? (
          <div className="bg-white rounded-2xl border border-orange-100 p-8 lg:p-10 text-center">
            <p className="text-lg font-bold text-[#0A1931]">Les premiers profils arrivent</p>
            <p className="mt-2 text-gray-600 max-w-prose mx-auto">
              Aucun prestataire n&apos;a encore terminé sa vérification d&apos;identité. Créez votre profil pour
              faire partie des premiers talents visibles sur FlexWork.
            </p>
            <Link
              href="/signup"
              className="inline-block mt-6 bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-6 py-3 rounded-full font-bold hover:shadow-lg hover:shadow-orange-200 transition"
            >
              Devenir prestataire
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {talents.map((t) => (
              <PersonCard
                key={t.id}
                name={providerDisplayName(t)}
                countryCode={t.country}
                avatarSrc={t.avatarPath ? `/api/users/${t.id}/avatar` : null}
                initials={providerInitials(t)}
                subtitle={`${PROVIDER_ROLE_LABEL[t.role] ?? t.role}${t.mainDomain ? ` • ${t.mainDomain}` : ''}${t.zoneVille ? ` • ${t.zoneVille}` : ''}`}
                rating={t.averageRating}
                reviewCount={t.reviewCount}
                priceLabel={providerPriceLabel(t.indicativeRate, t.tarifUnite)}
                href={`/profil/${t.id}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
