import Link from 'next/link'

// Chaque vignette pointe vers la recherche du domaine correspondant (elles n'étaient
// cliquables qu'en apparence : <div> avec cursor-pointer, aucun lien). Les intitulés sont
// alignés sur les métiers réellement couverts par la plateforme — digital ET filières
// chantier — plutôt que sur un catalogue uniquement créatif.
const SERVICES: { title: string; domaine: string; color: string; img: string }[] = [
  { title: 'Développement Web', domaine: 'Développement web', color: 'from-[#FF6B35] to-[#FF8A5B]', img: '/images/african_designer_studio.webp' },
  { title: 'Design & Identité', domaine: 'Design', color: 'from-[#F7C948] to-[#FF6B35]', img: '/images/ankara_video_editor.webp' },
  { title: 'Montage Vidéo', domaine: 'Vidéo', color: 'from-[#8B2E86] to-[#FF3E6C]', img: '/images/lagos_developer_coworking.webp' },
  { title: 'Marketing Digital', domaine: 'Marketing', color: 'from-[#1B9C6A] to-[#0A1931]', img: '/images/african_designer_studio.webp' },
  { title: 'Maçonnerie', domaine: 'Maçonnerie', color: 'from-[#0A1931] to-[#8B2E86]', img: '/images/ankara_video_editor.webp' },
  { title: 'Plomberie', domaine: 'Plomberie', color: 'from-[#FF3E6C] to-[#FF6B35]', img: '/images/lagos_developer_coworking.webp' },
  { title: 'Électricité', domaine: 'Électricité', color: 'from-[#1B9C6A] to-[#F7C948]', img: '/images/african_designer_studio.webp' },
  { title: 'Carrelage & Finitions', domaine: 'Carrelage', color: 'from-[#FF6B35] to-[#8B2E86]', img: '/images/ankara_video_editor.webp' },
]

export default function PopularServices() {
  return (
    <section className="py-16 lg:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8 lg:mb-10">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold">Services 🔥</h2>
          <Link href="/recherche" className="text-base font-bold text-[#FF6B35] hover:underline">Voir tout →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5">
          {SERVICES.map((s) => (
            <Link
              key={s.title}
              href={`/recherche?domaine=${encodeURIComponent(s.domaine)}`}
              className="group relative rounded-2xl overflow-hidden h-48 lg:h-56 block"
              style={{ textDecoration: 'none' }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${s.color} opacity-90`}></div>
              <img src={s.img} className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-50 group-hover:scale-110 transition duration-700" alt="" />
              <div className="relative p-4 lg:p-5 h-full flex flex-col justify-between text-white">
                <div className="w-8 h-8 lg:w-9 lg:h-9 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">↗</div>
                <p className="font-bold text-base lg:text-lg leading-tight">{s.title}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
