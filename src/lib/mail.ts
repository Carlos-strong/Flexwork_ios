import nodemailer from "nodemailer";

// Envoi d'e-mails de notification (OTP par e-mail, mise en relation d'une mission) via
// Mailtrap. En "Sandbox" (MAILTRAP_MODE=sandbox, par défaut), rien ne part réellement vers
// une boîte destinataire — tout est capturé dans l'inbox de test Mailtrap, pratique en dev.
// En "send"/production, passer MAILTRAP_MODE=send avec les identifiants d'un compte Sending
// Mailtrap (host live.smtp.mailtrap.io) pour une livraison réelle.
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.MAILTRAP_HOST ?? "localhost";
  const port = Number(process.env.MAILTRAP_PORT ?? 1025);
  const user = process.env.MAILTRAP_USER || undefined;
  const pass = process.env.MAILTRAP_PASS || undefined;

  // Mailpit (localhost:1025) n'a pas d'auth — si user/pass absents, on n'en met pas.
  const auth = user && pass ? { user, pass } : undefined;

  transporter = nodemailer.createTransport({ host, port, auth, secure: false });
  return transporter;
}

export async function sendMail(params: { to: string; subject: string; text: string; html?: string }) {
  const client = getTransporter();
  if (!client) {
    console.log(`[MAIL STUB — MAILTRAP_USER/PASS absents] to=${params.to} subject="${params.subject}"`);
    return { delivered: false as const };
  }

  try {
    await client.sendMail({
      from: process.env.MAIL_FROM ?? "Flexwork <no-reply@flexwork.app>",
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return { delivered: true as const };
  } catch (err: any) {
    console.error(`[MAIL ERROR] ${err.message || err}`);
    console.log(`[MAIL FALLBACK — OTP] to=${params.to} subject="${params.subject}" code visible in OTP STUB log above`);
    return { delivered: false as const };
  }
}
