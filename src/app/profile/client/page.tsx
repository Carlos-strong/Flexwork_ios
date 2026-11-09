import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ClientProfileForm from "./client-profile-form";

// Pendant de /profile : la garde empêche un PRESTATAIRE PUR de créer ici une ligne
// ClientProfile sans objet — il perdrait l'accès à son domaine d'intervention, à son
// portfolio et à ses garants, qui ne vivent que sur l'autre page.
//
// ⚠️ La garde portait sur `role !== "client"` (corrigée 2026-09-23, décision « Option C »).
// C'était sûr tant que le rôle était IMMUABLE — écrit une seule fois, à l'inscription.
// Depuis que « Devenir prestataire » le change, la promotion d'un client vers une filière
// l'aurait éjecté de son propre profil client sans qu'il ait rien demandé : un compte qui
// achète aussi des missions ne doit pas perdre la moitié de son profil en s'inscrivant comme
// prestataire. La règle est donc : renvoyer vers /profile un compte qui n'a RIEN de client à
// éditer — c'est-à-dire un prestataire SANS profil client — et non un prestataire tout court.
export default async function ClientProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isProvider: true, clientProfile: { select: { id: true } } },
  });

  if (user?.isProvider && !user.clientProfile) redirect("/profile");

  return <ClientProfileForm />;
}
