import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";

const MATCH_COUNT = 3;

/**
 * Notifie jusqu'à 3 prestataires KYC vérifiés dont le domaine principal déclaré correspond
 * à la mission. Aucune notion de certification ici — le matching se fait sur une donnée
 * déclarative (Profile.mainDomain), pas sur une vérification de la plateforme.
 */
export async function notifyMatchingProviders(missionId: string, domaine: string) {
  const candidates = await prisma.user.findMany({
    where: {
      role: { not: "client" },
      kycStatus: "verifie",
      profile: { mainDomain: domaine },
    },
    take: MATCH_COUNT,
  });

  if (candidates.length === 0) return [];

  await prisma.missionNotification.createMany({
    data: candidates.map((c) => ({ missionId, userId: c.id })),
  });

  await Promise.all(
    candidates.map((c) =>
      sendMail({
        to: c.email,
        subject: "Nouvelle mission disponible dans votre domaine",
        text: `Une nouvelle mission dans le domaine "${domaine}" vient d'être publiée sur Flexwork. Connectez-vous pour la consulter et candidater.`,
        html: `<p>Une nouvelle mission dans le domaine <strong>${domaine}</strong> vient d'être publiée sur Flexwork.</p><p>Connectez-vous pour la consulter et candidater.</p>`,
      })
    )
  );

  return candidates.map((c) => c.id);
}
