import ArtisanDashboard from "@/components/dashboard/ArtisanDashboard";

// Wrapper de route — l'implémentation vit dans src/components/dashboard/ArtisanDashboard.tsx
// (non routée). Next.js interdit qu'un page.tsx soit à la fois une page ET un composant à
// props : ce dashboard était consommé avec `initialNav` par /dashboard/[role]/[section],
// ce que le type PageProps rejette (« Type '{ initialNav?: string } | undefined' does not
// satisfy the constraint 'PageProps' ») — `next build` échouait. Même correctif que
// ClientDashboardPage, déjà appliqué pour le dashboard client.
export default function Page() {
  return <ArtisanDashboard />;
}
