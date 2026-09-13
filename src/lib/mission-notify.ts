import { prisma } from "@/lib/db";
import { notifyUser, type NotifyEmail } from "@/lib/notify";
import { profileDomainFilter } from "@/lib/domain-match";

const MATCH_COUNT = 3;

// Notifie un utilisateur sur un événement rattaché à une mission précise (contrat généré,
// signature, jalon, livrable, escrow, point d'avancement). TROIS canaux depuis le
// 2026-09-09 :
//   1. fil « Activité récente » du dashboard (model MissionNotification) ;
//   2. cloche du navbar (model Notification, via notifyUser) — auparavant réservée au KYC ;
//   3. e-mail (src/lib/mail.ts) — désormais systématique : quand l'appelant ne fournit pas
//      de gabarit, notifyUser en génère un depuis le libellé de l'événement.
// Aucun de ces canaux ne peut faire échouer l'action métier appelante.
export async function notifyMissionUser(params: {
  missionId: string;
  userId: string;
  type: string;
  message: string;
  email?: NotifyEmail;
}) {
  await prisma.missionNotification.create({
    data: {
      missionId: params.missionId,
      userId: params.userId,
      type: params.type,
      message: params.message,
    },
  });

  try {
    await notifyUser({
      userId: params.userId,
      type: params.type,
      message: params.message,
      missionId: params.missionId,
      email: params.email,
    });
  } catch (err) {
    console.error(`[mission-notify] Échec cloche/e-mail (${params.type}, mission ${params.missionId}) :`, err);
  }
}

// Notifie LES DEUX PARTIES d'un événement de mission — celui qui vient d'agir et celui qui
// le subit — chacun avec sa formulation. Remplace les appels notifyMissionUser isolés qui
// ne prévenaient qu'un seul côté (2026-09-09). Ne rejette jamais.
export async function notifyMissionParties(params: {
  missionId: string;
  type: string;
  actor: { userId: string; message: string; email?: NotifyEmail };
  counterpart: { userId: string; message: string; email?: NotifyEmail };
}) {
  const results = await Promise.allSettled([
    notifyMissionUser({ missionId: params.missionId, userId: params.actor.userId, type: params.type, message: params.actor.message, email: params.actor.email }),
    notifyMissionUser({ missionId: params.missionId, userId: params.counterpart.userId, type: params.type, message: params.counterpart.message, email: params.counterpart.email }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error(`[mission-notify] Échec notification (${params.type}) :`, r.reason);
  }
}

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
      // Correspondance partielle insensible à la casse, et non égalité stricte : le domaine de
      // la mission et le `mainDomain` du profil sont deux saisies libres, faites à deux moments
      // par deux personnes. Un profil « Digital. » ne matchait ni « Digital » ni « digital », et
      // la publication annonçait « 0 prestataire(s) … notifiés » sans que rien ne soit en cause
      // côté données (voir src/lib/domain-match.ts).
      profiles: { some: profileDomainFilter(domaine) },
    },
    take: MATCH_COUNT,
  });

  if (candidates.length === 0) return [];

  // Passe par notifyMissionUser pour que ces prestataires reçoivent le matching sur les
  // trois canaux comme n'importe quel autre événement (fil d'activité + cloche + e-mail) —
  // avant 2026-09-09 la ligne était écrite en direct et n'apparaissait jamais dans la cloche.
  await Promise.allSettled(
    candidates.map((c) =>
      notifyMissionUser({
        missionId,
        userId: c.id,
        type: "mission_match",
        message: `Nouvelle mission dans votre domaine « ${domaine} » — connectez-vous pour la consulter et candidater.`,
        email: {
          subject: "Nouvelle mission disponible dans votre domaine",
          text: `Une nouvelle mission dans le domaine "${domaine}" vient d'être publiée sur Flexwork. Connectez-vous pour la consulter et candidater.`,
          html: `<p>Une nouvelle mission dans le domaine <strong>${domaine}</strong> vient d'être publiée sur Flexwork.</p><p>Connectez-vous pour la consulter et candidater.</p>`,
        },
      })
    )
  );

  return candidates.map((c) => c.id);
}
