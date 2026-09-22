import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/adminGuard";
import { AdminShell } from "@/components/admin/admin-shell";
import { adminHomeForRole, modulesForRole, type AdminSpace } from "@/lib/admin-roles";

/**
 * Porte commune des deux espaces d'administration (`/admin` et `/backoffice`).
 *
 * `flexwork_job` ne pose aucune garde dans ses gabarits et son middleware ne couvre pas
 * `/backoffice` : son espace « Rôles & Accès » y est public. Ici la même porte sert les deux
 * espaces, pour qu'aucun des deux ne puisse être oublié.
 *
 * Elle ne remplace pas les gardes d'API : un gabarit protège un affichage, une garde de route
 * protège la donnée, et un appel direct à l'API ne traverse aucun gabarit.
 */
export async function AdminGate({ space, children }: { space: AdminSpace; children: React.ReactNode }) {
  const guard = await requireAdmin();

  if ("error" in guard) {
    if (guard.error === "unauthenticated") redirect("/signin");
    return (
      <Notice
        title="Accès refusé"
        body="Ce compte n’a pas les droits d’administration. Si vous pensez qu’il s’agit d’une erreur, contactez l’administrateur de la plateforme."
        action={{ href: "/", label: "Retour à l’accueil" }}
      />
    );
  }

  // `isAdmin = true` sans rôle : aucun pouvoir précis. Aucun espace ne lui correspond — lui en
  // montrer un reviendrait à lui prêter un pouvoir que la base ne lui a pas donné.
  const role = guard.user.adminRole;
  if (!role) {
    return (
      <Notice
        title="Aucun pouvoir attribué"
        body={`Le compte ${guard.user.email} est marqué administrateur mais aucun rôle (kyc, modération, médiation, superviseur, éditeur du site) ne lui a été attribué en base. Les rôles s’attribuent directement en base, par séparation des pouvoirs.`}
        action={{ href: "/signin", label: "Se connecter avec un autre compte" }}
      />
    );
  }

  // Un rôle sans aucune rubrique dans cet espace est renvoyé vers son accueil, ICI, côté serveur
  // et avant tout rendu. La redirection vivait dans la page `/admin` ; en rendu en flux, elle ne
  // s'exécute qu'une fois la page montée — or la coquille, voyant un chemin hors du pouvoir du
  // rôle, ne la montait jamais. L'éditeur du site restait devant « Hors de votre pouvoir » au
  // lieu d'arriver au Back Office (constaté le 2026-09-21).
  if (modulesForRole(role, space).length === 0) redirect(adminHomeForRole(role));

  return (
    <AdminShell role={role} space={space} user={{ id: guard.user.id, email: guard.user.email }}>
      {children}
    </AdminShell>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action: { href: string; label: string } }) {
  return (
    <div className="min-h-screen bg-[#F4F3EF] flex items-center justify-center px-4">
      <div className="max-w-[440px] w-full bg-white border border-[#E2E0D9] rounded-[16px] p-6 text-center shadow-sm">
        <div className="text-[15px] font-semibold text-[#1A1916]">{title}</div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#5A5750]">{body}</p>
        <Link
          href={action.href}
          className="mt-4 inline-flex items-center h-10 px-4 rounded-lg bg-[#2D5BE3] text-white text-[13px] font-semibold"
          style={{ textDecoration: "none" }}
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}
