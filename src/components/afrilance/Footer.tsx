export default function Footer() {
  return (
    <footer className="bg-[#0A1931] text-white">
      <div className="h-1 w-full bg-gradient-to-r from-[#FF6B35] via-[#F7C948] via-[#1B9C6A] to-[#8B2E86]"></div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16 grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-10 text-sm lg:text-base">
        <div>
          <p className="font-extrabold text-xl mb-4">Flex<span className="text-[#FF6B35]">Work</span>.</p>
          <p className="text-white/60 text-sm leading-relaxed">Le Fiverr africain. Talents locaux, qualité mondiale, paiement Mobile Money & FCFA.</p>
        </div>
        <div><p className="font-bold mb-4">Catégories</p><ul className="space-y-2.5 text-white/60 text-sm"><li>Design</li><li>Code</li><li>Vidéo</li><li>Musique</li></ul></div>
        <div><p className="font-bold mb-4">À propos</p><ul className="space-y-2.5 text-white/60 text-sm"><li>Comment ça marche</li><li>Carrières</li><li>Presse</li></ul></div>
        <div><p className="font-bold mb-4">Support</p><ul className="space-y-2.5 text-white/60 text-sm"><li>Aide</li><li>Confiance & Sécurité</li><li>Paiement FCFA</li></ul></div>
        <div><p className="font-bold mb-4">Communauté</p><ul className="space-y-2.5 text-white/60 text-sm"><li>Événements Dakar</li><li>Blog AfroTech</li><li>Devenir vendeur</li></ul></div>
      </div>
        <div className="border-t border-white/10 py-4 lg:py-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs lg:text-sm text-white/50">
          <p>© 2026 FlexWork - Made with ❤️ à Cotonou 🇧🇯</p>
          <div className="flex gap-4"><span>FR</span><span>FCFA</span><span>● Mobile Money</span></div>
        </div>
      </div>
    </footer>
  )
}
