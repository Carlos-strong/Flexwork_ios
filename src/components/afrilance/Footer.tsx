import Link from 'next/link'

// Toutes les entrées étaient de simples <li> non cliquables. Elles sont désormais des liens
// vers des pages qui existent dans src/app. Les rubriques sans page réelle (« Carrières »,
// « Presse », « Blog AfroTech », « Événements Dakar ») ont été retirées plutôt que
// transformées en liens morts ou en pages vides — elles reviendront avec leur contenu.
const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Prestataires',
    links: [
      { href: '/recherche', label: 'Trouver un prestataire' },
      { href: '/signup', label: 'Devenir prestataire' },
      { href: '/missions/new', label: 'Publier une mission' },
    ],
  },
  {
    title: 'À propos',
    links: [
      { href: '/a-propos', label: 'Qui sommes-nous' },
      { href: '/comment-ca-marche', label: 'Comment ça marche' },
      { href: '/tarifs', label: 'Tarifs' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/faq', label: 'FAQ' },
      { href: '/contact', label: 'Contact' },
      { href: '/confiance', label: 'Confiance & Sécurité' },
    ],
  },
  {
    title: 'Légal',
    links: [
      { href: '/cgu', label: 'Conditions générales' },
      { href: '/confidentialite', label: 'Confidentialité' },
      { href: '/signalement', label: 'Signaler un contenu' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="bg-[#0A1931] text-white">
      <div className="h-1 w-full bg-gradient-to-r from-[#FF6B35] via-[#F7C948] via-[#1B9C6A] to-[#8B2E86]"></div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16 grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-10 text-sm lg:text-base">
        <div>
          <Link href="/" className="font-extrabold text-xl mb-4 block" style={{ textDecoration: 'none', color: 'inherit' }}>
            Flex<span className="text-[#FF6B35]">Work</span>.
          </Link>
          <p className="text-white/60 text-sm leading-relaxed">
            La plateforme des talents africains : identité vérifiée, contrat signé, paiement sous séquestre
            en FCFA et Mobile Money.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="font-bold mb-4">{col.title}</p>
            <ul className="space-y-2.5 text-white/60 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-[#FF6B35] transition" style={{ textDecoration: 'none' }}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 py-4 lg:py-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs lg:text-sm text-white/50">
          <p>© {new Date().getFullYear()} FlexWork — Made with ❤️ à Cotonou 🇧🇯</p>
          <div className="flex gap-4"><span>FR</span><span>FCFA</span><span>● Mobile Money</span></div>
        </div>
      </div>
    </footer>
  )
}
