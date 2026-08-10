export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-yellow-50 to-green-50 ankarapattern">
      {/* Decorative shapes */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-[#FF6B35]/20 rounded-full blur-xl"></div>
      <div className="absolute bottom-20 right-20 w-32 h-32 bg-[#F7C948]/30 rounded-full blur-xl"></div>
      <div className="absolute top-1/2 right-[40%] w-3 h-3 bg-[#8B2E86] rotate-45"></div>
      <div className="absolute top-32 right-32 w-4 h-4 bg-[#1B9C6A] rounded-full"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-24 grid lg:grid-cols-[1.1fr_0.9fr] gap-8 lg:gap-12 items-center relative">
        <div>
          <div className="inline-flex items-center gap-2 bg-white shadow-sm rounded-full px-4 py-2 text-sm font-bold mb-6">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            12 458 talents connectés maintenant en Afrique 🌍
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold leading-[1.05] tracking-tight">
            Trouve le bon<br/>
            <span className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] bg-clip-text text-transparent">talent africain,</span><br/>
            tout de suite ✨
          </h1>
          
          <p className="mt-6 text-lg lg:text-xl text-gray-600 max-w-prose leading-relaxed">
            Designers, développeurs, monteurs vidéo et voix off du Bénin au Sénégal. Qualité mondiale, prix justes en FCFA.
          </p>

          <div className="mt-8 flex items-center bg-white rounded-full shadow-xl shadow-orange-100 p-1.5 max-w-lg lg:max-w-xl border border-orange-100">
            <div className="flex items-center gap-2 flex-1 px-4">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input placeholder="Essaie 'logo en wax' ou 'site e-commerce'" className="w-full outline-none text-base placeholder:text-gray-400" />
            </div>
            <button className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-6 py-3 rounded-full font-bold text-sm lg:text-base hover:shadow-lg transition">Rechercher</button>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 items-center text-sm">
            <span className="font-semibold text-gray-500">Populaire :</span>
            {['Site Vitrine', 'Logo Wax', 'Montage TikTok', 'Voix Off Dioula'].map(t=>(
              <span key={t} className="px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:border-[#FF6B35] hover:text-[#FF6B35] cursor-pointer transition">{t}</span>
            ))}
          </div>
        </div>

        {/* 2x2 Grid */}
        <div className="grid grid-cols-2 gap-3 lg:gap-4">
          <div className="space-y-3 lg:space-y-4">
            <div className="relative rounded-2xl overflow-hidden h-48 sm:h-56 lg:h-64 shadow-xl group">
              <img src="/images/african_designer_studio.webp" className="w-full h-full object-cover group-hover:scale-105 transition duration-700" alt="Designer" />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                <p className="text-white text-sm font-bold">Aïcha • Design • Cotonou 🇧🇯</p>
              </div>
            </div>
            <div className="rounded-2xl bg-[#0A1931] p-5 text-white h-32 flex flex-col justify-center">
              <p className="text-3xl font-extrabold">4.9/5</p>
              <p className="text-sm opacity-80">Satisfaction moyenne • 2 300+ avis</p>
            </div>
          </div>
          <div className="space-y-3 lg:space-y-4 pt-6">
            <div className="rounded-2xl bg-gradient-to-br from-[#F7C948] to-[#FF6B35] p-5 text-black h-32 flex flex-col justify-between">
              <p className="font-extrabold leading-tight text-lg">500K+<br/>Talents</p>
              <p className="text-sm font-medium">dans 12 pays d'Afrique</p>
            </div>
            <div className="relative rounded-2xl overflow-hidden h-48 sm:h-56 lg:h-64 shadow-xl group">
              <img src="/images/lagos_developer_coworking.webp" className="w-full h-full object-cover group-hover:scale-105 transition duration-700" alt="Dev" />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                <p className="text-white text-sm font-bold">Kwame • Code • Lagos 🇳🇬</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
