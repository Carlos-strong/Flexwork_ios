import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import type { NotificationType } from "@prisma/client";

// Notifie un utilisateur sur deux canaux à la fois — notification in-app (dashboard, via
// Notification) et e-mail (src/lib/mail.ts, Mailpit en dev) — pour tout événement compte qui
// n'est pas rattaché à une Mission (MissionNotification ne convient pas ici, missionId
// obligatoire). Les deux canaux sont indépendants : un échec d'e-mail n'empêche jamais la
// création de la notification in-app.
export async function notifyUser(params: {
  userId: string;
  type: NotificationType;
  message: string;
  email: { subject: string; text: string; html?: string };
}) {
  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { email: true } });

  const notification = await prisma.notification.create({
    data: { userId: params.userId, type: params.type, message: params.message },
  });

  if (user) {
    await sendMail({ to: user.email, subject: params.email.subject, text: params.email.text, html: params.email.html });
  }

  return notification;
}
