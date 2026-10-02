import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ProviderProfileTabs from "@/components/profile/ProviderProfileTabs";

// Aiguillage du profil (2026-09-23).
//
// Depuis l'activation explicite de l'espace prestataire (décision « Option C »), ce n'est
// plus le RÔLE qui décide où l'on atterrit, mais `User.isProvider` :
//
//   - un compte CLIENT n'a rien à faire sur un formulaire qui exige un métier principal
//     (`Profile.mainDomain` est non nul en base) — il irait se déclarer électricien pour
//     pouvoir enregistrer une biographie. Il part sur /profile/client ;
//   - un compte qui exerce une filière prestataire sans avoir activé son espace est envoyé
//     vers /devenir-prestataire plutôt que sur un formulaire qu'il ne peut pas enregistrer.
//     C'était le cas de `responsable_chantier`, qui tombait ici sur un formulaire inutilisable
//     (mainDomain lui était réclamé alors qu'il n'a pas de domaine d'intervention) : point de
//     reprise connu, désormais fermé.
//
// L'onglet actif est lu dans l'URL (`?tab=`) : un lien vers « Domaines » doit ouvrir
// « Domaines », pas « Présentation ».
export default async function ProfilePage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isProvider: true },
  });

  if (!user?.isProvider) {
    redirect(user?.role === "client" ? "/profile/client" : "/devenir-prestataire");
  }

  return <ProviderProfileTabs initialTab={searchParams.tab} />;
}
