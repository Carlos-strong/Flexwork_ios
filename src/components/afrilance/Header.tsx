'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { ROLE_DASHBOARD, type Role } from '@/lib/role-dashboard'
import { NotificationsBell } from '@/components/notifications-bell'

// Entrées du menu « Explorer » — uniquement des pages qui existent réellement dans
// src/app. Ne PAS y remettre /missions : la page autonome a été supprimée, la liste des
// missions ne vit plus que dans les dashboards (voir missionsHrefForRole dans
// src/lib/role-dashboard.ts).
const EXPLORE_LINKS: { href: string; label: string; description: string }[] = [
  { href: '/recherche', label: 'Trouver un prestataire', description: 'Annuaire des profils à identité vérifiée' },
  { href: '/comment-ca-marche', label: 'Comment ça marche', description: 'Du dépôt de mission au paiement' },
  { href: '/confiance', label: 'Confiance & Sécurité', description: 'Vérification, séquestre, médiation' },
  { href: '/tarifs', label: 'Tarifs', description: 'Commissions et frais de la plateforme' },
  { href: '/faq', label: 'FAQ', description: 'Les questions les plus fréquentes' },
  { href: '/a-propos', label: 'À propos', description: 'Qui nous sommes' },
  { href: '/contact', label: 'Contact', description: 'Écrire à l’équipe' },
]

export default function Header() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const user = session?.user as { id?: string; role?: string; isAdmin?: boolean } | undefined
  const role = user?.role as Role | undefined
  const dashboardHref = user?.isAdmin ? "/admin" : role ? ROLE_DASHBOARD[role] ?? "/client/dashboard" : "/client/dashboard"
  const [mobileOpen, setMobileOpen] = useState(false)
  const [exploreOpen, setExploreOpen] = useState(false)
  const [query, setQuery] = useState('')
  const exploreRef = useRef<HTMLDivElement>(null)

  // Fermeture du menu « Explorer » au clic extérieur et à Échap — sans ça le panneau reste
  // ouvert par-dessus la page dès qu'on clique ailleurs.
  useEffect(() => {
    if (!exploreOpen) return
    function onPointerDown(e: MouseEvent) {
      if (exploreRef.current && !exploreRef.current.contains(e.target as Node)) setExploreOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setExploreOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [exploreOpen])

  // La recherche pousse vers /recherche, qui lit ?domaine= depuis l'URL. Une requête vide
  // est valide : elle affiche l'annuaire complet plutôt que de bloquer sur une erreur.
  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/recherche?domaine=${encodeURIComponent(q)}` : '/recherche')
    setMobileOpen(false)
  }

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-orange-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 lg:h-18 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-6 lg:gap-8">
          <Link href="/" className="flex items-center gap-1">
            <span className="text-3xl font-extrabold tracking-tight">Flex</span>
            <span className="text-3xl font-extrabold tracking-tight text-[#FF6B35]">Work</span>
            <span className="text-3xl font-extrabold text-[#FF6B35]">.</span>
          </Link>
          <form onSubmit={submitSearch} role="search" className="hidden lg:flex items-center gap-1 bg-gray-50 rounded-full px-4 py-2 w-[380px] focus-within:ring-2 focus-within:ring-[#FF6B35]/30">
            <button type="submit" aria-label="Rechercher" className="text-gray-400 hover:text-[#FF6B35] transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quel service cherches-tu aujourd'hui ?"
              aria-label="Rechercher un prestataire"
              className="bg-transparent outline-none flex-1 text-sm ml-2 placeholder:text-gray-400"
            />
          </form>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm lg:text-base font-medium">
          <Link href="/comment-ca-marche" className="hover:text-[#FF6B35] transition">Comment ça marche</Link>

          <div className="relative" ref={exploreRef}>
            <button
              type="button"
              onClick={() => setExploreOpen((o) => !o)}
              aria-expanded={exploreOpen}
              aria-haspopup="true"
              className="flex items-center gap-1 hover:text-[#FF6B35] transition"
            >
              Explorer <span aria-hidden className={`transition-transform ${exploreOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {exploreOpen && (
              <div className="absolute left-0 top-full mt-2 w-[320px] bg-white rounded-2xl shadow-xl border border-orange-100 p-2">
                {EXPLORE_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setExploreOpen(false)}
                    className="block px-3 py-2.5 rounded-xl hover:bg-orange-50 transition"
                  >
                    <span className="block text-sm font-semibold text-[#0A1931]">{l.label}</span>
                    <span className="block text-xs text-gray-500">{l.description}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {status === "authenticated" ? (
            <>
              <NotificationsBell />
              <Link href={dashboardHref}
                className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-5 py-2.5 rounded-full font-bold hover:shadow-lg hover:shadow-orange-200 transition">
                Dashboard
              </Link>
              {user?.id && (
                <Link href={`/profil/${user.id}`} className="hover:text-[#FF6B35] transition">Mon profil</Link>
              )}
              <button
                className="text-zinc-600 hover:text-black transition"
                onClick={() => signOut({ callbackUrl: "/" })}>
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <Link href="/signup" className="hover:text-[#FF6B35] transition">Devenir prestataire</Link>
              <Link href="/signin" className="hover:text-[#FF6B35] transition">Connexion</Link>
              <Link href="/signup"
                className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-5 py-2.5 rounded-full font-bold hover:shadow-lg hover:shadow-orange-200 transition">
                Rejoindre
              </Link>
            </>
          )}
        </nav>

        {/* Mobile */}
        <button onClick={()=>setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-label="Menu" className="md:hidden p-2">☰</button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white border-t p-4 flex flex-col gap-3">
          <form onSubmit={submitSearch} role="search" className="flex items-center gap-2 bg-gray-50 rounded-full px-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un prestataire..."
              aria-label="Rechercher un prestataire"
              className="bg-transparent py-3 outline-none flex-1"
            />
            <button type="submit" className="text-[#FF6B35] font-bold text-sm">OK</button>
          </form>
          <Link href="/comment-ca-marche" onClick={() => setMobileOpen(false)}>Comment ça marche</Link>
          {EXPLORE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)}>{l.label}</Link>
          ))}
          {status === "authenticated" ? (
            <>
              <Link href={dashboardHref} onClick={() => setMobileOpen(false)}>Dashboard</Link>
              {user?.id && <Link href={`/profil/${user.id}`} onClick={() => setMobileOpen(false)}>Mon profil</Link>}
              <button className="text-left text-red-600" onClick={() => { signOut({ callbackUrl: "/" }); setMobileOpen(false); }}>Déconnexion</button>
            </>
          ) : (
            <>
              <Link href="/signup" onClick={() => setMobileOpen(false)}>Devenir prestataire</Link>
              <Link href="/signin" onClick={() => setMobileOpen(false)}>Connexion</Link>
            </>
          )}
        </div>
      )}
    </header>
  )
}
