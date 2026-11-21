/**
 * Worker, phase 2 (2026-10-01) — e-mails en file, tâches réparties par contrat.
 *
 * Ce que ce fichier verrouille :
 *   1. en mode `worker`, une notification n'envoie rien dans la requête : l'e-mail est écrit en
 *      file, remis une seule fois par le worker, repris en cas d'échec SMTP puis abandonné ;
 *   2. la sélection de l'acceptation tacite ne retient QUE les contrats échus, avec les mêmes
 *      exclusions que le balayage (médiation, délai désactivé) ;
 *   3. la sélection des reliquats ne retient que les missions closes dont le séquestre garde un
 *      solde, et le remboursement par contrat est idempotent ;
 *   4. le registre des tâches est cohérent (noms uniques, files répartie déclarées).
 */

import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from "vitest";

const { sendMail, deliverMail } = vi.hoisted(() => ({ sendMail: vi.fn(), deliverMail: vi.fn() }));
vi.mock("@/lib/mail", () => ({ sendMail, deliverMail }));

import { prisma } from "@/lib/db";
import { deliverDueEmails, MAX_EMAIL_ATTEMPTS, queueMail } from "@/lib/mail-queue";
import { notifyUser } from "@/lib/notify";
import { findContractsWithResidual, refundResidualForContract } from "@/lib/residual-refund";
import { findDueTacitContractIds, runTacitAcceptanceForContract } from "@/lib/tacit-acceptance";
import { ITEM_JOBS, SCHEDULED_JOBS } from "@/worker/jobs";

const RUN = Date.now();
const TAG = `phase2_${RUN}`;
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];

async function contract(opts: {
  missionStatus: string;
  submittedDaysAgo?: number;
  deadlineDays?: number;
  jalon?: { status: string; submittedDaysAgo: number };
  ops?: { instructionType: "hold" | "release" | "refund" | "freeze"; amount: number; status: "pending" | "confirmed" | "failed" }[];
}) {
  const n = ++seq;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Phase 2 ${RUN} #${n}`,
      description: "Mission e2e du worker",
      domaine: "batiment",
      budget: 100_000,
      currency: "XOF",
      delaiJours: 30,
      status: opts.missionStatus as never,
      submittedAt: opts.submittedDaysAgo === undefined ? null : new Date(Date.now() - opts.submittedDaysAgo * DAY),
    },
  });
  missionIds.push(mission.id);
  const c = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: 100_000, devise: "XOF" },
      currentHash: `hash-${TAG}-${n}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      acceptanceDeadlineDays: opts.deadlineDays ?? 7,
    },
  });
  contractIds.push(c.id);
  if (opts.jalon) {
    await prisma.jalon.create({
      data: {
        contractId: c.id,
        ordre: 1,
        titre: "Gros œuvre",
        montant: 100_000,
        status: opts.jalon.status as never,
        submittedAt: new Date(Date.now() - opts.jalon.submittedDaysAgo * DAY),
      },
    });
  }
  for (const [i, op] of (opts.ops ?? []).entries()) {
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: c.id,
        pspName: "psp-test",
        pspReference: `${op.instructionType}_${TAG}_${n}_${i}`,
        dispatchStatus: "envoyee",
        ...op,
      },
    });
  }
  return c.id;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  const mk = (suffix: string, role: "client" | "artisan") =>
    prisma.user.create({
      data: { email: `e2e-${TAG}-${suffix}@flexwork.test`, tel: `+229${RUN}9${suffix.length}`, role, status: "active", country: "BJ" },
    });
  clientId = (await mk("c", "client")).id;
  providerId = (await mk("pr", "artisan")).id;
});

afterEach(() => {
  delete process.env.QUEUE_MODE;
  sendMail.mockReset();
  deliverMail.mockReset();
});

afterAll(async () => {
  await prisma.emailOutbox.deleteMany({ where: { to: { contains: TAG } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.missionNotification.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.pspEventLog.deleteMany({ where: { pspReference: { contains: TAG } } });
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("e-mails en file", () => {
  const to = (label: string) => `${label}-${TAG}@flexwork.test`;

  it("mode inline : envoi immédiat, rien en file", async () => {
    await queueMail({ to: to("inline"), subject: "S", text: "T" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await prisma.emailOutbox.count({ where: { to: to("inline") } })).toBe(0);
  });

  it("mode worker : la notification écrit l'e-mail en file sans rien envoyer", async () => {
    process.env.QUEUE_MODE = "worker";
    const user = await prisma.user.create({
      data: { email: to("notif"), tel: `+229${RUN}95`, role: "client", status: "active", country: "BJ" },
    });
    try {
      await notifyUser({ userId: user.id, type: "contract_locked", message: "Mission engagée" });
      expect(sendMail).not.toHaveBeenCalled();
      const row = await prisma.emailOutbox.findFirstOrThrow({ where: { to: to("notif") } });
      expect(row).toMatchObject({ status: "a_envoyer", kind: "contract_locked", text: "Mission engagée" });
    } finally {
      await prisma.notification.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("le worker remet chaque e-mail une seule fois, même à deux en parallèle", async () => {
    process.env.QUEUE_MODE = "worker";
    deliverMail.mockImplementation(() => new Promise((r) => setTimeout(r, 20)));
    for (let i = 0; i < 5; i++) await queueMail({ to: to(`lot${i}`), subject: "S", text: "T" });
    await Promise.all([deliverDueEmails(), deliverDueEmails()]);
    const ours = deliverMail.mock.calls.map(([m]) => m.to).filter((t: string) => t.includes(TAG));
    expect(new Set(ours).size).toBe(ours.length);
    expect(await prisma.emailOutbox.count({ where: { to: { contains: TAG }, status: "envoye" } })).toBeGreaterThanOrEqual(5);
  });

  it("SMTP en panne : reprise différée, puis abandon", async () => {
    process.env.QUEUE_MODE = "worker";
    deliverMail.mockRejectedValue(new Error("smtp_down"));
    await queueMail({ to: to("panne"), subject: "S", text: "T" });
    await deliverDueEmails();
    let row = await prisma.emailOutbox.findFirstOrThrow({ where: { to: to("panne") } });
    expect(row).toMatchObject({ status: "a_envoyer", attempts: 1, lastError: "smtp_down" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: { attempts: MAX_EMAIL_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await deliverDueEmails();
    row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.status).toBe("echec");
  });
});

describe("acceptation tacite — sélection des contrats échus", () => {
  it("ne retient que les livrables dont le délai est écoulé", async () => {
    const dueMission = await contract({ missionStatus: "livrable_soumis", submittedDaysAgo: 10 });
    const dueJalon = await contract({ missionStatus: "fonds_sous_sequestre", jalon: { status: "livrable_soumis", submittedDaysAgo: 8 } });
    const recent = await contract({ missionStatus: "livrable_soumis", submittedDaysAgo: 2 });
    const mediation = await contract({ missionStatus: "mediation_ouverte", jalon: { status: "livrable_soumis", submittedDaysAgo: 30 } });
    const disabled = await contract({ missionStatus: "livrable_soumis", submittedDaysAgo: 30, deadlineDays: 0 });
    const jalonNotSubmitted = await contract({ missionStatus: "fonds_sous_sequestre", jalon: { status: "fonds_sous_sequestre", submittedDaysAgo: 30 } });

    const due = await findDueTacitContractIds();
    expect(due).toEqual(expect.arrayContaining([dueMission, dueJalon]));
    for (const id of [recent, mediation, disabled, jalonNotSubmitted]) expect(due).not.toContain(id);
  });

  it("le job par contrat applique la même décision que le balayage", async () => {
    const id = await contract({ missionStatus: "livrable_soumis", submittedDaysAgo: 10 });
    // Sans HOLD confirmé, rien à libérer : la règle s'abstient, exactement comme le balayage.
    const report = await runTacitAcceptanceForContract(id);
    expect(report.examined).toBe(1);
    expect(report.skipped).toEqual([expect.objectContaining({ reason: "funds_not_held" })]);
  });
});

describe("reliquats — sélection et remboursement par contrat", () => {
  it("ne retient que les missions closes qui gardent un solde", async () => {
    const residual = await contract({
      missionStatus: "cloturee",
      ops: [
        { instructionType: "hold", amount: 100_000, status: "confirmed" },
        { instructionType: "release", amount: 60_000, status: "confirmed" },
      ],
    });
    const failedRelease = await contract({
      missionStatus: "cloturee",
      ops: [
        { instructionType: "hold", amount: 100_000, status: "confirmed" },
        { instructionType: "release", amount: 100_000, status: "failed" },
      ],
    });
    const settled = await contract({
      missionStatus: "cloturee",
      ops: [
        { instructionType: "hold", amount: 100_000, status: "confirmed" },
        { instructionType: "release", amount: 100_000, status: "confirmed" },
      ],
    });
    const pendingHold = await contract({ missionStatus: "cloturee", ops: [{ instructionType: "hold", amount: 100_000, status: "pending" }] });
    const ongoing = await contract({ missionStatus: "fonds_sous_sequestre", ops: [{ instructionType: "hold", amount: 100_000, status: "confirmed" }] });

    const ids = await findContractsWithResidual();
    expect(ids).toEqual(expect.arrayContaining([residual, failedRelease]));
    for (const id of [settled, pendingHold, ongoing]) expect(ids).not.toContain(id);

    const first = await refundResidualForContract(residual);
    expect(first).toMatchObject({ refunded: 40_000 });
    // L'instruction de remboursement est en vol : le solde ne la compte plus, rien à rendre.
    expect(await refundResidualForContract(residual)).toMatchObject({ skipped: "nothing_to_refund" });
    expect(await findContractsWithResidual()).not.toContain(residual);
  });

  it("une mission rouverte entre la sélection et le job n'est pas remboursée", async () => {
    const id = await contract({ missionStatus: "mediation_ouverte", ops: [{ instructionType: "hold", amount: 100_000, status: "confirmed" }] });
    expect(await refundResidualForContract(id)).toMatchObject({ skipped: "not_terminal" });
  });
});

describe("registre des tâches", () => {
  it("noms uniques, et chaque tâche répartie vise une file déclarée", () => {
    const names = SCHEDULED_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    const itemQueues = Object.values(ITEM_JOBS).map((j) => j.name);
    for (const job of SCHEDULED_JOBS.filter((j) => j.fanOut)) expect(itemQueues).toContain(job.fanOut!.itemQueue);
    for (const job of SCHEDULED_JOBS) expect(job.cron.split(" ")).toHaveLength(5);
  });
});
