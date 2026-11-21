import ProviderDashboard from "@/components/dashboard/ProviderDashboard";

// Wrapper de route — l'implémentation, commune aux quatre filières, vit dans
// src/components/dashboard/ProviderDashboard.tsx (non routée : un page.tsx ne peut pas être aussi
// un composant à props, `next build` le refuse).
export default function Page() {
  return <ProviderDashboard slug="expert-digital" />;
}
