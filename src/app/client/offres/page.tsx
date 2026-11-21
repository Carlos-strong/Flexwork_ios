import ClientDashboardPage from "@/components/dashboard/ClientDashboardPage";

// Rubrique « Offres » du sidebar client : catalogue des Gigs, achat et suivi des commandes
// (signature 1/2). Remplace les pages autonomes /gigs, /gigs/[id] et /gigs/commandes/[id].
export default function Page() {
  return <ClientDashboardPage initialNav="offres" />;
}
