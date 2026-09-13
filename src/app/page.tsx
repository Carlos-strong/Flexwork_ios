import Link from 'next/link'
import Header from '@/components/afrilance/Header'
import CategoriesBar from '@/components/afrilance/CategoriesBar'
import Hero from '@/components/afrilance/Hero'
import TrustedBy from '@/components/afrilance/TrustedBy'
import PopularServices from '@/components/afrilance/PopularServices'
import TalentsAfrique from '@/components/afrilance/TalentsAfrique'
import Footer from '@/components/afrilance/Footer'

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Header />
      <CategoriesBar />
      <Hero />
      <TrustedBy />
      <PopularServices />
      
      {/* Categories Icons Grid */}
      <section className="py-14 lg:py-16 bg-white border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9 gap-4 sm:gap-6 lg:gap-8">
          {/* Chaque icône ouvre la recherche sur son domaine — c'étaient des <div> avec
              cursor-pointer et aucun lien. Les libellés couvrent les deux filières réelles
              de la plateforme (digital et chantier), pas seulement les métiers créatifs. */}
          {[
            { icon: '🎨', label: 'Design', color: 'bg-orange-100' },
            { icon: '💻', label: 'Code', color: 'bg-blue-100' },
            { icon: '📱', label: 'Marketing', color: 'bg-green-100' },
            { icon: '🎬', label: 'Vidéo', color: 'bg-purple-100' },
            { icon: '✍️', label: 'Rédaction', color: 'bg-pink-100' },
            { icon: '🧱', label: 'Maçonnerie', color: 'bg-yellow-100' },
            { icon: '🚰', label: 'Plomberie', color: 'bg-orange-100' },
            { icon: '⚡', label: 'Électricité', color: 'bg-indigo-100' },
            { icon: '🪚', label: 'Menuiserie', color: 'bg-emerald-100' },
          ].map(c=>(
            <Link key={c.label} href={`/recherche?domaine=${encodeURIComponent(c.label)}`} className="text-center group block" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className={`w-14 h-14 lg:w-16 lg:h-16 mx-auto rounded-2xl ${c.color} flex items-center justify-center text-xl lg:text-2xl group-hover:scale-110 transition`}>{c.icon}</div>
              <p className="text-xs lg:text-sm font-semibold mt-2 lg:mt-3">{c.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <TalentsAfrique />
      <Footer />
    </main>
  )
}
