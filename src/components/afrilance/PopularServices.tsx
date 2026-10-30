import Image from 'next/image'
import Link from 'next/link'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'

// Vignettes de services. `sublabel` porte le DOMAINE visé par la recherche, distinct du
// `label` affiché : la vignette « Design & Identité » ouvre la recherche sur « Design ».
// Les deux étaient déjà deux champs séparés dans la version codée en dur ; les confondre
// enverrait le visiteur sur une recherche vide.
//
// Vignette avec image : photo pleine + voile sombre en bas sous le libellé. Sans image, le
// dégradé `color` (éditable) sert de fond, comme avant.
export default async function PopularServices() {
  const config = await getPublishedFrontendConfig()
  const section = resolveSection(config, 'popular_services')
  if (!section || section.items.length === 0) return null

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="page-shell">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8 lg:mb-10">
          <h2 className="text-[30px] md:text-[40px] leading-[1.1] font-semibold text-[#0A1931]">{section.title ?? 'Services populaires'}</h2>
          {section.ctaText && (
            <Link href={section.ctaLink ?? '/recherche'} className="text-base font-semibold text-[#E85A24] hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>
        {/* Mobile : carrousel horizontal (une vignette et demie visible, défilement aimanté)
            plutôt que quatre rangées empilées. Le débord négatif colle le défilement aux
            bords de l'écran tout en gardant la première vignette alignée sur la gouttière. */}
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex sm:grid sm:grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4 overflow-x-auto sm:overflow-visible snap-x snap-mandatory scroll-px-4 scrollbar-hide">
          {section.items.map((s) => (
            <Link
              key={s.label}
              href={s.href ?? `/recherche?domaine=${encodeURIComponent(s.sublabel ?? s.label)}`}
              className="group relative shrink-0 w-[62%] sm:w-auto snap-start rounded-xl overflow-hidden aspect-[3/4] sm:aspect-[4/3] md:aspect-[3/4] block"
              style={{ textDecoration: 'none' }}
            >
              {s.imageUrl?.startsWith('/') && !s.imageUrl.startsWith('//') ? (
                // Fichier LOCAL (public/) : next/image en sert une variante à la taille de la
                // vignette — ~30 Ko au lieu des ~550 Ko de l'original en 1920 px.
                <Image
                  src={s.imageUrl}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 62vw, (max-width: 768px) 50vw, 280px"
                  className="object-cover group-hover:scale-105 transition duration-700"
                />
              ) : s.imageUrl ? (
                // URL externe saisie dans le backoffice (champ libre ≤ 240 car.) : l'hôte n'est
                // pas connu à la compilation, et next/image exigerait de l'inscrire dans
                // `images.remotePatterns` — une liste blanche qui casserait la page le jour où
                // un éditeur colle l'URL d'un autre domaine.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-700" alt="" />
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${s.color ?? 'from-[#0A1931] to-[#8B2E86]'}`} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
              <div className="relative h-full p-4 lg:p-5 flex items-end justify-between gap-2 text-white">
                <p className="font-semibold text-[15px] lg:text-base leading-tight">{s.label}</p>
                <span className="w-8 h-8 shrink-0 rounded-full bg-white/20 backdrop-blur grid place-items-center group-hover:bg-white group-hover:text-[#0A1931] transition" aria-hidden>↗</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
