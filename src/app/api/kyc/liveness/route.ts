import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// US-1305 : contrôle de vivacité en plus du selfie KYC.
// Stub local : le SDK réel (capture vidéo / mouvements demandés) sera branché plus tard,
// ici le client envoie le résultat des étapes simulées (clignement, rotation de tête).
const schema = z.object({
  stepsCompleted: z.array(z.enum(["blink", "turn_head"])).min(2),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const passed =
    parsed.data.stepsCompleted.includes("blink") &&
    parsed.data.stepsCompleted.includes("turn_head");

  const check = await prisma.livenessCheck.create({
    data: {
      userId,
      passed,
      provider: "stub",
      metadata: { stepsCompleted: parsed.data.stepsCompleted },
    },
  });

  return NextResponse.json({ passed: check.passed });
}
