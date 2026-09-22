import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/adminGuard";
import { adminHomeForRole, modulesForRole } from "@/lib/admin-roles";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

/**
 * `/admin` — Dashboard de l'espace « Admin Métier » (architecture flexwork_job).
 *
 * Un seul écran pour quatre pouvoirs, mais pas un seul contenu : chaque rôle n'y voit que les
 * indicateurs qu'il a le droit de lire (`/api/admin/dashboard` ne calcule même pas les autres)
 * et que les rubriques de sa sidebar. Aucun geste n'y est offert — le tableau de bord renvoie
 * vers la rubrique qui détient le pouvoir.
 *
 * Un rôle sans rubrique dans cet espace (l'éditeur du site, dont tout le travail est au Back
 * Office) est renvoyé vers son propre accueil, côté serveur : pas d'écran vide qui clignote.
 */
export default async function AdminIndexPage() {
  const guard = await requireAdmin();
  if ("error" in guard) redirect("/signin");

  const role = guard.user.adminRole;
  if (!role) redirect("/signin");

  if (!modulesForRole(role, "admin").some((m) => m.id === "dashboard")) redirect(adminHomeForRole(role));

  return <AdminDashboard />;
}
