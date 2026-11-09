"use client";

// Carrousel des photos d'un service (2026-11-08) — cartes « Mes services » du profil public,
// catalogue, page du service. Jusqu'à 3 photos (src/lib/gig-rules.ts, GIG_IMAGES_MAX).
//
//   - défilement NATIF (overflow-x + scroll-snap) : glisser au doigt, pavé tactile et clavier
//     fonctionnent sans code particulier ;
//   - flèches au survol ou au focus clavier, points de position, compteur « 2/3 » ;
//   - la photo est un lien vers le service quand `href` est fourni : sur une carte, les flèches
//     et les points font défiler sans ouvrir la page ;
//   - seule la première photo est chargée d'emblée (les suivantes en différé) ;
//   - `autoplay` (2026-11-09, page du service) : défilement automatique en boucle, en PAUSE au
//     survol, au focus clavier, au toucher et quand l'onglet est masqué ; jamais si l'utilisateur
//     a demandé à réduire les animations ; bouton Pause / Lecture (WCAG 2.2.2 : un contenu qui
//     bouge seul doit pouvoir être arrêté).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

export function GigImageCarousel({
  images,
  alt,
  href,
  fallback,
  aspect = "aspect-[16/10]",
  rounded = "",
  autoplay = false,
  intervalMs = 4000,
}: {
  images: string[];
  /** Texte alternatif de base : « <titre> — photo 2 sur 3 ». */
  alt: string;
  href?: string;
  /** Rendu sans photo (dégradé, libellé…). */
  fallback?: React.ReactNode;
  aspect?: string;
  rounded?: string;
  /** Défilement automatique (page du service). */
  autoplay?: boolean;
  intervalMs?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Défilement lancé par le carrousel lui-même (flèche, point, lecture automatique) : la cible
  // est déjà connue, on ignore les positions INTERMÉDIAIRES de l'animation — sans quoi le
  // retour de la photo 3 à la 1 faisait clignoter le compteur « 3/3 → 2/3 → 1/3 ».
  const programmaticUntil = useRef(0);
  const scrollToIndex = useCallback((el: HTMLDivElement, i: number) => {
    programmaticUntil.current = Date.now() + 900;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setIndex(i);
  }, []);

  const [index, setIndex] = useState(0);
  const count = images.length;
  const [hovered, setHovered] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    if (!autoplay) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [autoplay]);

  const playing = autoplay && count > 1 && !reducedMotion && !userPaused && !hovered;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const el = trackRef.current;
      if (!el) return;
      scrollToIndex(el, (indexRef.current + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, count, intervalMs, scrollToIndex]);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || !el.clientWidth || Date.now() < programmaticUntil.current) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  useEffect(() => {
    // Liste de photos remplacée (modification) : on revient à la première.
    trackRef.current?.scrollTo({ left: 0 });
    setIndex(0);
  }, [images.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  function goTo(i: number, e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const el = trackRef.current;
    if (!el) return;
    scrollToIndex(el, (i + count) % count);
  }

  if (count === 0) {
    return <div className={`relative ${aspect} overflow-hidden ${rounded} bg-gradient-to-br from-[#0A1931] to-[#1B9C6A]`}>{fallback}</div>;
  }

  const slide = (src: string, i: number) => (
    // eslint-disable-next-line @next/next/no-img-element -- servies par /api/gigs/[id]/images
    <img
      src={src}
      alt={count > 1 ? `${alt} — photo ${i + 1} sur ${count}` : alt}
      loading={i === 0 ? "eager" : "lazy"}
      draggable={false}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );

  return (
    <div
      className={`group/carousel relative ${aspect} overflow-hidden ${rounded} bg-zinc-100`}
      role={count > 1 ? "region" : undefined}
      aria-roledescription={count > 1 ? "carrousel" : undefined}
      aria-label={count > 1 ? `Photos — ${alt}` : undefined}
      onMouseEnter={autoplay ? () => setHovered(true) : undefined}
      onMouseLeave={autoplay ? () => setHovered(false) : undefined}
      onFocusCapture={autoplay ? () => setHovered(true) : undefined}
      onBlurCapture={autoplay ? () => setHovered(false) : undefined}
      onTouchStart={autoplay ? () => setHovered(true) : undefined}
      onTouchEnd={autoplay ? () => setHovered(false) : undefined}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto scrollbar-hide"
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={(e) => {
          if (count < 2) return;
          if (e.key === "ArrowRight") goTo(index + 1);
          if (e.key === "ArrowLeft") goTo(index - 1);
        }}
      >
        {images.map((src, i) => (
          <div key={src} className="relative h-full w-full shrink-0 snap-start" aria-hidden={i !== index}>
            {href ? (
              <Link href={href} tabIndex={i === index ? 0 : -1} className="absolute inset-0" aria-label={i === 0 ? alt : undefined}>
                {slide(src, i)}
              </Link>
            ) : (
              slide(src, i)
            )}
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => goTo(index - 1, e)}
            aria-label="Photo précédente"
            className="absolute left-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[15px] text-[#0A1931] shadow-sm opacity-0 transition group-hover/carousel:opacity-100 focus-visible:opacity-100"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => goTo(index + 1, e)}
            aria-label="Photo suivante"
            className="absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[15px] text-[#0A1931] shadow-sm opacity-0 transition group-hover/carousel:opacity-100 focus-visible:opacity-100"
          >
            ›
          </button>
          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5" role="group" aria-label="Choisir une photo">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={(e) => goTo(i, e)}
                aria-label={`Photo ${i + 1} sur ${count}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full shadow transition-all ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/60 hover:bg-white/90"}`}
              />
            ))}
          </div>
          <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">
            {index + 1}/{count}
          </span>
          {autoplay && !reducedMotion && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setUserPaused((p) => !p);
              }}
              aria-label={userPaused ? "Relancer le défilement des photos" : "Mettre en pause le défilement des photos"}
              className="absolute left-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-[11px] text-white hover:bg-black/70"
            >
              {userPaused ? "▶" : "❚❚"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
