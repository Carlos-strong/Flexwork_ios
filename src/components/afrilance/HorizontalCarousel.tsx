'use client'

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// Carrousel horizontal à défilement automatique (2026-11-08) — section « Services 🔥 ».
//
// Les diapositives sont rendues par le composant SERVEUR appelant (images, liens) et passées
// en `children` : ce composant ne gère que le mouvement.
//
//   - défilement natif (overflow-x + scroll-snap) : glisser au doigt, molette, clavier et
//     lecteurs d'écran fonctionnent sans code particulier ;
//   - avance automatique d'une diapositive toutes les `intervalMs`, retour au début en fin de
//     piste ;
//   - PAUSE au survol, au focus clavier, au toucher, quand l'onglet est masqué — et jamais
//     d'avance automatique si l'utilisateur a demandé à réduire les animations (WCAG 2.2.2 :
//     un contenu qui bouge seul doit pouvoir être arrêté) ; bouton Pause/Lecture explicite ;
//   - flèches précédent / suivant, désactivées aux extrémités.
export default function HorizontalCarousel({
  children,
  label,
  intervalMs = 3500,
}: {
  children: ReactNode
  label: string
  intervalMs?: number
}) {
  const trackRef = useRef<HTMLUListElement>(null)
  const [hovered, setHovered] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [edges, setEdges] = useState({ start: true, end: false })
  const slides = Children.toArray(children)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const updateEdges = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }, [])

  useEffect(() => {
    updateEdges()
    window.addEventListener('resize', updateEdges)
    return () => window.removeEventListener('resize', updateEdges)
  }, [updateEdges])

  /** Avance (ou recule) d'une diapositive ; en bout de piste, repart au début. */
  const step = useCallback((dir: 1 | -1, loop = false) => {
    const el = trackRef.current
    const first = el?.firstElementChild as HTMLElement | null
    if (!el || !first) return
    const gap = parseFloat(getComputedStyle(el).columnGap || '0') || 0
    const width = first.offsetWidth + gap
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4
    if (dir === 1 && atEnd && loop) el.scrollTo({ left: 0, behavior: 'smooth' })
    else el.scrollBy({ left: dir * width, behavior: 'smooth' })
  }, [])

  const autoplay = !reducedMotion && !userPaused && !hovered && slides.length > 1

  useEffect(() => {
    if (!autoplay) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') step(1, true)
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [autoplay, intervalMs, step])

  const arrow =
    'w-10 h-10 rounded-full border border-gray-200 bg-white text-[#0A1931] grid place-items-center shadow-sm hover:border-[#FF6B35] hover:text-[#E85A24] transition disabled:opacity-35 disabled:hover:border-gray-200 disabled:hover:text-[#0A1931] disabled:cursor-not-allowed'

  return (
    <div
      role="region"
      aria-roledescription="carrousel"
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
      onTouchStart={() => setHovered(true)}
      onTouchEnd={() => setHovered(false)}
    >
      <ul
        ref={trackRef}
        onScroll={updateEdges}
        className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 lg:gap-4 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-0 scrollbar-hide scroll-smooth"
      >
        {slides.map((slide, i) => (
          <li
            key={i}
            aria-roledescription="diapositive"
            aria-label={`${i + 1} sur ${slides.length}`}
            className="shrink-0 snap-start w-[62%] sm:w-[calc((100%-0.75rem)/2.4)] md:w-[calc((100%-1.5rem)/3.4)] lg:w-[calc((100%-3rem)/4.3)]"
          >
            {slide}
          </li>
        ))}
      </ul>

      {slides.length > 1 && (
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setUserPaused((p) => !p)}
            aria-label={userPaused ? 'Relancer le défilement' : 'Mettre le défilement en pause'}
            className={`${arrow} text-[13px]`}
            hidden={reducedMotion}
          >
            {userPaused ? '▶' : '❚❚'}
          </button>
          <button type="button" onClick={() => step(-1)} disabled={edges.start} aria-label="Services précédents" className={arrow}>
            ←
          </button>
          <button type="button" onClick={() => step(1)} disabled={edges.end} aria-label="Services suivants" className={arrow}>
            →
          </button>
        </div>
      )}
    </div>
  )
}
