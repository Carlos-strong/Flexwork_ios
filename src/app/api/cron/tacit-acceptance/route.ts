import { NextResponse } from "next/server";
import { runTacitAcceptanceSweep } from "@/lib/tacit-acceptance";

// Acceptation tacite des livrables (2026-09-14) — applique la clause 3 du contrat : « à défaut
// de contestation dans ce délai, le jalon est réputé accepté et son paiement est déclenché
// automatiquement ». Exécuter périodiquement (cron), même patron que
// /api/cron/contract-expirations et /api/cron/gig-order-expirations (Bearer CRON_SECRET).
//
// Idempotent par nature : chaque passe ne retient que les livrables encore `livrable_soumis`
// dont le délai est écoulé, et l'émission est verrouillée. Repasser deux fois de suite ne
// libère rien deux fois — la seconde passe ne trouve plus de livrable en attente.
//
// La fréquence d'exécution n'a pas à être précise : le délai contractuel se compte en jours.
// Une passe quotidienne suffit, et un retard de quelques heures ne fait que prolonger d'autant
// le temps laissé au client pour se prononcer — jamais l'inverse.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await runTacitAcceptanceSweep();
  return NextResponse.json(report);
}
