/**
 * Test E2E de l'acceptation tacite (2026-09-14) — la clause 3 du contrat, appliquée.
 *
 * Ce que ce fichier verrouille : `acceptanceDeadlineDays` était stocké, promis au contrat, aux
 * CGU et sur la page publique, et appliqué nulle part. Le prestataire restait suspendu au bon
 * vouloir d'un client silencieux.
 *
 * Un automatisme qui libère de l'argent sans geste humain se juge d'abord sur ce qu'il REFUSE
 * de faire. L'essentiel des cas ci-dessous vérifie donc des NON-déclenchements : délai non
 * écoulé, litige ouvert, fonds absents, livrable déjà tranché. Le cas nominal, lui, doit en plus
 * tenir les mêmes invariants monétaires qu'une validation manuelle — plafond, retenue, cumul.
 *
 * Mode CONSOLE (pas d'autoconfirm), même raison que progressive-release et retention-release :
 * il reproduit la temporalité de la production, où l'instruction reste `pending` jusqu'au
 * webhook signé.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runTacitAcceptanceSweep, applyTacitAcceptance } from "@/lib/tacit-acceptance";
import { heldBalance } from "@/lib/escrow";
import { RETENTION_RATE_J4 } from "@/lib/financing-modes";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-tacite-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-tacite-provider-${RUN}@flexwork.test`;
const PRIX = 300_000;
const DEADLINE_DAYS = 7;

let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
let seq = 0;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Contrat financé dont le livrable est soumis depuis `submittedDaysAgo` jours.
 *
 * `withJalon` choisit la portée : un jalon unique, ou la mission entière (contrat non
 * fractionné). Les deux chemins doivent se comporter identiquement — c'est tout l'objet de
 * DeliverableScope.
 */
async function createSubmitted(opts: {
  submittedDaysAgo: number;
  withJalon?: boolean;
  retentionRate?: number;
  held?: boolean;
  missionStatus?: "livrable_soumis" | "mediation_ouverte";
  alreadyReleased?: number;
}) {
  seq++;
  const withJalon = opts.withJalon ?? true;
  const held = opts.held ?? true;
  const submittedAt = daysAgo(opts.submittedDaysAgo);

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission tacite ${RUN}-${seq}`,
      description: "Mission e2e acceptation tacite",
      domaine: "batiment",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 30,
      status: opts.missionStatus ?? (withJalon ? "livrable_soumis" : "livrable_soumis"),
      submittedAt: withJalon ? null : submittedAt,
    },
  });
  missionIds.push(mission.id);

  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: PRIX, devise: "XOF" },
      currentHash: `hash-tacite-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      acceptanceDeadlineDays: DEADLINE_DAYS,
      retentionRate: opts.retentionRate ?? 0,
      ...(withJalon
        ? {
            jalons: {
              create: {
                ordre: 1,
                titre: `Jalon tacite ${seq}`,
                montant: PRIX,
                status: "livrable_soumis",
                submittedAt,
              },
            },
          }
        : {}),
      ...(held
        ? {
            escrowOperations: {
              create: {
                pspName: "psp-virtuelle",
                pspReference: `hold_tacite_${RUN}_${seq}`,
                amount: PRIX,
                currency: "XOF",
                instructionType: "hold",
                status: "confirmed",
                pspConfirmedAt: new Date(),
              },
            },
          }
        : {}),
    },
    include: { jalons: true },
  });
  contractIds.push(contract.id);

  if (opts.alreadyReleased) {
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        jalonId: contract.jalons[0]?.id ?? null,
        pspName: "psp-virtuelle",
        pspReference: `release_tacite_${RUN}_${seq}`,
        amount: opts.alreadyReleased,
        currency: "XOF",
        instructionType: "release",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
  }

  return { mission, contract, jalon: contract.jalons[0] ?? null };
}

async function releasesFor(contractId: string) {
  return prisma.pspEscrowOperation.findMany({
    where: { contractId, instructionType: "release" },
    select: { amount: true },
  });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}8`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}9`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.jalon.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.notification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("acceptation tacite — ce qu'elle REFUSE de faire", () => {
  it("délai NON écoulé : rien n'est libéré", async () => {
    const { contract, jalon } = await createSubmitted({ submittedDaysAgo: 2 });

    const report = await runTacitAcceptanceSweep();
    expect(report.skipped).toContainEqual({
      missionId: contract.missionId,
      jalonId: jalon!.id,
      reason: "within_deadline",
    });
    expect(await releasesFor(contract.id)).toHaveLength(0);
    expect(await heldBalance(contract.id)).toBe(PRIX);
  });

  it("médiation ouverte : le litige gèle le délai — jamais de paiement automatique de ce qui est contesté", async () => {
    const { contract, jalon } = await createSubmitted({
      submittedDaysAgo: 30,
      missionStatus: "mediation_ouverte",
    });

    const report = await runTacitAcceptanceSweep();
    // Exclu à la SOURCE : la portée n'est même pas candidate.
    const touched = report.skipped.some((s) => s.jalonId === jalon!.id);
    expect(touched).toBe(false);
    expect(await releasesFor(contract.id)).toHaveLength(0);
  });

  it("fonds non séquestrés : rien à libérer, aucune instruction", async () => {
    const { contract, jalon } = await createSubmitted({ submittedDaysAgo: 30, held: false });

    const report = await runTacitAcceptanceSweep();
    expect(report.skipped).toContainEqual({
      missionId: contract.missionId,
      jalonId: jalon!.id,
      reason: "funds_not_held",
    });
    expect(await releasesFor(contract.id)).toHaveLength(0);
  });

  it("sans date de soumission (livrable antérieur au champ), le client garde la main", async () => {
    const { contract, jalon } = await createSubmitted({ submittedDaysAgo: 30 });
    await prisma.jalon.update({ where: { id: jalon!.id }, data: { submittedAt: null } });

    const report = await runTacitAcceptanceSweep();
    expect(report.skipped).toContainEqual({
      missionId: contract.missionId,
      jalonId: jalon!.id,
      reason: "within_deadline",
    });
    expect(await releasesFor(contract.id)).toHaveLength(0);
  });

  it("livrable déjà tranché (rejeté) : hors périmètre", async () => {
    const { contract, jalon } = await createSubmitted({ submittedDaysAgo: 30 });
    await prisma.jalon.update({ where: { id: jalon!.id }, data: { status: "rejete" } });

    await runTacitAcceptanceSweep();
    expect(await releasesFor(contract.id)).toHaveLength(0);
  });
});

describe("acceptation tacite — le cas nominal", () => {
  it("délai écoulé : le solde est libéré, le jalon validé, la progression portée à 100 %", async () => {
    const { contract, jalon } = await createSubmitted({ submittedDaysAgo: 8 });

    const outcome = await applyTacitAcceptance({
      kind: "jalon",
      missionId: contract.missionId,
      jalonId: jalon!.id,
      contractId: contract.id,
      clientId,
      providerId,
      currency: "XOF",
      missionTitre: "Mission tacite",
      financingMode: "lump_sum",
      retentionRate: 0,
      status: "livrable_soumis",
      observedProgress: 0,
      montant: PRIX,
      jalonTitre: jalon!.titre,
    });

    expect(outcome).toMatchObject({ applied: true, amount: PRIX });

    const after = await prisma.jalon.findUnique({ where: { id: jalon!.id } });
    expect(after?.status).toBe("valide");
    // Invariant documenté dans src/lib/jalons.ts : un jalon payé vaut 100 % d'avancement
    // constaté, sinon la progression pondérée de la mission est fausse.
    expect(after?.observedProgress).toBe(100);
    expect(await heldBalance(contract.id)).toBe(0);
  });

  it("le balayage traite le cas nominal de bout en bout", async () => {
    const { contract, jalon } = await createSubmitted({ submittedDaysAgo: 10 });

    const report = await runTacitAcceptanceSweep();
    expect(report.applied).toBeGreaterThanOrEqual(1);

    const releases = await releasesFor(contract.id);
    expect(releases).toHaveLength(1);
    expect(releases[0].amount).toBe(PRIX);
    expect((await prisma.jalon.findUnique({ where: { id: jalon!.id } }))?.status).toBe("valide");
  });

  it("un contrat SANS jalon suit exactement le même chemin", async () => {
    const { contract, mission } = await createSubmitted({ submittedDaysAgo: 9, withJalon: false });

    await runTacitAcceptanceSweep();

    const releases = await releasesFor(contract.id);
    expect(releases).toHaveLength(1);
    expect(releases[0].amount).toBe(PRIX);
    expect((await prisma.mission.findUnique({ where: { id: mission.id } }))?.observedProgress).toBe(100);
  });

  it("retenue de garantie (J4) : seul le plafond libérable part, la retenue reste séquestrée", async () => {
    const { contract } = await createSubmitted({
      submittedDaysAgo: 8,
      retentionRate: RETENTION_RATE_J4,
    });

    await runTacitAcceptanceSweep();

    const attendu = PRIX - Math.round(PRIX * RETENTION_RATE_J4);
    const releases = await releasesFor(contract.id);
    expect(releases).toHaveLength(1);
    expect(releases[0].amount).toBe(attendu);
    // La retenue n'est PAS libérée par l'acceptation tacite : elle part en une instruction
    // finale, quand tous les jalons sont libérés.
    expect(await heldBalance(contract.id)).toBe(PRIX - attendu);
  });

  it("financement progressif : seul le SOLDE non encore libéré est transmis", async () => {
    const { contract } = await createSubmitted({ submittedDaysAgo: 8, alreadyReleased: 120_000 });

    await runTacitAcceptanceSweep();

    const releases = await releasesFor(contract.id);
    // Deux lignes : les 120 000 déjà partis, puis le solde — jamais le montant plein une
    // seconde fois.
    expect(releases).toHaveLength(2);
    expect(releases.reduce((s, r) => s + r.amount, 0)).toBe(PRIX);
    expect(await heldBalance(contract.id)).toBe(0);
  });

  it("un second balayage ne libère RIEN de plus — idempotent", async () => {
    const { contract } = await createSubmitted({ submittedDaysAgo: 8 });

    await runTacitAcceptanceSweep();
    const apres1 = await releasesFor(contract.id);
    await runTacitAcceptanceSweep();
    const apres2 = await releasesFor(contract.id);

    expect(apres2).toHaveLength(apres1.length);
    expect(apres2.reduce((s, r) => s + r.amount, 0)).toBe(PRIX);
  });
});
