import { redirect } from "next/navigation";

// `/dashboard/client` reste le lien historique (ROLE_DASHBOARD, redirections post-login,
// liens codés en dur ailleurs dans l'app) mais l'URL canonique du dashboard client est
// `/client/dashboard` — même namespace que ses autres sections (/client/missions,
// /client/messages, /client/propositions, /client/paiements). L'implémentation réelle vit
// dans src/components/dashboard/ClientDashboardPage.tsx (non routée) ; garder les deux URLs
// routables dupliquait le même contenu sous deux chemins sans jamais rediriger l'un vers
// l'autre.
export default function DashboardClientRedirect() {
  redirect("/client/dashboard");
}
