import { NextResponse } from "next/server";
import { runResidualRefundSweep } from "@/lib/residual-refund";

// Remboursement du reliquat séquestré des missions terminées (§22 du cahier des charges —
// « il ne doit jamais rester un argent fantôme dans la mission »).
//
// Même patron que les quatre autres crons (Bearer CRON_SECRET). Idempotent par le solde : une
// mission déjà soldée n'a plus rien à rendre, et repasser ne rembourse pas deux fois.
//
// Fréquence : quotidienne. Un reliquat n'est pas urgent — il est seulement inacceptable qu'il
// dorme indéfiniment.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runResidualRefundSweep());
}
