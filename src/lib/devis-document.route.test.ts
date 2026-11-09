/**
 * Export documentaire du devis — GARDE D'ACCÈS (2026-09-13).
 *
 * Le document porte le chiffrage complet d'un prestataire : postes, quantités, prix unitaires.
 * C'est exactement ce qu'une place de marché ne doit jamais laisser lire à un concurrent — un
 * candidat qui verrait le devis d'un autre pourrait se placer juste en dessous.
 *
 * Le garde générique `requireMissionParty` ne convient pas ici : sa branche prestataire admet
 * TOUT candidat de la mission. D'où `requireProposalParty`, et d'où ce test — la distinction
 * est invisible à la lecture et se perdrait au premier refactor.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as documentGet } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/document/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
let clientId: string;
let providerId: string;
let rivalId: string;
let tiersId: string;
let missionId: string;
let proposalId: string;
let rivalProposalId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

function params() {
  return { params: Promise.resolve({ id: missionId, proposalId }) };
}

function req(format?: string): Request {
  const url = format
    ? `http://localhost/api/missions/${missionId}/proposals/${proposalId}/devis/document?format=${format}`
    : `http://localhost/api/missions/${missionId}/proposals/${proposalId}/devis/document`;
  return new Request(url);
}

const DEVIS = {
  lineItems: [{ description: "Poste unique", quantity: 1, unit: "forfait", unitPrice: 100000, total: 100000 }],
  laborCost: 0,
  totalHT: 100000,
  tva: 0,
  totalTTC: 100000,
  tvaRate: 0,
  delay: "10 jours",
  notes: "",
};

async function cleanup() {
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, rivalId, tiersId] } } });
}

beforeAll(async () => {
  const mk = async (suffix: string, role: "client" | "expert_digital") =>
    prisma.user.create({
      data: {
        email: `doc-devis-${suffix}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${suffix}`,
        role,
        status: "active",
        country: "BJ",
        firstname: "E2E",
        lastname: suffix,
        kycStatus: "verifie",
      },
    });

  clientId = (await mk("cli", "client")).id;
  providerId = (await mk("pro", "expert_digital")).id;
  rivalId = (await mk("riv", "expert_digital")).id;
  tiersId = (await mk("tie", "expert_digital")).id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `E2E doc devis ${RUN}`,
      description: "Mission de test de l'export documentaire du devis.",
      domaine: "developpement",
      mode: "distance",
      budget: 100000,
      currency: "XOF",
      delaiJours: 15,
      budgetType: "QUOTE",
      status: "proposition_acceptee",
      maxRevisionRounds: 3,
    },
  });
  missionId = mission.id;

  proposalId = (
    await prisma.missionProposal.create({
      data: { missionId, providerId, montant: 100000, status: "devis_valide", roundActuel: 1, devisValideAt: new Date(), devisData: DEVIS },
    })
  ).id;
  // Un concurrent sur la MÊME mission — c'est lui que le garde doit écarter.
  rivalProposalId = (
    await prisma.missionProposal.create({
      data: { missionId, providerId: rivalId, montant: 90000, status: "en_negociation", roundActuel: 1, devisData: DEVIS },
    })
  ).id;
});

afterAll(cleanup);

describe("Export du devis — qui peut le lire", () => {
  it("D1 — le client de la mission l'obtient en PDF", async () => {
    authAs(clientId);
    const res = await documentGet(req("pdf"), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("devis-definitif-");
  });

  it("D2 — le prestataire auteur du devis l'obtient aussi", async () => {
    authAs(providerId);
    expect((await documentGet(req("pdf"), params())).status).toBe(200);
  });

  it("D3 — un CONCURRENT sur la même mission est refusé en 404", async () => {
    // 404 et non 403 : une ressource qu'on n'a pas le droit de lire est indistinguable d'une
    // ressource inexistante, sinon la réponse devient un oracle d'existence (règle R02).
    authAs(rivalId);
    const res = await documentGet(req("pdf"), params());
    expect(res.status).toBe(404);
  });

  it("D4 — un tiers étranger à la mission est refusé", async () => {
    authAs(tiersId);
    expect((await documentGet(req("pdf"), params())).status).toBe(404);
  });

  it("D5 — sans session, 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await documentGet(req("pdf"), params())).status).toBe(401);
  });
});

describe("Export du devis — contenu", () => {
  it("D6 — le JSON sert le même document que le PDF et signale l'état définitif", async () => {
    authAs(clientId);
    const res = await documentGet(req("json"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definitif).toBe(true);
    expect(body.document.titre).toBe("Devis définitif");
    expect(body.document.lines).toHaveLength(1);
    expect(body.pdfUrl).toContain("format=pdf");
  });

  it("D7 — le HTML autonome est servi par défaut", async () => {
    authAs(clientId);
    const res = await documentGet(req(), params());
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Devis définitif");
  });

  it("D8 — un devis encore en négociation ne se présente jamais comme définitif", async () => {
    authAs(rivalId);
    const res = await documentGet(
      new Request(`http://localhost/api?format=json`),
      { params: Promise.resolve({ id: missionId, proposalId: rivalProposalId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definitif).toBe(false);
    expect(body.document.titre).toBe("Devis en négociation");
    expect(body.document.mention).toContain("n'engage aucune des parties");
  });

  it("D9 — une candidature sans chiffrage n'a aucun document à produire", async () => {
    const sansDevis = await prisma.missionProposal.create({
      data: { missionId, providerId: tiersId, montant: 0, status: "envoyee", roundActuel: 0 },
    });
    authAs(tiersId);
    const res = await documentGet(
      new Request("http://localhost/api?format=pdf"),
      { params: Promise.resolve({ id: missionId, proposalId: sansDevis.id }) }
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("devis_not_found");
  });
});
