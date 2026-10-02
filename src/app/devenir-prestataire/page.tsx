import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { BecomeProviderForm } from "@/components/profile/BecomeProviderForm";

// Écran P4 — activation de l'espace prestataire (décision « Option C »).
//
// Un compte déjà prestataire n'a rien à faire ici : il est renvoyé vers son profil plutôt que
// de voir un écran d'activation qui lui proposerait d'activer ce qui l'est déjà.
export default async function DevenirPrestatairePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isProvider: true } });
  if (user?.isProvider) redirect("/profile");

  return <BecomeProviderForm />;
}
