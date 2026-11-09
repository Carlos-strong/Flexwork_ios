import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { safeCallbackUrl, withCallbackUrl } from "@/lib/safe-callback";
import { BecomeProviderForm } from "@/components/profile/BecomeProviderForm";

// Écran P4 — activation de l'espace prestataire (décision « Option C »).
//
// Un compte déjà prestataire n'a rien à faire ici : il est renvoyé vers son profil plutôt que
// de voir un écran d'activation qui lui proposerait d'activer ce qui l'est déjà.
//
// `?returnTo=` (2026-11-03) : page d'origine — une mission ouverte par « Candidater » sur
// l'accueil. Une fois l'espace ouvert, le prestataire y retourne pour candidater.
export default async function DevenirPrestatairePage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const raw = (await searchParams).returnTo;
  const returnTo = safeCallbackUrl(typeof raw === "string" ? raw : null);

  const session = await auth();
  if (!session?.user) redirect(withCallbackUrl("/signin", withCallbackUrl("/devenir-prestataire", returnTo, "returnTo")));

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isProvider: true } });
  if (user?.isProvider) redirect(returnTo ?? "/profile");

  return <BecomeProviderForm returnTo={returnTo} />;
}
