import { prisma } from "@/lib/db";
import { notifyUser } from "@/lib/notify";

// Notification des messages de la messagerie (2026-09-09) — auparavant AUCUN canal n'était
// déclenché à l'envoi : ni cloche, ni e-mail. Les deux parties sont prévenues, l'expéditeur
// comme le destinataire.
//
// Cadence e-mail : « un seul e-mail tant que le précédent n'a pas été lu ». Une conversation
// active ne produit donc pas un e-mail par message. Le signal de lecture est la notification
// elle-même (Notification.readAt) : elle passe à lue quand le destinataire ouvre le fil de la
// conversation (GET /api/messages?missionId=…) ou la cloche du navbar. Tant qu'une
// notification de ce type reste non lue pour CETTE mission, les suivantes n'alimentent que la
// cloche — sans e-mail.

export const MESSAGE_RECEIVED = "message_recu";
export const MESSAGE_SENT = "message_envoye";

async function hasUnreadOfType(userId: string, missionId: string, type: string): Promise<boolean> {
  const pending = await prisma.notification.count({
    where: { userId, missionId, type, readAt: null },
  });
  return pending > 0;
}

/**
 * Interlocuteur d'une conversation, avec la MÊME règle que la liste des conversations
 * (GET /api/messages) : le client parle au prestataire dont la candidature est acceptée, à
 * défaut au premier candidat ; le prestataire parle au client de la mission.
 * Renvoie null quand la conversation n'a pas encore de second participant.
 */
export async function resolveCounterpart(missionId: string, senderId: string): Promise<string | null> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: {
      clientId: true,
      proposals: { select: { providerId: true, status: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!mission) return null;

  if (mission.clientId === senderId) {
    const accepted = mission.proposals.find((p) => p.status === "acceptee");
    return (accepted ?? mission.proposals[0])?.providerId ?? null;
  }
  return mission.clientId;
}

/**
 * Notifie l'envoi d'un message : cloche + e-mail pour le destinataire ET pour l'expéditeur.
 * Ne rejette jamais — un envoi de message ne doit pas échouer parce qu'une notification a
 * échoué.
 */
export async function notifyNewMessage(params: {
  missionId: string;
  senderId: string;
  /** Aperçu du message (contenu texte, ou nom du fichier pour une pièce jointe). */
  preview: string;
  isFile?: boolean;
}) {
  try {
    const [counterpartId, mission, sender] = await Promise.all([
      resolveCounterpart(params.missionId, params.senderId),
      prisma.mission.findUnique({ where: { id: params.missionId }, select: { titre: true } }),
      prisma.user.findUnique({ where: { id: params.senderId }, select: { firstname: true, lastname: true, email: true } }),
    ]);

    const missionTitre = mission?.titre ?? "votre mission";
    const senderName = [sender?.firstname, sender?.lastname].filter(Boolean).join(" ").trim() || sender?.email || "Votre interlocuteur";
    const extrait = params.preview.length > 140 ? `${params.preview.slice(0, 140)}…` : params.preview;
    const quoi = params.isFile ? `a envoyé un fichier : ${extrait}` : `: « ${extrait} »`;

    const tasks: Promise<unknown>[] = [];

    if (counterpartId) {
      const alreadyPending = await hasUnreadOfType(counterpartId, params.missionId, MESSAGE_RECEIVED);
      tasks.push(
        notifyUser({
          userId: counterpartId,
          type: MESSAGE_RECEIVED,
          missionId: params.missionId,
          message: `${senderName} ${params.isFile ? quoi : `vous a écrit ${quoi}`} — mission « ${missionTitre} ».`,
          // Un seul e-mail tant que le précédent n'a pas été lu.
          email: alreadyPending
            ? false
            : {
                subject: `Nouveau message de ${senderName} — ${missionTitre}`,
                text: `${senderName} vous a envoyé un message concernant la mission « ${missionTitre} » :\n\n${extrait}\n\nConnectez-vous à Flexwork pour répondre.`,
              },
        })
      );
    }

    // Accusé côté expéditeur, même cadence e-mail (pas un e-mail par message envoyé).
    const senderPending = await hasUnreadOfType(params.senderId, params.missionId, MESSAGE_SENT);
    tasks.push(
      notifyUser({
        userId: params.senderId,
        type: MESSAGE_SENT,
        missionId: params.missionId,
        message: counterpartId
          ? `Votre message a bien été envoyé — mission « ${missionTitre} ».`
          : `Message enregistré — mission « ${missionTitre} » (aucun interlocuteur pour l'instant).`,
        email: senderPending
          ? false
          : {
              subject: `Votre message a été envoyé — ${missionTitre}`,
              text: `Votre message concernant la mission « ${missionTitre} » a bien été envoyé :\n\n${extrait}`,
            },
      })
    );

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "rejected") console.error("[message-notify] Échec notification :", r.reason);
    }
  } catch (err) {
    console.error("[message-notify] Échec notification :", err);
  }
}

/**
 * Marque lues les notifications de messagerie d'une conversation — appelée quand
 * l'utilisateur ouvre le fil. C'est ce qui réarme l'envoi d'e-mail pour les messages
 * suivants (voir la cadence documentée en tête de fichier).
 */
export async function markConversationNotificationsRead(userId: string, missionId: string) {
  await prisma.notification.updateMany({
    where: { userId, missionId, type: { in: [MESSAGE_RECEIVED, MESSAGE_SENT] }, readAt: null },
    data: { readAt: new Date() },
  });
}
