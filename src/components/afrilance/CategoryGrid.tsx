import Link from 'next/link'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'

// Grille d'icônes de domaines — extraite de src/app/page.tsx, où elle était écrite en JSX au
// milieu de la page. Elle devient un composant pour la même raison que les autres sections :
// son contenu est éditable, et une section éditable doit avoir un composant qui la lit.
//
// Chaque icône ouvre la recherche sur son domaine.
export default async function CategoryGrid() {
  const config = await getPublishedFrontendConfig()
  const section = resolveSection(config, 'category_grid')
  if (!section || section.items.length === 0) return null

  return (
    <section className="py-14 lg:py-16 bg-white border-t">
      <div className="page-shell grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9 gap-4 sm:gap-6 lg:gap-8">
        {section.items.map((c) => (
          <Link
            key={c.label}
            href={c.href ?? `/recherche?domaine=${encodeURIComponent(c.label)}`}
            className="text-center group block"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className={`w-14 h-14 lg:w-16 lg:h-16 mx-auto rounded-2xl ${c.color ?? 'bg-gray-100'} flex items-center justify-center text-xl lg:text-2xl group-hover:scale-110 transition`}>
              {c.icon}
            </div>
            <p className="text-xs lg:text-sm font-semibold mt-2 lg:mt-3">{c.label}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
