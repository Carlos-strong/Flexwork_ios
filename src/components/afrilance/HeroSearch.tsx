'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Recherche du Hero — extraite en composant client pour que Hero reste un composant serveur
// et puisse lire les vrais compteurs en base. Même destination que la barre de la navbar :
// /recherche?domaine=…, qui lit ses paramètres depuis l'URL.
const SUGGESTIONS = ['Design', 'Développement web', 'Maçonnerie', 'Plomberie', 'Électricité']

export function HeroSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/recherche?domaine=${encodeURIComponent(q)}` : '/recherche')
  }

  return (
    <>
      <form onSubmit={submit} role="search" className="mt-8 flex items-center bg-white rounded-full shadow-xl shadow-orange-100 p-1.5 max-w-lg lg:max-w-xl border border-orange-100">
        <div className="flex items-center gap-2 flex-1 px-4">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Un métier, un domaine — ex. « plomberie »"
            aria-label="Rechercher un prestataire"
            className="w-full outline-none text-base placeholder:text-gray-400"
          />
        </div>
        <button type="submit" className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white px-6 py-3 rounded-full font-bold text-sm lg:text-base hover:shadow-lg transition">Rechercher</button>
      </form>

      <div className="mt-6 flex flex-wrap gap-2 items-center text-sm">
        <span className="font-semibold text-gray-500">Populaire :</span>
        {SUGGESTIONS.map((t) => (
          <Link
            key={t}
            href={`/recherche?domaine=${encodeURIComponent(t)}`}
            className="px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:border-[#FF6B35] hover:text-[#FF6B35] transition"
          >
            {t}
          </Link>
        ))}
      </div>
    </>
  )
}
