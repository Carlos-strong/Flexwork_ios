import Link from 'next/link'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'

// Composant SERVEUR : les catégories viennent de la configuration publiée (module
// « Sections d'accueil » de /backoffice/content), plus des neuf entrées codées en dur qui
// vivaient ici. Sans publication, `resolveSection` rend exactement ces neuf entrées — la
// barre ne peut donc pas disparaître parce que la base est vide ou muette.
//
// `color` transporte la classe utilitaire de la pastille. Elle est écrite par un
// administrateur, jamais par un visiteur, et n'est pas interpolée dans du HTML brut : une
// valeur inattendue produit une pastille sans couleur, rien de plus.
export default async function CategoriesBar() {
  const config = await getPublishedFrontendConfig()
  const section = resolveSection(config, 'categories_bar')
  if (!section || section.items.length === 0) return null

  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="nav-shell">
        <div className="flex items-center gap-4 lg:gap-5 overflow-x-auto scrollbar-hide py-3 text-sm font-medium whitespace-nowrap">
          {section.items.map((c) => (
            <Link
              key={c.label}
              href={c.href ?? `/recherche?domaine=${encodeURIComponent(c.label)}`}
              className="flex items-center gap-2 hover:text-[#FF6B35] transition"
              style={{ textDecoration: 'none' }}
            >
              <span className={`w-2 h-2 rounded-full ${c.color ?? 'bg-gray-300'}`}></span>
              {c.label}
            </Link>
          ))}
          {section.ctaText && (
            <Link href={section.ctaLink ?? '/recherche'} className="ml-auto hidden lg:block text-[#FF6B35] font-bold hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
