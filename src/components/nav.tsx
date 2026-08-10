"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { BeninFlag } from "@/components/benin-flag";
import { NotificationsBell } from "@/components/notifications-bell";
import { ROLE_DASHBOARD, type Role } from "@/lib/role-dashboard";

// Pages qui embarquent leur propre header (logo + navigation) et pour lesquelles
// le header global doit être masqué pour éviter un double affichage.
const PAGES_WITH_OWN_HEADER = ["/", "/dashboard/expert-digital"];

// Navbar FlexWork 🇧🇯 — header unifié pour toutes les pages
export function Nav() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const user = session?.user as { role?: string; isAdmin?: boolean } | undefined;
  const role = user?.role as Role | undefined;
  // Même correctif que verify-otp/page.tsx : un admin a role="client" en DB, isAdmin est
  // prioritaire sinon ce lien renvoie vers /dashboard/client au lieu de /admin.
  const dashboardHref = user?.isAdmin ? "/admin" : role ? ROLE_DASHBOARD[role] ?? "/dashboard/client" : "/dashboard/client";
  const [mobileMenu, setMobileMenu] = useState(false);

  // Ne pas afficher le header global sur les pages qui ont leur propre navbar
  if (PAGES_WITH_OWN_HEADER.some((p) => pathname.startsWith(p))) return null;

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-zinc-100">
      <div className="relative mx-auto max-w-[1280px] px-4 lg:px-8 h-[68px] flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <BeninFlag />
          <span className="font-bold text-[22px] tracking-tight">Flex<span style={{ color: "#008751" }}>Work</span></span>
          <span className="text-[10px] font-bold tracking-widest bg-zinc-900 text-white px-1.5 py-0.5 rounded">BJ</span>
        </Link>

        {/* Desktop nav — centré indépendamment du logo et des actions à droite.
            Aligné sur la structure standard d'un marketplace freelance (type Upwork) :
            "Trouver un talent" (côté client) / "Trouver une mission" (côté prestataire).
            "Vérification" (/kyc) retiré — c'est une action de compte, pas un point d'entrée
            marketing pour un visiteur anonyme (Upwork ne met jamais la vérification d'identité
            dans son header public non plus). La page reste accessible depuis le compte. */}
        <nav className="hidden lg:flex items-center gap-6 text-[14px] font-medium text-zinc-700 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Link href="/recherche" className="hover:text-black transition-colors">Trouver un talent</Link>
          <Link href="/missions" className="hover:text-black transition-colors">Trouver une mission</Link>
          {status === "authenticated" && role && (
            <Link href={dashboardHref} className="hover:text-black transition-colors">Dashboard</Link>
          )}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-3 justify-end">
          {status === "authenticated" ? (
            <>
              <NotificationsBell />
              <Link href={dashboardHref}
                className="hidden md:inline-flex h-[36px] px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition items-center">
                Dashboard
              </Link>
              <button
                className="hidden md:inline-flex text-[13px] font-medium text-zinc-600 hover:text-black px-3 py-2 transition-colors"
                onClick={() => signOut({ callbackUrl: "/" })}>
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" className="hidden md:inline-flex text-[14px] font-medium px-3 py-2 text-zinc-700 hover:text-black transition-colors">Se connecter</Link>
              <Link href="/signup" className="h-[40px] px-5 rounded-full bg-[#008751] text-white text-[14px] font-semibold hover:bg-[#E8112D] transition inline-flex items-center">S&apos;inscrire</Link>
            </>
          )}

          {/* Mobile menu toggle */}
          <button onClick={() => setMobileMenu(!mobileMenu)} className="lg:hidden w-10 h-10 grid place-items-center rounded-full border border-zinc-200">
            {mobileMenu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenu && (
        <div className="lg:hidden border-t border-zinc-100 bg-white px-4 py-4">
          <div className="grid grid-cols-2 gap-2 text-[14px] font-medium">
            <Link href="/recherche" className="py-2" onClick={() => setMobileMenu(false)}>Trouver un talent</Link>
            <Link href="/missions" className="py-2" onClick={() => setMobileMenu(false)}>Trouver une mission</Link>
            {status === "authenticated" ? (
              <>
                <Link href={dashboardHref} className="py-2" onClick={() => setMobileMenu(false)}>Dashboard</Link>
                <button className="py-2 text-left text-red-600" onClick={() => { signOut({ callbackUrl: "/" }); setMobileMenu(false); }}>Déconnexion</button>
              </>
            ) : (
              <Link href="/signin" className="py-2" onClick={() => setMobileMenu(false)}>Se connecter</Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
