import Link from 'next/link'

// Chaque catégorie envoie sur /recherche?domaine=… (correspondance partielle insensible à
// la casse côté API) — c'étaient des <a> sans href, donc neuf éléments inertes.
const CATEGORIES: { name: string; color: string }[] = [
  { name: 'Design Graphique', color: 'bg-[#FF6B35]' },
  { name: 'Programmation', color: 'bg-[#0A1931]' },
  { name: 'Marketing Digital', color: 'bg-[#1B9C6A]' },
  { name: 'Vidéo & Animation', color: 'bg-[#8B2E86]' },
  { name: 'Rédaction', color: 'bg-[#FF3E6C]' },
  { name: 'Maçonnerie', color: 'bg-[#F7C948] text-black' },
  { name: 'Plomberie', color: 'bg-[#FF6B35]' },
  { name: 'Électricité', color: 'bg-[#1B9C6A]' },
  { name: 'Menuiserie', color: 'bg-gradient-to-r from-[#FF6B35] to-[#8B2E86]' },
]

export default function CategoriesBar() {
  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6 lg:gap-8 overflow-x-auto scrollbar-hide py-3 text-sm font-medium whitespace-nowrap">
          {CATEGORIES.map((c) => (
            <Link
              key={c.name}
              href={`/recherche?domaine=${encodeURIComponent(c.name)}`}
              className="flex items-center gap-2 hover:text-[#FF6B35] transition"
              style={{ textDecoration: 'none' }}
            >
              <span className={`w-2 h-2 rounded-full ${c.color}`}></span>
              {c.name}
            </Link>
          ))}
          <Link href="/recherche" className="ml-auto hidden lg:block text-[#FF6B35] font-bold hover:underline">
            + Voir plus →
          </Link>
        </div>
      </div>
    </div>
  )
}
