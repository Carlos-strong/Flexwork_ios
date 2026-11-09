"use client";

// Layout du segment mission : applique le chrome par défaut de l'app (sidebar + navbar
// DashboardLayout adapté au rôle connecté, MissionPageShell) aux sous-pages mission restées
// autonomes — proposals, contract, escrow, checkin, mediation, reviews (2026-09-03).
// Pages EXCLUES (elles gèrent déjà leur propre chrome ou une redirection) :
//   - /missions/[id] (détail) : le client propriétaire d'une mission engagée affiche déjà
//     ClientValidationWorkspace (chrome), le détail prestataire reste inchangé ;
//   - /deliverable et /devis : déjà enveloppées dans leur propre DashboardLayout ;
//   - /validation-client : simple redirection serveur vers /missions/[id].
// MissionPageShell redirige aussi les visiteurs non connectés vers /signin.
import { usePathname } from "next/navigation";
import MissionPageShell from "@/components/dashboard/MissionPageShell";

const ALREADY_CHROMED = ["/deliverable", "/devis", "/validation-client"] as const;

const SECTION_TITLE: Record<string, string> = {
  proposals: "Propositions",
  contract: "Contrat",
  escrow: "Séquestre",
  checkin: "Check-in",
  mediation: "Médiation",
  reviews: "Avis",
};

export default function MissionWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  // Détail de la mission : pathname = /missions/{id} (aucun segment de sous-page).
  const isBaseDetail = /\/missions\/[^/]+$/.test(pathname);
  const alreadyChrome = ALREADY_CHROMED.some((m) => pathname.includes(m));

  if (isBaseDetail || alreadyChrome) return <>{children}</>;

  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  return <MissionPageShell title={SECTION_TITLE[segment] ?? "Mission"}>{children}</MissionPageShell>;
}
