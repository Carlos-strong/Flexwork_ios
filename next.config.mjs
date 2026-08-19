/** @type {import('next').NextConfig} */
const nextConfig = {
  // Landing page : src/app/page.tsx (Dashboard Artisan VJR, composants Next.js natifs)
  poweredByHeader: false,
  experimental: {
    // lucide-react est importé partout ; transforme les imports nommés en imports
    // directs de modules pour réduire significativement le bundle JS client.
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
