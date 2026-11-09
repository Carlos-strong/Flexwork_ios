import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ProviderProfileTabs from "@/components/profile/ProviderProfileTabs";
import { safeCallbackUrl, withCallbackUrl } from "@/lib/safe-callback";

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
// Typographie de l'application (2026-11-07) : texte courant en Inter (police du body,
// src/app/layout.tsx), titres en Plus Jakarta Sans via `.landing` — le même couple que l'accueil
// et /recherche (voir globals.css). Chargée ici, comme sur ces pages, pour ne pas l'imposer
// au reste de l'application.
const display = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-landing-display",
  display: "swap",
});

export default async function ProfilePage({ searchParams }: { searchParams: { tab?: string; returnTo?: string | string[] } }) {
  const session = await auth();
  // `?returnTo=` : page d'origine (mission, devis) d'où l'on a été envoyé compléter son profil
  // — même convention et même filtre anti-redirection ouverte que /devenir-prestataire.
  const returnTo = safeCallbackUrl(typeof searchParams.returnTo === "string" ? searchParams.returnTo : null);
  if (!session?.user) redirect(withCallbackUrl("/signin", withCallbackUrl("/profile", returnTo, "returnTo")));

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isProvider: true },
  });

  if (!user?.isProvider) {
    redirect(user?.role === "client" ? "/profile/client" : withCallbackUrl("/devenir-prestataire", returnTo, "returnTo"));
  }

  return (
    <div className={`landing ${display.variable}`}>
      <ProviderProfileTabs initialTab={searchParams.tab} returnTo={returnTo} userId={userId} />
    </div>
  );
}
