/** @type {import('next').NextConfig} */
const nextConfig = {
  // Landing page : src/app/page.tsx (Dashboard Artisan VJR, composants Next.js natifs)
  poweredByHeader: false,
  // `next dev` et `next build` écrivent par DÉFAUT dans le même `.next`. Lancer une
  // vérification de build pendant qu'un serveur de dev tourne réécrit ses chunks sous ses
  // pieds : le dev répond alors 500 sur toutes les pages, avec des `Cannot find module
  // './vendor-chunks/*.js'` — constaté le 16/09/2026, et seul un `rm -rf .next` + redémarrage
  // en sort. `npm run build:check` pose NEXT_DIST_DIR et construit ailleurs ; sans la variable,
  // le comportement est strictement inchangé (production incluse).
  //
  // Le build n'est PAS la seule façon de corrompre ce cache, et cette option ne protège que de
  // lui. Un `npm install`/`uninstall`, ou la suppression de fichiers sources, pendant qu'un
  // serveur de dev tourne, produit exactement les mêmes 500 : son cache webpack continue de
  // référencer des chunks (`vendor-chunks/*.js`) que ces opérations viennent d'invalider —
  // constaté deux fois le 16/09/2026. Aucune option ne s'en prémunit : après une opération de ce
  // genre, redémarrer avec `npm run dev:reset`, qui purge `.next` avant de relancer.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Anciennes adresses de l'administration (avant la reprise de l'architecture de flexwork_job,
  // 2026-09-21). Redirections TEMPORAIRES (307) : un navigateur ne les mémorise pas, ce qui
  // laisse la liberté de réaffecter ces chemins plus tard. Sans elles, un favori, un onglet resté
  // ouvert ou un lien dans un e-mail déjà envoyé tomberaient sur une 404.
  async redirects() {
    return [
      { source: "/admin/superviseur", destination: "/admin", permanent: false },
      { source: "/admin/mediation", destination: "/admin/disputes", permanent: false },
      { source: "/admin/finance", destination: "/admin/paiements", permanent: false },
      { source: "/admin/moderation", destination: "/admin/reports/declarations", permanent: false },
      { source: "/admin/audit", destination: "/backoffice/audit", permanent: false },
      { source: "/admin/risk", destination: "/backoffice/locations", permanent: false },
      { source: "/admin/prerequisites", destination: "/backoffice/settings/filieres", permanent: false },
      { source: "/admin/frontend", destination: "/backoffice/content", permanent: false },
      { source: "/admin/frontend/taxonomie", destination: "/backoffice/catalog", permanent: false },
      { source: "/admin/frontend/reglages", destination: "/backoffice/settings", permanent: false },
      { source: "/admin/frontend/:page(accueil|menus|pages|versions)", destination: "/backoffice/content/:page", permanent: false },
    ];
  },
  experimental: {
    // lucide-react est importé partout ; transforme les imports nommés en imports
    // directs de modules pour réduire significativement le bundle JS client.
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
