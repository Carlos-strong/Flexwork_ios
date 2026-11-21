'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { NotificationsBell } from '@/components/notifications-bell'
import ProfileMenu, { AccountMenuSections, useAccountBadges } from '@/components/ProfileMenu'
import { DEFAULT_MENUS } from '@/lib/frontend-defaults'
import { Menu, X } from 'lucide-react'

// Lien du menu mobile : 44 px de hauteur tactile au minimum.
const MOBILE_LINK = 'block py-3 px-1 text-base font-medium hover:text-[#6D28D9] transition'

// Entrées du menu « Explorer ». Éditables depuis /backoffice/content (menu `header_explore`),
// et reçues en PROP plutôt que lues ici : ce composant est client (il lit la session), il ne
// peut donc pas interroger la base. Le parent serveur les lui passe.
//
// Le repli est DEFAULT_MENUS.header_explore, c'est-à-dire les mêmes sept entrées qu'avant.
// Ne PAS y remettre /missions : la page autonome a été supprimée, la liste des missions ne
// vit plus que dans les dashboards (voir missionsHrefForRole dans src/lib/role-dashboard.ts).
// Toute destination est de toute façon validée à l'écriture contre les routes réelles
// (isLinkableHref), pour que le menu ne puisse pas se remplir de liens morts.
export type ExploreLink = { href: string; label: string; description?: string }

export default function Header({ exploreLinks }: { exploreLinks?: ExploreLink[] } = {}) {
  const EXPLORE_LINKS: ExploreLink[] = exploreLinks?.length
    ? exploreLinks
    : DEFAULT_MENUS.header_explore.items

  const { status } = useSession()
  const router = useRouter()
  // Compteurs du menu du compte (messages non lus, candidatures…) — partagés par le menu
  // ordinateur et le menu mobile.
  const accountBadges = useAccountBadges()
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
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md shadow-[inset_0_-1px_0_rgb(229,231,235)]">
      {/* Gabarit Upwork : barre pleine largeur, intérieur 1600 px max, 56 px de haut sur mobile
          et 64 px sur ordinateur ; sur mobile, le bouton menu est à GAUCHE du logo. */}
      <div className="nav-shell h-14 lg:h-16 flex items-center justify-start lg:justify-between gap-1 lg:gap-4">
        {/* Logo */}
        <div className="flex items-center gap-5 xl:gap-6">
          <Link href="/" className="flex items-center gap-1">
            <span className="text-2xl font-extrabold tracking-tight">Flex</span>
            <span className="text-2xl font-extrabold tracking-tight text-[#6D28D9]">Work</span>
            <span className="text-2xl font-extrabold text-[#6D28D9]">.</span>
          </Link>
          <form onSubmit={submitSearch} role="search" className="hidden xl:flex items-center gap-1 bg-gray-50 rounded-full px-4 py-2 w-[240px] 2xl:w-[280px] focus-within:ring-2 focus-within:ring-[#6D28D9]/30">
            <button type="submit" aria-label="Rechercher" className="text-gray-400 hover:text-[#6D28D9] transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quel service cherches-tu aujourd'hui ?"
              aria-label="Rechercher un prestataire"
              // border-0/p-0/shadow-none : neutralise la règle globale des champs (globals.css),
              // qui dessinait un second cadre à l'intérieur de la pilule de recherche.
              className="bg-transparent outline-none border-0 p-0 rounded-none focus:shadow-none flex-1 text-sm ml-2 placeholder:text-gray-400"
            />
          </form>
        </div>

        {/* Nav */}
        <nav className="hidden lg:flex items-center gap-5 text-[15px] font-medium whitespace-nowrap">
          <Link href="/comment-ca-marche" className="hover:text-[#6D28D9] transition">Comment ça marche</Link>

          <div className="relative" ref={exploreRef}>
            <button
              type="button"
              onClick={() => setExploreOpen((o) => !o)}
              aria-expanded={exploreOpen}
              aria-haspopup="true"
              className="flex items-center gap-1 hover:text-[#6D28D9] transition"
            >
              Explorer <span aria-hidden className={`transition-transform ${exploreOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {exploreOpen && (
              <div className="absolute left-0 top-full mt-2 w-[320px] bg-white rounded-2xl shadow-xl border border-violet-100 p-2">
                {EXPLORE_LINKS.filter((l) => l.href !== '/comment-ca-marche').map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setExploreOpen(false)}
                    className="block px-3 py-2.5 rounded-xl hover:bg-violet-50 transition"
                  >
                    <span className="block text-sm font-semibold text-[#191224]">{l.label}</span>
                    {l.description && <span className="block text-xs text-gray-500">{l.description}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {status === "authenticated" ? (
            <>
              <NotificationsBell />
              {/* Menu du profil (2026-11-09) : il porte la navigation de l'espace connecté —
                  l'ancien sidebar des tableaux de bord —, le compte et la déconnexion. */}
              <ProfileMenu badges={accountBadges} />
            </>
          ) : (
            <>
              <Link href="/signup" className="hover:text-[#6D28D9] transition">Devenir prestataire</Link>
              <Link href="/signin" className="hover:text-[#6D28D9] transition">Connexion</Link>
              <Link href="/signup"
                className="bg-[#6D28D9] hover:bg-[#5B21B6] text-white px-4 py-2 rounded-full font-semibold transition">
                Rejoindre
              </Link>
            </>
          )}
        </nav>

        {/* Mobile : cloche des notifications à droite pour un compte connecté (le menu du compte
            est dans le panneau ouvert par le bouton menu). */}
        {status === "authenticated" && (
          <div className="lg:hidden ml-auto">
            <NotificationsBell />
          </div>
        )}

        {/* Mobile */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
          className="order-first lg:hidden w-11 h-11 -ml-2 flex items-center justify-center rounded-full hover:bg-violet-50 transition"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        // Hauteur bornée et défilement propre : la barre est collante, un panneau plus haut que
        // l'écran aurait sinon caché ses dernières entrées (Déconnexion) hors d'atteinte.
        <div className="lg:hidden bg-white border-t p-4 flex flex-col gap-1 max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain">
          <form onSubmit={submitSearch} role="search" className="mb-2 flex items-center gap-2 bg-gray-50 rounded-full px-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un prestataire..."
              aria-label="Rechercher un prestataire"
              className="bg-transparent py-3 px-0 outline-none border-0 rounded-none focus:shadow-none flex-1 text-base"
            />
            {/* Cible tactile de 44 px (elle faisait 21 × 20 px). */}
            <button type="submit" className="min-h-11 min-w-11 -mr-2 px-2 text-[#6D28D9] font-bold text-sm">OK</button>
          </form>
          {/* Compte connecté : son espace d'abord (l'ancien sidebar), la découverte ensuite. */}
          {status === "authenticated" && (
            <div role="menu" aria-label="Menu du compte" className="mb-3 -mx-2 rounded-2xl border border-gray-100 p-2">
              <AccountMenuSections badges={accountBadges} onNavigate={() => setMobileOpen(false)} />
            </div>
          )}
          <Link href="/comment-ca-marche" className={MOBILE_LINK} onClick={() => setMobileOpen(false)}>Comment ça marche</Link>
          {/* Sans doublon : le menu « Explorer » peut lui aussi contenir « Comment ça marche ». */}
          {EXPLORE_LINKS.filter((l) => l.href !== '/comment-ca-marche').map((l) => (
            <Link key={l.href} href={l.href} className={MOBILE_LINK} onClick={() => setMobileOpen(false)}>{l.label}</Link>
          ))}
          {status !== "authenticated" && (
            <>
              <Link href="/signup" className={MOBILE_LINK} onClick={() => setMobileOpen(false)}>Devenir prestataire</Link>
              <Link href="/signin" className={MOBILE_LINK} onClick={() => setMobileOpen(false)}>Connexion</Link>
            </>
          )}
        </div>
      )}
    </header>
  )
}
