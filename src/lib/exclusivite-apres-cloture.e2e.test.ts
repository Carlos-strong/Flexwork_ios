/**
 * Exclusivité de candidature — sa LEVÉE à la fin de la mission (2026-09-12).
 *
 * Un prestataire ne peut mener qu'une négociation de devis à la fois : une proposition
 * `en_negociation`, `devis_valide` ou `acceptee` ailleurs bloque toute nouvelle soumission
 * (ACTIVE_NEGOCIATION_STATUSES, src/lib/devis.ts). La règle est voulue.
 *
 * Ce qui ne l'était pas : rien ne la levait jamais. Aucune route ne fait sortir
 * `MissionProposal.status` de `acceptee`/`devis_valide` — la clôture (src/lib/psp-webhook.ts)
 * ne touche pas la proposition, et c'est très bien ainsi : « cette candidature a été retenue »
 * reste vrai pour toujours. Mais l'exclusivité s'appuyait sur ce seul statut. Conséquence :
 * un prestataire ayant mené UNE mission à son terme était définitivement interdit de
 * candidature sur la plateforme — le défaut ne se manifestant qu'à la deuxième mission, donc
 * jamais dans un test de cycle de vie qui n'en joue qu'une.
 *
 * Le correctif interroge l'état de la MISSION, pas celui de la proposition.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-exclu-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-exclu-provider-${RUN}@flexwork.test`;

const LINE_ITEMS = [{ description: "Prestation", quantity: 1, unit: "forfait", unitPrice: 100000 }];

let clientId: string;
let providerId: string;
let missionTermineeId: string;
let missionEnCoursId: string;
let missionCibleId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

function devisReq(): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineItems: LINE_ITEMS, delay: "10 jours", tvaRate: 0, laborCost: 0 }),
  });
}

async function creerMission(titre: string, status: "publiee" | "cloturee" | "fonds_sous_sequestre") {
  const m = await prisma.mission.create({
    data: {
      clientId,
      titre: `${titre} ${RUN}`,
      description: "Mission de test de l'exclusivité de candidature.",
      domaine: "developpement",
      mode: "distance",
      budget: 100000,
      currency: "XOF",
      delaiJours: 15,
      budgetType: "QUOTE",
      status,
    },
  });
  return m.id;
}

async function cleanup() {
  const ids = [missionTermineeId, missionEnCoursId, missionCibleId].filter(Boolean);
  await prisma.missionProposal.deleteMany({ where: { missionId: { in: ids } } });
  await prisma.mission.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
}

beforeAll(async () => {
  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL,
      tel: `+229${RUN}2`,
      role: "client",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "ClientExclu",
      kycStatus: "verifie",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL,
      tel: `+229${RUN}3`,
      role: "expert_digital",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "PrestataireExclu",
      kycStatus: "verifie",
      dateNaissance: new Date("1990-01-01"),
    },
  });
  clientId = client.id;
  providerId = provider.id;

  missionTermineeId = await creerMission("Mission terminée", "cloturee");
  missionEnCoursId = await creerMission("Mission en cours", "fonds_sous_sequestre");
  missionCibleId = await creerMission("Mission cible", "publiee");
});

afterAll(cleanup);

describe("Exclusivité de candidature — levée à la fin de la mission", () => {
  it("E1 — une candidature retenue sur une mission CLÔTURÉE ne bloque plus", async () => {
    // Exactement l'état laissé par une mission menée à terme : la proposition garde `acceptee`,
    // parce que c'est vrai, et la mission porte `cloturee`.
    await prisma.missionProposal.create({
      data: { missionId: missionTermineeId, providerId, montant: 100000, status: "acceptee" },
    });

    authAs(providerId);
    const res = await devisPost(devisReq(), { params: Promise.resolve({ id: missionCibleId }) });
    expect(res.status, "une mission clôturée ne consomme plus l'exclusivité").toBe(200);

    // Nettoyage pour le cas suivant : la candidature qu'on vient de créer bloquerait à son tour.
    await prisma.missionProposal.deleteMany({ where: { missionId: missionCibleId } });
  });

  it("E2 — une candidature retenue sur une mission EN COURS bloque toujours", async () => {
    await prisma.missionProposal.create({
      data: { missionId: missionEnCoursId, providerId, montant: 100000, status: "acceptee" },
    });

    authAs(providerId);
    const res = await devisPost(devisReq(), { params: Promise.resolve({ id: missionCibleId }) });
    expect(res.status, "l'exclusivité reste entière tant que la mission tourne").toBe(409);
    expect((await res.json()).error).toBe("active_negotiation_exists");
  });

  it("E3 — la clôture de cette mission débloque le prestataire", async () => {
    await prisma.mission.update({ where: { id: missionEnCoursId }, data: { status: "cloturee" } });

    authAs(providerId);
    const res = await devisPost(devisReq(), { params: Promise.resolve({ id: missionCibleId }) });
    expect(res.status).toBe(200);

    // Le statut de la proposition d'origine n'a PAS été réécrit : l'historique reste intact,
    // c'est bien l'état de la mission qui porte la décision.
    const proposal = await prisma.missionProposal.findFirstOrThrow({
      where: { missionId: missionEnCoursId, providerId },
    });
    expect(proposal.status).toBe("acceptee");
  });
});
