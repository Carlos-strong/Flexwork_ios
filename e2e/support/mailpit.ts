// Boîte de capture des e-mails (Mailpit, scripts/start-mailpit.js) : l'API REST permet de lire le
// code OTP réellement envoyé, comme le testeur le lirait dans sa boîte.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";

type Summary = { ID: string; Subject: string; To: { Address: string }[]; Created: string };

export async function waitForOtp(to: string, after: Date, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: Summary[] };
      const recent = messages.find((m) => new Date(m.Created) >= after && /\b\d{6}\b/.test(m.Subject));
      if (recent) return recent.Subject.match(/\b(\d{6})\b/)![1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Aucun code OTP reçu pour ${to}`);
}
