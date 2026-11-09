import SiteManagerDashboard from "@/components/dashboard/SiteManagerDashboard";

// Wrapper de route — même contrainte que les autres dashboards : un page.tsx ne peut pas être à
// la fois une page et un composant à props (voir ArtisanDashboard pour le détail).
export default function Page() {
  return <SiteManagerDashboard />;
}
