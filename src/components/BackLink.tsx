import Link from "next/link";

// Bouton « ← Retour » des pages secondaires (/declarations, /badge) : ramène vers la page
// d'origine. La destination est choisie par la page (`?returnTo=` sûr, sinon une page par défaut).
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-[13px] font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-[#0A1931] transition"
      style={{ textDecoration: "none" }}
    >
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4">
        <path d="M12.5 15l-5-5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </Link>
  );
}
