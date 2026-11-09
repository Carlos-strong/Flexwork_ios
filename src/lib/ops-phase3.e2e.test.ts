/**
 * Exploitation, phase 3 (2026-10-01) — alertes, battement du worker, sonde de santé, URLs.
 */
import { describe, expect, it, afterAll, afterEach, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { prisma } from "@/lib/db";
import { directDatabaseUrl, pgbouncerWithoutDirectUrl } from "@/lib/db-urls";
import { evaluateAlerts, signalsFromFinance, signalsFromQueues, type AlertSignal } from "@/lib/ops-alerts";
import { beat, forget, WORKER_STALE_MS, workerIdentity } from "@/lib/worker-heartbeat";
import type { Anomaly } from "@/lib/admin-finance";

const RUN = Date.now();
const SCOPE = `test${RUN}.`;
const HOUR = 60 * 60_000;

afterEach(() => {
  delete process.env.QUEUE_MODE;
  delete process.env.DIRECT_DATABASE_URL;
});

afterAll(async () => {
  await prisma.opsAlert.deleteMany({ where: { key: { startsWith: SCOPE } } });
  await prisma.workerHeartbeat.deleteMany({ where: { id: { startsWith: `test-${RUN}` } } });
});

describe("alertes", () => {
  const signal = (name: string, severity: AlertSignal["severity"] = "critical"): AlertSignal => ({
    key: `${SCOPE}${name}`,
    severity,
    title: `Titre ${name}`,
    detail: `Détail ${name}`,
  });

  it("ouvre, tait, rappelle, puis annonce la résolution", async () => {
    const sent: string[] = [];
    const notify = vi.fn(async (m: { subject: string }) => void sent.push(m.subject));
    const t0 = new Date("2026-10-01T08:00:00Z");

    expect(await evaluateAlerts(SCOPE, [signal("a")], notify, t0)).toEqual({ opened: [`${SCOPE}a`], reminded: [], resolved: [] });
    expect(sent).toEqual(["🔴 Titre a"]);

    // Cinq minutes plus tard, toujours là : pas de nouveau message.
    await evaluateAlerts(SCOPE, [signal("a")], notify, new Date(t0.getTime() + 5 * 60_000));
    expect(sent).toHaveLength(1);

    // Six heures plus tard : rappel.
    const r = await evaluateAlerts(SCOPE, [signal("a")], notify, new Date(t0.getTime() + 6 * HOUR));
    expect(r.reminded).toEqual([`${SCOPE}a`]);
    expect(sent[1]).toMatch(/^🔴 Toujours en cours \(360 min\) : Titre a$/);

    // Disparu : résolu, une fois.
    expect((await evaluateAlerts(SCOPE, [], notify, new Date(t0.getTime() + 7 * HOUR))).resolved).toEqual([`${SCOPE}a`]);
    expect(sent[2]).toBe("✅ Résolu : Titre a");
    await evaluateAlerts(SCOPE, [], notify, new Date(t0.getTime() + 8 * HOUR));
    expect(sent).toHaveLength(3);

    // Réapparaît : nouvelle alerte.
    expect((await evaluateAlerts(SCOPE, [signal("a")], notify, new Date(t0.getTime() + 9 * HOUR))).opened).toEqual([`${SCOPE}a`]);
  });

  it("une portée ne résout pas les alertes d'une autre", async () => {
    const notify = vi.fn(async () => {});
    await evaluateAlerts(`${SCOPE}x.`, [signal("x.one")], notify);
    await evaluateAlerts(`${SCOPE}y.`, [], notify);
    const row = await prisma.opsAlert.findUniqueOrThrow({ where: { key: `${SCOPE}x.one` } });
    expect(row.resolvedAt).toBeNull();
  });

  it("signaux des files : seulement ce qui est anormal", () => {
    const quiet = signalsFromQueues(
      { outboxPending: 3, outboxLate: 0, outboxAbandoned: 0, inboxPending: 2, inboxFailed: 0, stalePending: 0 },
      { pending: 4, late: 0, failed: 0 }
    );
    expect(quiet).toEqual([]);
    const noisy = signalsFromQueues(
      { outboxPending: 0, outboxLate: 0, outboxAbandoned: 2, inboxPending: 0, inboxFailed: 1, stalePending: 0 },
      { pending: 0, late: 3, failed: 0 }
    );
    expect(noisy.map((s) => [s.key, s.severity])).toEqual([
      ["queues.psp_outbox_abandoned", "critical"],
      ["queues.psp_inbox_failed", "critical"],
      ["queues.emails_late", "warning"],
    ]);
  });

  it("signaux financiers : critiques seulement, regroupés par nature", () => {
    const a = (kind: Anomaly["kind"], severity: Anomaly["severity"], title: string): Anomaly => ({
      id: title, kind, severity, title, detail: "d", contractId: null, orderId: null, missionId: null, amount: 0, since: null,
    });
    const signals = signalsFromFinance([
      a("invariant_violation", "critical", "Solde négatif"),
      a("invariant_violation", "critical", "Sur-libération"),
      a("stale_instruction", "warning", "Instruction ancienne"),
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ key: "finance.invariant_violation", title: "Registre financier : Solde négatif (+1)" });
  });
});

describe("sonde de santé et battement du worker", () => {
  it("mode inline : 200 sans worker", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok", worker: { required: false } });
  });

  it("mode worker : 503 sans battement récent, 200 dès qu'un worker bat", async () => {
    process.env.QUEUE_MODE = "worker";
    // Base de test : on écarte les battements récents laissés par un essai manuel du worker.
    await prisma.workerHeartbeat.deleteMany({ where: { lastSeenAt: { gte: new Date(Date.now() - WORKER_STALE_MS) } } });
    const stale = await health();
    expect(stale.status).toBe(503);
    expect((await stale.json()).status).toBe("degraded");

    const identity = { ...workerIdentity(), id: `test-${RUN}-1` };
    await beat(identity);
    const res = await health();
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toMatchObject({ required: true, alive: 1 });

    await forget(identity);
    expect((await health()).status).toBe(503);
  });
});

describe("URL directe (PgBouncer)", () => {
  it("retire les paramètres propres à Prisma", () => {
    expect(directDatabaseUrl("postgresql://u:p@db:6432/app?schema=public&pgbouncer=true&connection_limit=5&sslmode=require")).toBe(
      "postgresql://u:p@db:6432/app?sslmode=require"
    );
  });

  it("préfère DIRECT_DATABASE_URL, et signale PgBouncer sans elle", () => {
    const saved = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://u@pgbouncer:6432/app?pgbouncer=true";
      expect(pgbouncerWithoutDirectUrl()).toBe(true);
      process.env.DIRECT_DATABASE_URL = "postgresql://u@db:5432/app";
      expect(pgbouncerWithoutDirectUrl()).toBe(false);
      expect(directDatabaseUrl()).toBe("postgresql://u@db:5432/app");
    } finally {
      process.env.DATABASE_URL = saved;
    }
  });
});
