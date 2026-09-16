import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { closeTimeContract } from "@/lib/spot-time-actions";

// Clôture d'un contrat au temps par le CLIENT (§22) : la mission passe `cloturee` et le solde non
// consommé du plafond lui est restitué dans la foulée. Les refus (relevé en attente, créance non
// payée, médiation ouverte) sont décrits dans closeTimeContract (src/lib/spot-time-actions.ts).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const res = await closeTimeContract({ missionId, clientId: userId });
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, count: res.count },
      { status: res.error === "not_found" ? 404 : 409 }
    );
  }
  return NextResponse.json(res);
}
