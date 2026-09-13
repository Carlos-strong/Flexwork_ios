import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { notificationLabel } from "@/lib/notification-labels";

// Notification d'un utilisateur sur les DEUX canaux à la fois : cloche du navbar
// (model Notification, GET /api/notifications) et e-mail (src/lib/mail.ts, Mailpit en dev).
//
// Règle produit (2026-09-09) : tout événement notifiable passe par ici, pour l'acteur ET
// pour la partie adverse — plus aucun événement ne reste cantonné à un fil de dashboard.
// Les événements rattachés à une mission ajoutent en plus une ligne au fil « Activité
// récente » via notifyMissionUser (src/lib/mission-notify.ts), qui délègue ici.
//
// Les deux canaux sont indépendants : un échec d'e-mail n'empêche jamais la notification
// in-app, et une notification n'échoue jamais l'action métier qui l'a déclenchée.
export type NotifyEmail = { subject: string; text: string; html?: string };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// E-mail par défaut quand l'appelant n'en fournit pas : le sujet reprend le libellé de
// l'événement, le corps reprend le message affiché dans la cloche. Garantit qu'AUCUN
// événement ne parte sans e-mail, sans imposer à chaque appelant de rédiger un gabarit.
function defaultEmail(type: string, message: string): NotifyEmail {
  return {
    subject: `Flexwork — ${notificationLabel(type)}`,
    text: message,
    html: `<p>${escapeHtml(message)}</p>`,
  };
}

export async function notifyUser(params: {
  userId: string;
  type: string;
  message: string;
  /** Mission concernée, quand l'événement en dépend (mission, jalon, message). */
  missionId?: string | null;
  /** Gabarit e-mail ; `false` supprime l'e-mail (anti-spam messagerie), `undefined` en génère un. */
  email?: NotifyEmail | false;
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      message: params.message,
      missionId: params.missionId ?? null,
    },
  });

  if (params.email === false) return notification;

  const email = params.email ?? defaultEmail(params.type, params.message);
  try {
    const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { email: true } });
    if (user?.email) {
      await sendMail({ to: user.email, subject: email.subject, text: email.text, html: email.html });
    }
  } catch (err) {
    console.error(`[notify] Échec e-mail (${params.type}, user ${params.userId}) :`, err);
  }

  return notification;
}

// Notifie les deux parties d'un même événement — l'acteur (celui qui vient d'agir) et la
// partie adverse — chacun avec sa propre formulation. Ne rejette jamais : une notification
// ratée ne doit pas faire échouer la signature, la validation ou l'envoi qui l'a déclenchée.
export async function notifyBoth(params: {
  type: string;
  missionId?: string | null;
  actor: { userId: string; message: string; email?: NotifyEmail | false };
  counterpart: { userId: string; message: string; email?: NotifyEmail | false };
}) {
  const results = await Promise.allSettled([
    notifyUser({ userId: params.actor.userId, type: params.type, message: params.actor.message, missionId: params.missionId, email: params.actor.email }),
    notifyUser({ userId: params.counterpart.userId, type: params.type, message: params.counterpart.message, missionId: params.missionId, email: params.counterpart.email }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error(`[notify] Échec notification (${params.type}) :`, r.reason);
  }
}
