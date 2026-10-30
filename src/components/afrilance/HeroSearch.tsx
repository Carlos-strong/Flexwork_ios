'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Recherche du Hero — extraite en composant client pour que Hero reste un composant serveur
// et puisse lire les vrais compteurs en base. Même destination que la barre de la navbar :
// /recherche?domaine=…, qui lit ses paramètres depuis l'URL.
//
// Deux onglets, un par public. L'onglet « prestataire » ne propose PAS de recherche : la page
// autonome des missions a été supprimée (voir Header.tsx), la liste ne vit plus que dans les
// dashboards. Il renvoie donc vers /devenir-prestataire plutôt que vers une recherche vide.
const SUGGESTIONS = ['Design', 'Développement web', 'Maçonnerie', 'Plomberie', 'Électricité']

type Tab = 'client' | 'talent'

export function HeroSearch() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('client')
  const [query, setQuery] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/recherche?domaine=${encodeURIComponent(q)}` : '/recherche')
  }

  const tabClass = (t: Tab) =>
    `flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-medium rounded-lg transition ${
      tab === t ? 'bg-white text-[#0A1931]' : 'text-white/80 hover:text-white'
    }`

  return (
    <div className="mt-8 w-full max-w-xl rounded-2xl bg-black/45 backdrop-blur-md p-2 sm:p-3">
      <div role="tablist" aria-label="Je suis…" className="flex gap-1 mb-2 sm:mb-3">
        <button type="button" role="tab" aria-selected={tab === 'client'} onClick={() => setTab('client')} className={tabClass('client')}>
          Je cherche un prestataire
        </button>
        <button type="button" role="tab" aria-selected={tab === 'talent'} onClick={() => setTab('talent')} className={tabClass('talent')}>
          Je cherche des missions
        </button>
      </div>

      {tab === 'client' ? (
        <>
          <form onSubmit={submit} role="search" className="flex items-center gap-2 bg-white rounded-xl p-1.5">
            <svg className="w-5 h-5 ml-2.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Un métier — ex. « plomberie »"
              aria-label="Rechercher un prestataire"
              className="w-full min-w-0 !border-0 !p-0 !shadow-none outline-none text-base text-[#0A1931] placeholder:text-gray-400"
            />
            <button type="submit" className="shrink-0 bg-[#FF6B35] hover:bg-[#E85A24] text-white px-4 sm:px-5 py-3 rounded-lg font-semibold text-sm lg:text-base transition">
              Rechercher
            </button>
          </form>
          <div className="mt-3 px-1 hidden sm:flex flex-wrap gap-2 items-center text-sm">
            {SUGGESTIONS.map((t) => (
              <Link
                key={t}
                href={`/recherche?domaine=${encodeURIComponent(t)}`}
                className="px-3 py-1 rounded-full border border-white/30 text-white/90 hover:bg-white hover:text-[#0A1931] transition"
                style={{ textDecoration: 'none' }}
              >
                {t}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white rounded-xl p-4">
          <p className="flex-1 text-sm text-gray-600">
            Créez votre profil, candidatez aux missions publiées et soyez payé à la validation, via le séquestre.
          </p>
          <Link
            href="/devenir-prestataire"
            className="shrink-0 text-center bg-[#FF6B35] hover:bg-[#E85A24] text-white px-5 py-3 rounded-lg font-semibold text-sm lg:text-base transition"
            style={{ textDecoration: 'none' }}
          >
            Devenir prestataire
          </Link>
        </div>
      )}
    </div>
  )
}
