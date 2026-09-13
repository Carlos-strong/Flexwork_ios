import ExpertBtpDashboard from "@/components/dashboard/ExpertBtpDashboard";

// Wrapper de route — l'implémentation vit dans src/components/dashboard/ExpertBtpDashboard.tsx
// (non routée). Next.js interdit qu'un page.tsx soit à la fois une page ET un composant à
// props : ce dashboard était consommé avec `initialNav` par /dashboard/[role]/[section],
// ce que le type PageProps rejette (« Type '{ initialNav?: string } | undefined' does not
// satisfy the constraint 'PageProps' ») — `next build` échouait. Même correctif que
// ClientDashboardPage, déjà appliqué pour le dashboard client.
export default function Page() {
  return <ExpertBtpDashboard />;
}
