import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getClientIp } from "@/lib/otp";
import { sendSignatureResetOtp } from "@/lib/signature-reset";

export const dynamic = "force-dynamic";

// POST /api/signature/certificate/reset-otp — envoie le code exigé pour remplacer un
// certificat de signature actif (passphrase oubliée). Voir src/lib/signature-reset.ts.
const MESSAGES = {
  no_active_certificate: "Aucun certificat actif à remplacer : créez directement votre certificat.",
  too_many_requests: "Trop de demandes de code. Réessayez dans quelques minutes.",
  send_failed: "Le code n'a pas pu être envoyé. Réessayez dans un instant.",
} as const;
const STATUS = { no_active_certificate: 409, too_many_requests: 429, send_failed: 502 } as const;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const result = await sendSignatureResetOtp(userId, getClientIp(req));
  if (!result.ok) {
    return NextResponse.json({ error: MESSAGES[result.error], code: result.error }, { status: STATUS[result.error] });
  }
  return NextResponse.json({ success: true, destination: result.destination });
}
