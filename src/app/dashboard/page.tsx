import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROLE_DASHBOARD } from "@/lib/role-dashboard";

// Relais serveur : résout le rôle via auth() (lecture du cookie JWT en process, pas
// d'appel réseau) et redirige vers le dashboard dédié. Appelé depuis verify-otp après
// validation OTP réussie — le rôle est résolu dans la même requête que la navigation,
// sans l'ancien getSession() qui faisait un GET /api/auth/session supplémentaire.
export default async function DashboardRedirectPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Les admins ont role=client dans la DB mais isAdmin=true — priorité à isAdmin
  // pour éviter de les rediriger vers /dashboard/client.
  if (session.user.isAdmin) redirect("/admin");
  redirect(ROLE_DASHBOARD[session.user.role] ?? "/dashboard/client");
}
