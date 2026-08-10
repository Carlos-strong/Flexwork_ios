export default function TalentsAfrique() {
  const talents = [
    { name: 'Aïcha M.', role: 'Designer UI/UX Wax', rating: '5.0', reviews: 127, price: '15 000 FCFA', flag: '🇧🇯', city: 'Cotonou', img: '/images/african_designer_studio.webp' },
    { name: 'Kwame O.', role: 'Développeur Fullstack', rating: '4.9', reviews: 203, price: '25 000 FCFA', flag: '🇳🇬', city: 'Lagos', img: '/images/lagos_developer_coworking.webp' },
    { name: 'Fatou D.', role: 'Monteuse Vidéo TikTok', rating: '5.0', reviews: 89, price: '8 000 FCFA', flag: '🇸🇳', city: 'Dakar', img: '/images/ankara_video_editor.webp' },
    { name: 'Yao K.', role: 'Voix Off & Podcast', rating: '4.9', reviews: 156, price: '12 000 FCFA', flag: '🇨🇮', city: 'Abidjan', img: '/images/african_designer_studio.webp' },
  ]

  return (
    <section className="py-16 bg-[#FFF8F0]">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-1 w-12 bg-gradient-to-r from-[#FF6B35] to-[#F7C948] rounded-full"></div>
          <p className="text-xs font-extrabold tracking-widest text-[#FF6B35] uppercase">Made in Africa</p>
        </div>
        <h2 className="text-[28px] lg:text-[36px] font-extrabold mb-8">Talents d'Afrique 🌍, plébiscités</h2>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {talents.map(t=>(
            <div key={t.name} className="bg-white rounded-[20px] p-4 shadow-sm border border-orange-100 hover:shadow-xl hover:-translate-y-1 transition">
              <div className="flex items-start gap-3">
                <img src={t.img} className="w-12 h-12 rounded-full object-cover" alt={t.name} />
                <div className="flex-1">
                  <p className="font-bold text-[14px]">{t.name} <span>{t.flag}</span></p>
                  <p className="text-xs text-gray-500">{t.role} • {t.city}</p>
                  <div className="flex items-center gap-1 mt-1 text-xs">
                    <span className="text-[#F7C948]">★</span><span className="font-bold">{t.rating}</span><span className="text-gray-400">({t.reviews})</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-gray-500">À partir de</p>
                <p className="font-extrabold text-[#0A1931]">{t.price}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
