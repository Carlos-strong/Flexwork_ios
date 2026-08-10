export default function PopularServices() {
  const services = [
    { title: 'Développement Web', color: 'from-[#FF6B35] to-[#FF8A5B]', img: '/images/african_designer_studio.webp' },
    { title: 'Design Wax & Ankara', color: 'from-[#F7C948] to-[#FF6B35]', img: '/images/ankara_video_editor.webp' },
    { title: 'Montage Vidéo', color: 'from-[#8B2E86] to-[#FF3E6C]', img: '/images/lagos_developer_coworking.webp' },
    { title: 'Logo & Branding', color: 'from-[#1B9C6A] to-[#0A1931]', img: '/images/african_designer_studio.webp' },
    { title: 'Voix Off Africaine', color: 'from-[#0A1931] to-[#8B2E86]', img: '/images/ankara_video_editor.webp' },
    { title: 'Marketing TikTok', color: 'from-[#FF3E6C] to-[#FF6B35]', img: '/images/lagos_developer_coworking.webp' },
    { title: 'Sites E-commerce', color: 'from-[#1B9C6A] to-[#F7C948]', img: '/images/african_designer_studio.webp' },
    { title: 'Illustration Afro', color: 'from-[#FF6B35] to-[#8B2E86]', img: '/images/ankara_video_editor.webp' },
  ]

  return (
    <section className="py-16 lg:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8 lg:mb-10">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold">Services populaires 🔥</h2>
          <a className="text-base font-bold text-[#FF6B35] hover:underline">Voir tout →</a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5">
          {services.map((s,i)=>(
            <div key={i} className="group relative rounded-2xl overflow-hidden h-48 lg:h-56 cursor-pointer">
              <div className={`absolute inset-0 bg-gradient-to-br ${s.color} opacity-90`}></div>
              <img src={s.img} className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-50 group-hover:scale-110 transition duration-700" alt="" />
              <div className="relative p-4 lg:p-5 h-full flex flex-col justify-between text-white">
                <div className="w-8 h-8 lg:w-9 lg:h-9 bg-white/20 backdrop-blur rounded-full flex items-center justify-center">↗</div>
                <p className="font-bold text-base lg:text-lg leading-tight">{s.title}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
