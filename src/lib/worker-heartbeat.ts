import { hostname } from "os";
import { prisma } from "@/lib/db";

// Battement du worker (2026-10-01) — voir le modèle WorkerHeartbeat.

/** Un worker dont le dernier passage date de plus que cela est considéré arrêté. */
export const WORKER_STALE_MS = 2 * 60_000;

export function workerIdentity(startedAt = new Date()) {
  const host = hostname();
  return { id: `${host}-${process.pid}`, host, pid: process.pid, startedAt };
}

export async function beat(identity: ReturnType<typeof workerIdentity>, now = new Date()): Promise<void> {
  await prisma.workerHeartbeat.upsert({
    where: { id: identity.id },
    update: { lastSeenAt: now },
    create: { ...identity, lastSeenAt: now },
  });
}

export async function forget(identity: { id: string }): Promise<void> {
  await prisma.workerHeartbeat.deleteMany({ where: { id: identity.id } });
}

/** Supprime les répliques disparues depuis plus d'un jour (conteneurs recréés, etc.). */
export async function pruneHeartbeats(now = new Date()): Promise<number> {
  const { count } = await prisma.workerHeartbeat.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } } });
  return count;
}

export type WorkerStatus = { alive: number; lastSeenAt: string | null; stale: boolean };

export async function workerStatus(now = new Date()): Promise<WorkerStatus> {
  const since = new Date(now.getTime() - WORKER_STALE_MS);
  const [alive, latest] = await Promise.all([
    prisma.workerHeartbeat.count({ where: { lastSeenAt: { gte: since } } }),
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
  ]);
  return { alive, lastSeenAt: latest?.lastSeenAt.toISOString() ?? null, stale: alive === 0 };
}
