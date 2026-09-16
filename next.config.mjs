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
  experimental: {
    // lucide-react est importé partout ; transforme les imports nommés en imports
    // directs de modules pour réduire significativement le bundle JS client.
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
