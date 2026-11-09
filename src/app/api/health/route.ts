import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { queueMode } from "@/lib/queue-mode";
import { workerStatus } from "@/lib/worker-heartbeat";

// Sonde de santé (2026-10-01) — pour le healthcheck du conteneur et une supervision externe
// (UptimeRobot, Better Stack…). 200 si tout va bien, 503 sinon.
//
// Elle vérifie aussi le WORKER, quand l'application en dépend (QUEUE_MODE=worker) : un worker
// arrêté ne peut pas donner l'alerte lui-même — ses alertes se taisent avec lui. Seul un
// observateur extérieur qui interroge cette route le voit.
//
// Aucune donnée métier exposée : des états, des horodatages, un nombre de répliques.
export const dynamic = "force-dynamic";

export async function GET() {
  let db: "ok" | "down" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }

  const workerRequired = queueMode() === "worker";
  const worker = db === "ok" ? await workerStatus().catch(() => null) : null;
  const workerOk = !workerRequired || (worker !== null && !worker.stale);
  const ok = db === "ok" && workerOk;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      worker: { required: workerRequired, alive: worker?.alive ?? 0, lastSeenAt: worker?.lastSeenAt ?? null },
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
