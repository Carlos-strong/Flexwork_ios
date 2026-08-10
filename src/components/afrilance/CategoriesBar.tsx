export default function CategoriesBar() {
  const cats = [
    { name: 'Design Graphique', color: 'bg-[#FF6B35]' },
    { name: 'Programmation', color: 'bg-[#0A1931]' },
    { name: 'Marketing Digital', color: 'bg-[#1B9C6A]' },
    { name: 'Vidéo & Animation', color: 'bg-[#8B2E86]' },
    { name: 'Rédaction', color: 'bg-[#FF3E6C]' },
    { name: 'Musique & Audio', color: 'bg-[#F7C948] text-black' },
    { name: 'Business', color: 'bg-[#FF6B35]' },
    { name: 'Consulting', color: 'bg-[#1B9C6A]' },
    { name: 'Services IA', color: 'bg-gradient-to-r from-[#FF6B35] to-[#8B2E86]' },
  ]
  
  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6 lg:gap-8 overflow-x-auto scrollbar-hide py-3 text-sm font-medium whitespace-nowrap">
          {cats.map(c => (
            <a key={c.name} className="flex items-center gap-2 hover:text-[#FF6B35] cursor-pointer group">
              <span className={`w-2 h-2 rounded-full ${c.color}`}></span>
              {c.name}
            </a>
          ))}
          <span className="ml-auto hidden lg:block text-[#FF6B35] font-bold">+ Voir plus →</span>
        </div>
      </div>
    </div>
  )
}
