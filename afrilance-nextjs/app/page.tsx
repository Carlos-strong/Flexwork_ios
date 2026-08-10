import Header from '@/components/Header'
import CategoriesBar from '@/components/CategoriesBar'
import Hero from '@/components/Hero'
import TrustedBy from '@/components/TrustedBy'
import PopularServices from '@/components/PopularServices'
import TalentsAfrique from '@/components/TalentsAfrique'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Header />
      <CategoriesBar />
      <Hero />
      <TrustedBy />
      <PopularServices />
      
      {/* Categories Icons Grid */}
      <section className="py-12 bg-white border-t">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-6 grid grid-cols-3 md:grid-cols-9 gap-6">
          {[
            { icon: '🎨', label: 'Design', color: 'bg-orange-100' },
            { icon: '💻', label: 'Code', color: 'bg-blue-100' },
            { icon: '📱', label: 'Marketing', color: 'bg-green-100' },
            { icon: '🎬', label: 'Vidéo', color: 'bg-purple-100' },
            { icon: '✍️', label: 'Rédaction', color: 'bg-pink-100' },
            { icon: '🎧', label: 'Audio', color: 'bg-yellow-100' },
            { icon: '📊', label: 'Business', color: 'bg-orange-100' },
            { icon: '🤖', label: 'IA', color: 'bg-indigo-100' },
            { icon: '🌍', label: 'Traduction', color: 'bg-emerald-100' },
          ].map(c=>(
            <div key={c.label} className="text-center group cursor-pointer">
              <div className={`w-14 h-14 mx-auto rounded-2xl ${c.color} flex items-center justify-center text-xl group-hover:scale-110 transition`}>{c.icon}</div>
              <p className="text-xs font-semibold mt-2">{c.label}</p>
            </div>
          ))}
        </div>
      </section>

      <TalentsAfrique />
      <Footer />
    </main>
  )
}
