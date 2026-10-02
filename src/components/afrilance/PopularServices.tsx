import Link from 'next/link'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'

// Vignettes de services. `sublabel` porte le DOMAINE visé par la recherche, distinct du
// `label` affiché : la vignette « Design & Identité » ouvre la recherche sur « Design ».
// Les deux étaient déjà deux champs séparés dans la version codée en dur ; les confondre
// enverrait le visiteur sur une recherche vide.
export default async function PopularServices() {
  const config = await getPublishedFrontendConfig()
  const section = resolveSection(config, 'popular_services')
  if (!section || section.items.length === 0) return null

  return (
    <section className="py-16 lg:py-20 bg-white">
      <div className="page-shell">
        <div className="flex items-end justify-between mb-8 lg:mb-10">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold">{section.title ?? 'Services 🔥'}</h2>
          {section.ctaText && (
            <Link href={section.ctaLink ?? '/recherche'} className="text-base font-bold text-[#FF6B35] hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5">
          {section.items.map((s) => (
            <Link
              key={s.label}
              href={s.href ?? `/recherche?domaine=${encodeURIComponent(s.sublabel ?? s.label)}`}
              className="group relative rounded-2xl overflow-hidden h-48 lg:h-56 block"
              style={{ textDecoration: 'none' }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${s.color ?? 'from-[#0A1931] to-[#8B2E86]'} opacity-90`}></div>
              {s.imageUrl && (
                // `imageUrl` vient du contenu ÉDITORIAL (backoffice, champ libre ≤ 240 car.) :
                // l'hôte n'est pas connu à la compilation, et next/image exigerait de l'inscrire
                // dans `images.remotePatterns` — une liste blanche qui casserait la page le jour
                // où un éditeur colle l'URL d'un autre domaine. Le fond est décoratif et atténué
                // (mix-blend-overlay opacity-50) : le gain d'optimisation ne vaut pas ce risque.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-50 group-hover:scale-110 transition duration-700" alt="" />
              )}
              <div className="relative p-4 lg:p-5 h-full flex flex-col justify-between text-white">
                <div className="w-8 h-8 lg:w-9 lg:h-9 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">↗</div>
                <p className="font-bold text-base lg:text-lg leading-tight">{s.label}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
