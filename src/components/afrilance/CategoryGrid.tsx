import Link from 'next/link'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'

// Grille de domaines — extraite de src/app/page.tsx, où elle était écrite en JSX au milieu
// de la page. Elle devient un composant pour la même raison que les autres sections : son
// contenu est éditable, et une section éditable doit avoir un composant qui la lit.
//
// Chaque carte ouvre la recherche sur son domaine. `color` reste la classe de fond de la
// pastille d'icône, comme avant la mise en cartes.
export default async function CategoryGrid() {
  const config = await getPublishedFrontendConfig()
  const section = resolveSection(config, 'category_grid')
  if (!section || section.items.length === 0) return null

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="page-shell">
        <h2 className="text-[30px] md:text-[40px] leading-[1.1] font-semibold text-[#0A1931] mb-8 lg:mb-10">
          {section.title ?? 'Parcourir les talents par domaine'}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:gap-4">
          {section.items.map((c) => (
            <Link
              key={c.label}
              href={c.href ?? `/recherche?domaine=${encodeURIComponent(c.label)}`}
              className="group flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 rounded-xl bg-[#F7F7F5] p-4 lg:p-5 hover:bg-[#EFEFEB] transition"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span className={`w-10 h-10 lg:w-11 lg:h-11 shrink-0 rounded-lg ${c.color ?? 'bg-white'} grid place-items-center text-lg lg:text-xl`}>
                {c.icon}
              </span>
              <span className="flex-1 min-w-0 font-medium text-[15px] lg:text-base text-[#0A1931] leading-tight">{c.label}</span>
              <span className="hidden sm:block text-gray-400 group-hover:text-[#E85A24] group-hover:translate-x-0.5 transition" aria-hidden>→</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
