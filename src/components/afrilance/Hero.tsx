import Link from 'next/link'
import { HeroSearch } from '@/components/afrilance/HeroSearch'
import { getPlatformStats } from '@/lib/platform-stats'

// Composant serveur : les compteurs affichés viennent de la base (voir platform-stats.ts).
// Les chiffres codés en dur qui figuraient ici — « 12 458 talents connectés maintenant »,
// « 4.9/5 • 2 300+ avis », « 500K+ Talents dans 12 pays » — ont été retirés le 2026-09-09 :
// aucun n'était calculé, et tous étaient démentis par le contenu réel de la base.
// Un compteur nul n'est pas affiché du tout ; le bloc bascule alors sur la promesse produit,
// vraie quel que soit le volume.
export default async function Hero() {
  const stats = await getPlatformStats()

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-yellow-50 to-green-50 ankarapattern">
      {/* Decorative shapes */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-[#FF6B35]/20 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-20 w-32 h-32 bg-[#F7C948]/30 rounded-full blur-xl"></div>
      <div className="absolute top-1/2 right-[40%] w-3 h-3 bg-[#8B2E86] rotate-45"></div>
      <div className="absolute top-32 right-32 w-4 h-4 bg-[#1B9C6A] rounded-full"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-24 grid lg:grid-cols-[1.1fr_0.9fr] gap-8 lg:gap-12 items-center relative">
        <div>
          <div className="inline-flex items-center gap-2 bg-white shadow-sm rounded-full px-4 py-2 text-sm font-bold mb-6">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            {stats.verifiedProviders > 0
              ? `${stats.verifiedProviders.toLocaleString('fr-FR')} prestataire${stats.verifiedProviders > 1 ? 's' : ''} à identité vérifiée 🌍`
              : 'Plateforme en cours de lancement 🌍'}
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold leading-[1.05] tracking-tight">
            Trouve le bon<br/>
            <span className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] bg-clip-text text-transparent">talent africain,</span><br/>
            tout de suite ✨
          </h1>

          <p className="mt-6 text-lg lg:text-xl text-gray-600 max-w-prose leading-relaxed">
            Experts digitaux, artisans et professionnels du bâtiment. Identité vérifiée, contrat signé,
            paiement sous séquestre en FCFA.
          </p>

          <HeroSearch />
        </div>

        {/* 2x2 Grid */}
        <div className="grid grid-cols-2 gap-3 lg:gap-4">
          <div className="space-y-3 lg:space-y-4">
            <div className="relative rounded-2xl overflow-hidden h-48 sm:h-56 lg:h-64 shadow-xl group">
              <img src="/images/african_designer_studio.webp" className="w-full h-full object-cover group-hover:scale-105 transition duration-700" alt="" />
            </div>
            {/* Note moyenne réelle — le bloc disparaît tant qu'aucun avis n'a été déposé,
                plutôt que d'afficher une satisfaction inventée. */}
            {stats.averageRating != null ? (
              <div className="rounded-2xl bg-[#0A1931] p-5 text-white h-32 flex flex-col justify-center">
                <p className="text-3xl font-extrabold">{stats.averageRating.toFixed(1)}/5</p>
                <p className="text-sm opacity-80">
                  Satisfaction moyenne • {stats.reviewCount.toLocaleString('fr-FR')} avis
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-[#0A1931] p-5 text-white h-32 flex flex-col justify-center">
                <p className="text-xl font-extrabold leading-tight">Paiement sous séquestre</p>
                <p className="text-sm opacity-80">Les fonds ne sont libérés qu&apos;après validation</p>
              </div>
            )}
          </div>
          <div className="space-y-3 lg:space-y-4 pt-6">
            <Link href="/recherche" className="rounded-2xl bg-gradient-to-br from-[#F7C948] to-[#FF6B35] p-5 text-black h-32 flex flex-col justify-between hover:shadow-lg transition" style={{ textDecoration: 'none' }}>
              {stats.verifiedProviders > 0 ? (
                <>
                  <p className="font-extrabold leading-tight text-lg">
                    {stats.verifiedProviders.toLocaleString('fr-FR')}<br/>
                    talent{stats.verifiedProviders > 1 ? 's' : ''} vérifié{stats.verifiedProviders > 1 ? 's' : ''}
                  </p>
                  <p className="text-sm font-medium">
                    {stats.countries > 0
                      ? `dans ${stats.countries} pays d'Afrique`
                      : 'Parcourir l’annuaire →'}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-extrabold leading-tight text-lg">Rejoins les<br/>premiers talents</p>
                  <p className="text-sm font-medium">Crée ton profil →</p>
                </>
              )}
            </Link>
            <div className="relative rounded-2xl overflow-hidden h-48 sm:h-56 lg:h-64 shadow-xl group">
              <img src="/images/lagos_developer_coworking.webp" className="w-full h-full object-cover group-hover:scale-105 transition duration-700" alt="" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
