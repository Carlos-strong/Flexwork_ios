"use client";

import { useParams, notFound } from "next/navigation";
import ExpertDigitalDashboard from "@/components/dashboard/ExpertDigitalDashboard";
import ExpertBtpDashboard from "@/components/dashboard/ExpertBtpDashboard";
import ArtisanDashboard from "@/components/dashboard/ArtisanDashboard";
import ManoeuvreDashboard from "@/components/dashboard/ManoeuvreDashboard";
import { PROVIDER_ROLE_SLUGS, isValidProviderSection } from "@/lib/provider-urls";

// Route des sections du dashboard prestataire : /dashboard/{role}/{section}.
// Le dashboard de base (/dashboard/{role}) reste géré par chaque page statique (section
// "dashboard") ; cette route dynamique attrape les sous-sections (missions, messages,
// candidatures, wallet) et rend le dashboard du rôle avec la section correspondante active.
// Le dashboard étant déjà piloté par initialNav (pattern client), seule la sélection du
// bon composant selon le rôle est faite ici.

const DASHBOARDS: Record<string, React.ComponentType<{ initialNav?: string }>> = {
  "expert-digital": ExpertDigitalDashboard,
  "expert-btp": ExpertBtpDashboard,
  artisan: ArtisanDashboard,
  manoeuvre: ManoeuvreDashboard,
};

export default function ProviderSectionPage() {
  const params = useParams<{ role: string; section: string }>();
  const role = params?.role ?? "";
  const section = params?.section ?? "";

  if (!(PROVIDER_ROLE_SLUGS as readonly string[]).includes(role)) return notFound();
  if (!isValidProviderSection(section)) return notFound();

  const Dashboard = DASHBOARDS[role];
  return <Dashboard initialNav={section} />;
}
