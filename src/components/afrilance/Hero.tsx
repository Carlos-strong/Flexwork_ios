import Image from 'next/image'
import { HeroSearch } from '@/components/afrilance/HeroSearch'
import { getPlatformStats } from '@/lib/platform-stats'
import { getPublishedFrontendConfig, parseHeroTitle, resolveSection } from '@/lib/frontend-config'
import { HERO_TITLE } from '@/lib/frontend-defaults'

// Composant serveur : les compteurs affichés viennent de la base (voir platform-stats.ts).
// Les chiffres codés en dur qui figuraient ici — « 12 458 talents connectés maintenant »,
// « 4.9/5 • 2 300+ avis », « 500K+ Talents dans 12 pays » — ont été retirés le 2026-09-09 :
// aucun n'était calculé, et tous étaient démentis par le contenu réel de la base.
// Un compteur nul n'est pas affiché du tout ; le bloc bascule alors sur la promesse produit,
// vraie quel que soit le volume.
//
// Mise en page (2026-10) : une seule grande carte photo arrondie, titre blanc sur un voile
// sombre, recherche à onglets dans un panneau translucide. Les tuiles 2×2 ont disparu ; leurs
// deux compteurs réels (prestataires vérifiés, note moyenne) sont devenus les pastilles du bas.
export default async function Hero() {
  const [stats, config] = await Promise.all([getPlatformStats(), getPublishedFrontendConfig()])
  const section = resolveSection(config, 'hero')
  // Le titre et le paragraphe sont éditables ; les pastilles ne le sont pas, parce qu'elles
  // affichent des compteurs mesurés en base. Rendre un compteur éditable rouvrirait la porte
  // aux « 12 458 talents connectés maintenant » retirés le 2026-09-09 : un chiffre saisi à la
  // main est invérifiable par construction.
  const titleLines = parseHeroTitle(section?.title ?? HERO_TITLE)

  const chips: string[] = [
    stats.verifiedProviders > 0
      ? `${stats.verifiedProviders.toLocaleString('fr-FR')} prestataire${stats.verifiedProviders > 1 ? 's' : ''} à identité vérifiée${stats.countries > 0 ? ` dans ${stats.countries} pays` : ''}`
      : 'Plateforme en cours de lancement',
    stats.averageRating != null
      ? `${stats.averageRating.toFixed(1)}/5 de satisfaction • ${stats.reviewCount.toLocaleString('fr-FR')} avis`
      : 'Paiement sous séquestre, libéré à la validation',
  ]

  return (
    <section className="bg-white pt-4 lg:pt-6">
      {/* Bloc photo plein écran ; le texte reste centré sur la largeur des autres sections. */}
      <div className="page-wide">
        <div className="relative overflow-hidden rounded-2xl lg:rounded-3xl min-h-[520px] lg:min-h-[560px] flex items-end lg:items-center px-5 sm:px-10 lg:px-14">
          {/* Asset STATIQUE de public/images : next/image en sert une variante redimensionnée.
              Photo PAYSAGE (1920×1280) : la carte est plus large que haute à partir de la
              tablette, un portrait y serait recadré au tiers et agrandi au-delà de sa
              définition. `priority` : c'est l'élément LCP de la page. */}
          <Image
            src="/images/lagos_developer_coworking.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[70%_center]"
          />
          {/* Voile : opaque à gauche (sous le texte), transparent à droite (la photo respire).
              Sur mobile le texte est en bas, d'où un dégradé vertical. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/20 lg:bg-gradient-to-r lg:from-black/80 lg:via-black/45 lg:to-transparent" />

          <div className="relative page-inner pt-24 pb-6 sm:py-12">
            <h1 className="max-w-[660px] text-white text-[36px] leading-[1.04] md:text-[72px] font-semibold">
              {titleLines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {line.map((part, partIndex) =>
                    part.highlight ? (
                      <span key={partIndex} className="text-[#FF8A5C]">{part.text}</span>
                    ) : (
                      <span key={partIndex}>{part.text}</span>
                    )
                  )}
                  {lineIndex < titleLines.length - 1 && <br />}
                </span>
              ))}
            </h1>

            {section?.subtitle && (
              <p className="mt-4 sm:mt-5 max-w-xl text-base lg:text-lg text-white/85 leading-relaxed">{section.subtitle}</p>
            )}

            <HeroSearch />

            <ul className="mt-5 sm:mt-6 flex flex-wrap gap-2 text-xs sm:text-sm text-white">
              {chips.map((c) => (
                <li key={c} className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
