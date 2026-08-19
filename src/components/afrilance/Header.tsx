'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { ROLE_DASHBOARD, type Role } from '@/lib/role-dashboard'
import { NotificationsBell } from '@/components/notifications-bell'

export default function Header() {
  const { data: session, status } = useSession()
  const user = session?.user as { role?: string; isAdmin?: boolean } | undefined
  const role = user?.role as Role | undefined
  const dashboardHref = user?.isAdmin ? "/admin" : role ? ROLE_DASHBOARD[role] ?? "/dashboard/client" : "/dashboard/client"
  const [mobileOpen, setMobileOpen] = useState(false)
  
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
          <div className="hidden lg:flex items-center gap-1 bg-gray-50 rounded-full px-4 py-2 w-[380px]">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input placeholder="Quel service cherches-tu aujourd'hui ?" className="bg-transparent outline-none flex-1 text-sm ml-2 placeholder:text-gray-400" />
          </div>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm lg:text-base font-medium">
          <a className="hover:text-[#FF6B35] transition">FlexWork Pro</a>
          <a className="flex items-center gap-1 hover:text-[#FF6B35]">Explorer <span>▾</span></a>
          <a className="hover:text-[#FF6B35]">Devenir Vendeur</a>

          {status === "authenticated" ? (
            <>
              <NotificationsBell />
              <Link href={dashboardHref}
                className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-5 py-2.5 rounded-full font-bold hover:shadow-lg hover:shadow-orange-200 transition">
                Dashboard
              </Link>
              <button
                className="text-zinc-600 hover:text-black transition"
                onClick={() => signOut({ callbackUrl: "/" })}>
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" className="hover:text-[#FF6B35] transition">Connexion</Link>
              <Link href="/signup"
                className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-5 py-2.5 rounded-full font-bold hover:shadow-lg hover:shadow-orange-200 transition">
                Rejoindre
              </Link>
            </>
          )}
        </nav>

        {/* Mobile */}
        <button onClick={()=>setMobileOpen(!mobileOpen)} className="md:hidden p-2">☰</button>
      </div>
      
      {mobileOpen && (
        <div className="md:hidden bg-white border-t p-4 flex flex-col gap-3">
          <input placeholder="Rechercher..." className="bg-gray-50 rounded-full px-4 py-3 outline-none" />
          <a>FlexWork Pro</a><a>Explorer</a><a>Devenir Vendeur</a>
          {status === "authenticated" ? (
            <>
              <Link href={dashboardHref} onClick={() => setMobileOpen(false)}>Dashboard</Link>
              <button className="text-left text-red-600" onClick={() => { signOut({ callbackUrl: "/" }); setMobileOpen(false); }}>Déconnexion</button>
            </>
          ) : (
            <Link href="/signin" onClick={() => setMobileOpen(false)}>Connexion</Link>
          )}
        </div>
      )}
    </header>
  )
}
