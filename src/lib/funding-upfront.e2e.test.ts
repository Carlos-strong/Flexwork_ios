/**
 * Financement UNIQUE consommé par les sous-tâches (§7 et §8 du cahier des charges, mode S1 —
 * 2026-09-14).
 *
 * Le §8 isole un point précis : « les sous-tâches ne doivent pas créer un second séquestre ».
 * Or c'est exactement ce que faisait la plateforme — un contrat à jalons refusait tout
 * financement global (`use_jalon_hold`) et exigeait un séquestre PAR jalon.
 *
 * Ce fichier vérifie la séquence du §7 au franc près :
 *
 *      150 000  →  130 000  →  70 000  →  20 000  →  0
 *
 * et surtout ce qui la rend possible : un seul HOLD, et des jalons rendus livrables par CE
 * financement-là, sans jamais en réclamer un second.
 *
 * Mode CONSOLE (pas d'autoconfirm) : il faut pouvoir observer l'effet de la CONFIRMATION du
 * financement unique sur l'état des jalons.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { escrowBalance, emitScopedRelease, requestContractHold } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { canSubmitJalonDeliverable } from "@/lib/jalons";
import { FINANCING_MODES, resolveFinancing } from "@/lib/financing-modes";
import { computeDevisData } from "@/lib/devis";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-upfront-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-upfront-provider-${RUN}@flexwork.test`;

// Le devis du §7, à l'identique.
const DEVIS = computeDevisData(
  [
    { description: "Diagnostic", quantity: 1, unit: "forfait", unitPrice: 20_000 },
    { description: "Câblage", quantity: 1, unit: "forfait", unitPrice: 60_000 },
    { description: "Installation", quantity: 1, unit: "forfait", unitPrice: 50_000 },
    { description: "Essai", quantity: 1, unit: "forfait", unitPrice: 20_000 },
  ],
  "5 jours",
  "",
  0
);
const PRIX = DEVIS.totalTTC; // 150 000

let clientId = "";
let providerId = "";
let missionId = "";
let contractId = "";
let jalonIds: string[] = [];

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}70`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}71`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Installation tableau électrique ${RUN}`,
      description: "Prestation ponctuelle découpée en quatre étapes.",
      domaine: "batiment",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 5,
      riskLevel: "low",
      status: "contrat_signe",
      financingModeKey: "S1",
    },
  });
  missionId = mission.id;

  // Les jalons sont DÉRIVÉS du devis par le mode, exactement comme le ferait la génération de
  // contrat — aucun montant retapé à la main.
  const resolved = resolveFinancing(FINANCING_MODES.S1, DEVIS, PRIX);
  if (!resolved.ok) throw new Error("dérivation S1 attendue");

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: PRIX, devise: "XOF" },
      currentHash: `hash-upfront-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      fundingGranularity: resolved.resolved.fundingGranularity,
      jalons: {
        create: resolved.resolved.jalons!.map((j, i) => ({
          ordre: i + 1,
          titre: j.titre,
          montant: j.montant,
          status: "en_attente",
        })),
      },
    },
    include: { jalons: { orderBy: { ordre: "asc" } } },
  });
  contractId = contract.id;
  jalonIds = contract.jalons.map((j) => j.id);
});

afterAll(async () => {
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
  await prisma.jalon.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("§7/§8 — un seul séquestre, consommé par les sous-tâches", () => {
  it("le contrat porte la granularité `upfront` et les quatre lots du devis", async () => {
    const c = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { jalons: { orderBy: { ordre: "asc" } } },
    });
    expect(c.fundingGranularity).toBe("upfront");
    expect(c.jalons.map((j) => j.montant)).toEqual([20_000, 60_000, 50_000, 20_000]);
    expect(c.jalons.reduce((s, j) => s + j.montant, 0)).toBe(PRIX);
  });

  it("le financement GLOBAL est accepté — il l'était refusé sur un contrat à jalons", async () => {
    const res = await requestContractHold(contractId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.operation.amount).toBe(PRIX);
    expect(res.operation.jalonId).toBeNull();

    // Un seul HOLD pour tout le contrat : c'est le point du §8.
    expect(
      await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold" } })
    ).toBe(1);
  });

  it("sa confirmation rend TOUS les jalons livrables, sans second financement", async () => {
    // Avant confirmation, les jalons restent en attente : jamais de séquestre optimiste.
    let jalons = await prisma.jalon.findMany({ where: { contractId } });
    expect(jalons.every((j) => j.status === "en_attente")).toBe(true);

    const hold = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { contractId, instructionType: "hold" },
    });
    expect((await operateVirtualPsp("authorize", hold.pspReference!)).ok).toBe(true);

    jalons = await prisma.jalon.findMany({ where: { contractId } });
    expect(jalons.every((j) => j.status === "fonds_sous_sequestre")).toBe(true);
    // Et c'est bien ce statut qui ouvre la soumission d'un livrable — l'obstacle réel.
    expect(jalons.every((j) => canSubmitJalonDeliverable(j.status))).toBe(true);

    expect((await escrowBalance(contractId)).available).toBe(PRIX);
  });

  it("chaque lot validé CONSOMME le séquestre — la séquence du §7, au franc près", async () => {
    const attendus = [20_000, 60_000, 50_000, 20_000];
    const soldesAttendus = [130_000, 70_000, 20_000, 0];

    for (let i = 0; i < jalonIds.length; i++) {
      const res = await emitScopedRelease({
        contractId,
        jalonId: jalonIds[i],
        currency: "XOF",
        plafond: attendus[i],
        targetCumulative: attendus[i],
      });
      expect(res.ok, `lot ${i + 1}`).toBe(true);
      if (!res.ok) return;
      expect(res.operation.amount).toBe(attendus[i]);

      const b = await escrowBalance(contractId);
      expect(b.held, `solde après le lot ${i + 1}`).toBe(soldesAttendus[i]);
    }

    // Un seul financement du début à la fin.
    expect(
      await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold" } })
    ).toBe(1);
    // Et quatre créances, une par lot.
    expect(await prisma.payable.count({ where: { contractId } })).toBe(4);
  });

  it("le séquestre épuisé, plus rien ne peut sortir", async () => {
    const b = await escrowBalance(contractId);
    expect(b.held).toBe(0);
    expect(b.available).toBe(0);

    const res = await emitScopedRelease({
      contractId,
      jalonId: jalonIds[0],
      currency: "XOF",
      plafond: 20_000,
      targetCumulative: 20_000,
    });
    expect(res).toEqual({ ok: false, reason: "nothing_to_release" });
  });

  it("un second financement global est refusé — pas de double débit", async () => {
    expect(await requestContractHold(contractId)).toMatchObject({
      ok: false,
      error: "hold_already_requested",
    });
  });
});
