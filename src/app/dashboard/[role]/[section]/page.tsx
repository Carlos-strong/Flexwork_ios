"use client";

import { useParams, notFound } from "next/navigation";
import ProviderDashboard from "@/components/dashboard/ProviderDashboard";
import { PROVIDER_ROLE_SLUGS, isValidProviderSection, type ProviderRoleSlug } from "@/lib/provider-urls";

// Route des sections du dashboard prestataire : /dashboard/{role}/{section}.
// Le dashboard de base (/dashboard/{role}) reste géré par chaque page statique (section
// "dashboard") ; cette route dynamique attrape les sous-sections (missions, messages,
// candidatures, wallet) et rend le dashboard du rôle avec la section correspondante active.
// Le dashboard étant déjà piloté par initialNav (pattern client), seule la sélection du
// bon composant selon le rôle est faite ici.

export default function ProviderSectionPage() {
  const params = useParams<{ role: string; section: string }>();
  const role = params?.role ?? "";
  const section = params?.section ?? "";

  if (!(PROVIDER_ROLE_SLUGS as readonly string[]).includes(role)) return notFound();
  if (!isValidProviderSection(section)) return notFound();

  return <ProviderDashboard slug={role as ProviderRoleSlug} initialNav={section} />;
}
