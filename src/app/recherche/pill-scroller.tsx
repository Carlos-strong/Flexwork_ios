"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Rangée défilante horizontale avec flèches précédent / suivant (en-tête « Services les plus
// populaires » de /recherche). Les flèches ne s'activent que s'il reste à défiler dans leur
// sens ; au doigt, le défilement natif suffit et elles sont masquées sous 640 px. Les bords
// s'estompent du côté où il reste du contenu, pour signaler qu'on peut faire défiler.
export function PillScroller({
  prefix,
  subject,
  children,
}: {
  prefix: string;
  subject: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollBy = (dir: 1 | -1) =>
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });

  const arrow =
    "grid h-10 w-10 place-items-center rounded-full bg-white text-[#0A1931] ring-1 ring-black/[0.08] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-35";

  const fade = 48;
  const mask = `linear-gradient(to right, ${edges.start ? "black" : "transparent"}, black ${fade}px, black calc(100% - ${fade}px), ${edges.end ? "black" : "transparent"})`;

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-xl sm:text-[26px] font-semibold leading-tight tracking-tight text-[#0A1931]">
          <span className="text-gray-400">{prefix} : </span>
          {subject}
        </h2>
        <div className="hidden sm:flex gap-2">
          <button type="button" aria-label="Précédent" className={arrow} disabled={edges.start} onClick={() => scrollBy(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" aria-label="Suivant" className={arrow} disabled={edges.end} onClick={() => scrollBy(1)}>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 overflow-x-auto scroll-smooth scrollbar-hide snap-x py-2"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {children}
      </div>
    </section>
  );
}
