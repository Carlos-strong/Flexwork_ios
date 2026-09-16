/**
 * Journal des échanges plateforme ⇄ PSP (2026-09-15).
 *
 * Ce que ce fichier verrouille :
 *   1. AUCUN message reçu n'échappe au journal — accepté, rejoué, rejeté, sans signature, illisible,
 *      sans objet — et chacun porte son issue exacte, son canal et la validité de sa signature ;
 *   2. le journal entrelace instructions sortantes et messages entrants dans un ordre stable, et sa
 *      pagination ne perd ni ne duplique aucune ligne ;
 *   3. la conversation d'une référence se relit en entier ; seule l'administration y accède.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as webhookPost } from "@/app/api/webhooks/psp/route";
import { GET as journalGet } from "@/app/api/admin/finance/psp-journal/route";
import { GET as exchangeGet } from "@/app/api/admin/finance/psp-journal/exchange/route";
import { prisma } from "@/lib/db";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { signWebhookPayload } from "@/lib/webhook-signing";
import { percentile, type JournalItem } from "@/lib/psp-journal";

const RUN = Date.now();
const TAG = `journal_${RUN}`;
const HOLD_REF = `hold_${TAG}`;
const RELEASE_REF = `release_${TAG}`;
const UNKNOWN_REF = `unknown_${TAG}`;

let clientId = "";
let providerId = "";
let supervisorId = "";
let plainUserId = "";
let missionId = "";
let contractId = "";
let holdId = "";

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

function webhook(payload: object, signature: string | null) {
  return webhookPost(
    new Request("http://localhost/api/webhooks/psp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature ? { "x-webhook-signature": signature } : {}) },
      body: JSON.stringify(payload),
    })
  );
}

const signed = (payload: { pspReference: string; event: string }) => signWebhookPayload(payload);

const logsFor = (reference: string) =>
  prisma.pspEventLog.findMany({ where: { pspReference: reference }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const mk = (suffix: string, extra: object = {}) =>
    prisma.user.create({
      data: { email: `e2e-journal-${suffix}-${RUN}@flexwork.test`, tel: `+229${RUN}7${suffix.length}`, role: "client", status: "active", country: "BJ", ...extra },
    });
  clientId = (await mk("c")).id;
  providerId = (await mk("pr", { role: "artisan" })).id;
  supervisorId = (await mk("sup", { isAdmin: true, adminRole: "superviseur" })).id;
  plainUserId = (await mk("plain")).id;

  const mission = await prisma.mission.create({
    data: { clientId, titre: `Journal PSP ${RUN}`, description: "Mission e2e du journal PSP", domaine: "batiment", budget: 100_000, currency: "XOF", delaiJours: 30, status: "contrat_signe" },
  });
  missionId = mission.id;
  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: 100_000, devise: "XOF" },
      currentHash: `hash-journal-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
    },
  });
  contractId = contract.id;
  const hold = await prisma.pspEscrowOperation.create({
    data: { contractId, pspName: "psp-virtuelle", pspReference: HOLD_REF, amount: 100_000, currency: "XOF", instructionType: "hold" },
  });
  holdId = hold.id;
});

afterAll(async () => {
  await prisma.pspEventLog.deleteMany({ where: { pspReference: { contains: TAG } } });
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, supervisorId, plainUserId] } } });
});

describe("chaque message reçu du PSP est consigné avec son issue", () => {
  it("webhook signé et valide → appliqué, rattaché à son instruction", async () => {
    const payload = { pspReference: HOLD_REF, event: "hold_confirmed" };
    expect((await webhook(payload, signed(payload))).status).toBe(200);

    const [log] = await logsFor(HOLD_REF);
    expect(log).toMatchObject({
      channel: "webhook",
      event: "hold_confirmed",
      outcome: "applied",
      error: null,
      signatureValid: true,
      operationId: holdId,
      contractId,
      instructionType: "hold",
      amount: 100_000,
    });
    expect(log.payload).toEqual(payload);
  });

  it("le même webhook rappelé → rejeu ignoré, sans nouvel effet", async () => {
    const payload = { pspReference: HOLD_REF, event: "hold_confirmed" };
    expect((await webhook(payload, signed(payload))).status).toBe(200);
    expect((await logsFor(HOLD_REF)).at(-1)?.outcome).toBe("replayed");
  });

  it("signature falsifiée → rejeté, signature invalide consignée", async () => {
    const res = await webhook({ pspReference: HOLD_REF, event: "hold_confirmed" }, "deadbeef");
    expect(res.status).toBe(409);
    expect((await logsFor(HOLD_REF)).at(-1)).toMatchObject({ outcome: "rejected", error: "invalid_signature", signatureValid: false });
  });

  it("sans signature → rejeté avant tout traitement, et quand même consigné", async () => {
    expect((await webhook({ pspReference: HOLD_REF, event: "hold_confirmed" }, null)).status).toBe(401);
    expect((await logsFor(HOLD_REF)).at(-1)).toMatchObject({ outcome: "rejected", error: "missing_signature" });
  });

  it("dénouement contradictoire (échec après confirmation) → rejeté", async () => {
    const payload = { pspReference: HOLD_REF, event: "failed" };
    expect((await webhook(payload, signed(payload))).status).toBe(409);
    expect((await logsFor(HOLD_REF)).at(-1)).toMatchObject({ outcome: "rejected", error: "operation_already_settled", signatureValid: true });
  });

  it("référence qu'aucune instruction ne porte → rejeté, consigné sans rattachement", async () => {
    const payload = { pspReference: UNKNOWN_REF, event: "release_confirmed" };
    expect((await webhook(payload, signed(payload))).status).toBe(409);
    const [log] = await logsFor(UNKNOWN_REF);
    expect(log).toMatchObject({ outcome: "rejected", error: "operation_not_found", operationId: null, contractId: null });
  });

  it("la console de la PSP virtuelle est consignée sous son propre canal", async () => {
    await prisma.pspEscrowOperation.create({
      data: { contractId, pspName: "psp-virtuelle", pspReference: RELEASE_REF, amount: 1_000, currency: "XOF", instructionType: "release" },
    });
    expect((await operateVirtualPsp("release", RELEASE_REF)).ok).toBe(true);
    const [log] = await logsFor(RELEASE_REF);
    expect(log).toMatchObject({ channel: "virtual_console", outcome: "applied", instructionType: "release" });
  });
});

describe("console admin — le journal entrelacé", () => {
  const journal = async (query: string) => {
    authAs(supervisorId);
    const res = await journalGet(new Request(`http://localhost/api/admin/finance/psp-journal?${query}`));
    expect(res.status).toBe(200);
    return res.json() as Promise<{ items: JournalItem[]; nextCursor: string | null; stats: unknown }>;
  };

  it("réservé à l'administration", async () => {
    authAs(plainUserId);
    expect((await journalGet(new Request("http://localhost/api"))).status).toBe(403);
  });

  it("instructions sortantes et messages entrants, du plus récent au plus ancien", async () => {
    const { items, stats } = await journal(`period=all&q=${TAG}&limit=200`);
    // 2 instructions + 7 messages reçus (5 sur le financement, 1 inconnu, 1 console).
    expect(items.filter((i) => i.kind === "outbound")).toHaveLength(2);
    expect(items.filter((i) => i.kind === "inbound")).toHaveLength(7);
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort().reverse());
    expect(stats).not.toBeNull();

    const applied = items.find((i) => i.kind === "inbound" && i.pspReference === HOLD_REF && i.outcome === "applied");
    expect(applied?.kind === "inbound" && applied.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("la pagination ne perd ni ne duplique aucune ligne", async () => {
    const vus: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: JournalItem[]; nextCursor: string | null } = await journal(
        `period=all&q=${TAG}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      );
      vus.push(...page.items.map((i) => i.key));
      cursor = page.nextCursor;
    } while (cursor);
    expect(vus).toHaveLength(9);
    expect(new Set(vus).size).toBe(9);
  });

  it("filtrer sur une issue ne montre que des messages reçus", async () => {
    const { items } = await journal(`period=all&q=${TAG}&outcome=rejected`);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.kind === "inbound" && i.outcome === "rejected")).toBe(true);

    const sortants = await journal(`period=all&q=${TAG}&direction=outbound`);
    expect(sortants.items.map((i) => i.pspReference).sort()).toEqual([HOLD_REF, RELEASE_REF].sort());
  });

  it("la conversation d'une référence se relit en entier, dans l'ordre", async () => {
    authAs(supervisorId);
    const res = await exchangeGet(new Request(`http://localhost/api?reference=${encodeURIComponent(HOLD_REF)}`));
    const data = await res.json();
    expect(data.operation).toMatchObject({ id: holdId, status: "confirmed", instructionType: "hold" });
    expect(data.events.map((e: { outcome: string; error: string | null }) => e.error ?? e.outcome)).toEqual([
      "applied",
      "replayed",
      "invalid_signature",
      "missing_signature",
      "operation_already_settled",
    ]);

    const inconnu = await (await exchangeGet(new Request(`http://localhost/api?reference=${UNKNOWN_REF}`))).json();
    expect(inconnu.operation).toBeNull();
    expect(inconnu.events).toHaveLength(1);

    expect((await exchangeGet(new Request(`http://localhost/api?reference=absente_${TAG}_x`))).status).toBe(404);
  });
});

describe("percentile", () => {
  it("rang le plus proche, série vide nulle", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([30, 10, 20], 0.5)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
});
