import PgBoss from "pg-boss";
import { prisma } from "@/lib/db";
import { ITEM_JOBS, SCHEDULED_JOBS, queuesHealth } from "@/worker/jobs";
import { pgbouncerWithoutDirectUrl, directDatabaseUrl } from "@/lib/db-urls";
import { beat, forget, workerIdentity } from "@/lib/worker-heartbeat";
import { runWorkerTick } from "@/worker/tick";

// ---------------------------------------------------------------------------
// Worker (2026-10-01) — processus distinct du serveur web : `npm run worker`. Sur un VPS ou en
// conteneur, il tourne à côté de `next start` (même image, autre commande) ; plusieurs répliques
// sont possibles.
//
//   - Boucle rapide (WORKER_POLL_MS, 1 s par défaut) : outbox PSP, inbox des webhooks, outbox des
//     e-mails. Une requête indexée par table et par tour à vide.
//   - Tâches planifiées et réparties : voir src/worker/jobs.ts. Elles remplacent le cron système
//     des routes /api/cron/* (qui restent appelables pour un déploiement sans worker).
//
// L'état durable vit dans les tables métier, pas dans pg-boss : vider ou recréer le schéma
// `pgboss` ne perd ni paiement ni e-mail. Seuls les jobs par contrat en attente seraient perdus,
// et la sélection suivante les recrée.
// ---------------------------------------------------------------------------

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);
const ITEM_CONCURRENCY = Math.max(1, Number(process.env.WORKER_ITEM_CONCURRENCY ?? 4));
// Les échéances quotidiennes (3 h 30, 4 h) se lisent à l'heure du Bénin, pas en UTC.
const TZ = process.env.WORKER_TZ ?? "Africa/Porto-Novo";

const HEARTBEAT_MS = 15_000;

const log = (job: string, result: unknown) => console.log(`[worker] ${job} ${JSON.stringify(result)}`);

async function main() {
  if (pgbouncerWithoutDirectUrl()) {
    console.warn("[worker] DATABASE_URL passe par PgBouncer sans DIRECT_DATABASE_URL : pg-boss a besoin d'une connexion directe.");
  }
  // Connexion DIRECTE (hors PgBouncer en mode transaction) : voir src/lib/db-urls.ts.
  const boss = new PgBoss({
    connectionString: directDatabaseUrl(process.env.PGBOSS_DATABASE_URL),
    schema: "pgboss",
    application_name: "flexwork-worker",
  });
  boss.on("error", (error) => console.error("[worker] pg-boss", error));
  await boss.start();

  // ── Jobs par contrat ──
  for (const item of Object.values(ITEM_JOBS)) {
    await boss.createQueue(item.name, {
      name: item.name,
      policy: "stately",
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
    });
    // Un `work` par unité de concurrence : chacun prend un job à la fois.
    for (let i = 0; i < ITEM_CONCURRENCY; i++) {
      await boss.work<{ id: string }>(item.name, { batchSize: 1 }, async ([job]) => {
        // Une exception fait échouer le job : pg-boss le reprend (retryLimit, délai croissant).
        log(item.name, { id: job.data.id, result: await item.run(job.data.id) });
      });
    }
  }

  // ── Tâches planifiées ──
  for (const job of SCHEDULED_JOBS) {
    // Politique `singleton` : jamais deux exécutions simultanées de la même tâche, même avec
    // plusieurs répliques ou une échéance qui déborde sur la suivante.
    await boss.createQueue(job.name, { name: job.name, policy: "singleton", retryLimit: 2, expireInSeconds: 900 });
    await boss.schedule(job.name, job.cron, {}, { tz: TZ });
    await boss.work(job.name, async () => {
      if (job.fanOut) {
        const ids = await job.fanOut.select();
        if (ids.length > 0) {
          await boss.insert(ids.map((id) => ({ name: job.fanOut!.itemQueue, data: { id }, singletonKey: id })));
        }
        log(job.name, { queued: ids.length });
        return;
      }
      const result = await job.run();
      if (job.name === "queues-health") {
        const health = result as Awaited<ReturnType<typeof queuesHealth>>;
        (health.alert ? console.warn : console.log)(`[worker] santé des files ${health.alert ? "⚠️ " : ""}${JSON.stringify(health)}`);
      } else if (job.name === "finance-check") {
        const check = result as { critical: number };
        (check.critical > 0 ? console.warn : console.log)(`[worker] ${job.name} ${JSON.stringify(result)}`);
      } else {
        log(job.name, result);
      }
    });
  }

  // ── Battement ──
  const identity = workerIdentity();
  let lastBeat = 0;

  // ── Boucle rapide ──
  let stopping = false;
  let current: Promise<void> = Promise.resolve();
  const loop = async () => {
    while (!stopping) {
      let busy = false;
      current = runWorkerTick()
        .then((r) => {
          busy = r.busy;
          if (r.dispatched || r.inbound || r.emails) {
            console.log(`[worker] tour : ${r.dispatched} instruction(s), ${r.inbound} webhook(s), ${r.emails} e-mail(s)`);
          }
        })
        .catch((error) => console.error("[worker] tour en échec", error));
      await current;
      if (Date.now() - lastBeat >= HEARTBEAT_MS) {
        lastBeat = Date.now();
        await beat(identity).catch((error) => console.error("[worker] battement impossible", error));
      }
      if (!busy) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };
  void loop();
  console.log(
    `[worker] démarré — boucle ${POLL_MS} ms, ${SCHEDULED_JOBS.length} tâches planifiées (${TZ}), ` +
      `jobs par contrat ×${ITEM_CONCURRENCY}`
  );

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} — arrêt après le tour en cours`);
    await current;
    await boss.stop({ graceful: true, timeout: 30_000 });
    await forget(identity).catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  console.error("[worker] démarrage impossible", error);
  await prisma.$disconnect();
  process.exit(1);
});
