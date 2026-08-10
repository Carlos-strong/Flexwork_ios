export default function Footer() {
  return (
    <footer className="bg-[#0A1931] text-white">
      <div className="h-1 w-full bg-gradient-to-r from-[#FF6B35] via-[#F7C948] via-[#1B9C6A] to-[#8B2E86]"></div>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6 py-14 grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
        <div>
          <p className="font-extrabold text-lg mb-4">afri<span className="text-[#FF6B35]">lance</span>.</p>
          <p className="text-white/60 text-xs leading-relaxed">Le Fiverr africain. Talents locaux, qualité mondiale, paiement Mobile Money & FCFA.</p>
        </div>
        <div><p className="font-bold mb-3">Catégories</p><ul className="space-y-2 text-white/60 text-xs"><li>Design</li><li>Code</li><li>Vidéo</li><li>Musique</li></ul></div>
        <div><p className="font-bold mb-3">À propos</p><ul className="space-y-2 text-white/60 text-xs"><li>Comment ça marche</li><li>Carrières</li><li>Presse</li></ul></div>
        <div><p className="font-bold mb-3">Support</p><ul className="space-y-2 text-white/60 text-xs"><li>Aide</li><li>Confiance & Sécurité</li><li>Paiement FCFA</li></ul></div>
        <div><p className="font-bold mb-3">Communauté</p><ul className="space-y-2 text-white/60 text-xs"><li>Événements Dakar</li><li>Blog AfroTech</li><li>Devenir vendeur</li></ul></div>
      </div>
      <div className="border-t border-white/10 py-4">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-6 flex items-center justify-between text-xs text-white/50">
          <p>© 2026 FlexWork - Made with ❤️ à Cotonou 🇧🇯</p>
          <div className="flex gap-4"><span>FR</span><span>FCFA</span><span>● Mobile Money</span></div>
        </div>
      </div>
    </footer>
  )
}
