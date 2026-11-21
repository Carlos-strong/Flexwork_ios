/**
 * Avis de fin de mission — la CIBLE de la notation (2026-09-12).
 *
 * `POST .../reviews` n'accepte que l'autre partie du contrat comme `targetId`
 * (legitimateReviewTarget, src/lib/review-rules.ts). La page d'avis, elle, n'avait aucun moyen
 * de connaître cette contrepartie : elle envoyait faute de mieux l'id de la MISSION, que l'API
 * rejetait invariablement en 403 `invalid_target`. Aucun avis n'était donc publiable — ni par le
 * client, ni par le prestataire, sur aucune mission — alors que toute la chaîne serveur
 * fonctionnait.
 *
 * Le correctif expose la cible sur `GET .../reviews`, calculée par la même fonction que celle
 * qui arbitre le POST. Ce test vérifie les deux bouts : la cible servie est la bonne, et un POST
 * qui l'emploie aboutit.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as reviewsGet, POST as reviewsPost } from "@/app/api/missions/[id]/reviews/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-avis-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-avis-provider-${RUN}@flexwork.test`;
const TIERS_EMAIL = `e2e-avis-tiers-${RUN}@flexwork.test`;

let clientId: string;
let providerId: string;
let tiersId: string;
let missionId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

function params() {
  return { params: Promise.resolve({ id: missionId }) };
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getTarget(): Promise<{ id: string; nom: string } | null> {
  const res = await reviewsGet(new Request("http://localhost/api"), params());
  expect(res.status).toBe(200);
  return (await res.json()).target;
}

async function cleanup() {
  await prisma.review.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, tiersId] } } });
}

beforeAll(async () => {
  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL, tel: `+229${RUN}A`, role: "client", status: "active", country: "BJ",
      firstname: "Rivoli", lastname: "Hazael", kycStatus: "verifie",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL, tel: `+229${RUN}B`, role: "expert_digital", status: "active", country: "BJ",
      firstname: "Canon", lastname: "Roger", kycStatus: "verifie",
    },
  });
  const tiers = await prisma.user.create({
    data: {
      email: TIERS_EMAIL, tel: `+229${RUN}C`, role: "expert_digital", status: "active", country: "BJ",
      firstname: "Candidat", lastname: "Refuse", kycStatus: "verifie",
    },
  });
  clientId = client.id;
  providerId = provider.id;
  tiersId = tiers.id;

  const mission = await prisma.mission.create({
    data: {
      clientId, titre: `E2E avis ${RUN}`, description: "Mission de test des avis.",
      domaine: "developpement", budget: 100000, currency: "XOF", delaiJours: 15,
      budgetType: "QUOTE", status: "cloturee",
    },
  });
  missionId = mission.id;

  // Mode devis : la proposition retenue porte `devis_valide`, pas `acceptee` — les deux doivent
  // être reconnues (retainedProviderIds).
  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: 100000, status: "devis_valide" },
  });
  // Un candidat écarté : participant à la mission, mais sans droit de noter.
  await prisma.missionProposal.create({
    data: { missionId, providerId: tiersId, montant: 90000, status: "refusee" },
  });
});

afterAll(cleanup);

describe("Avis de fin de mission — la cible servie est la contrepartie du contrat", () => {
  it("V1 — le client se voit proposer le PRESTATAIRE retenu, nommé", async () => {
    authAs(clientId);
    const target = await getTarget();
    expect(target?.id).toBe(providerId);
    expect(target?.nom).toBe("Canon Roger");
  });

  it("V2 — le prestataire retenu se voit proposer le CLIENT", async () => {
    authAs(providerId);
    const target = await getTarget();
    expect(target?.id).toBe(clientId);
    expect(target?.nom).toBe("Rivoli Hazael");
  });

  it("V3 — un candidat écarté n'a personne à noter", async () => {
    authAs(tiersId);
    expect(await getTarget()).toBeNull();
  });

  it("V4 — la cible servie est acceptée par le POST", async () => {
    authAs(clientId);
    const target = await getTarget();
    const res = await reviewsPost(
      postReq({ targetId: target!.id, note: 5, commentaire: "Travail conforme au devis." }),
      params()
    );
    expect(res.status, "la cible servie par le GET doit satisfaire le garde du POST").toBe(200);

    const review = await prisma.review.findFirstOrThrow({ where: { missionId, authorId: clientId } });
    expect(review.targetId).toBe(providerId);
    expect(review.note).toBe(5);
  });

  it("V5 — un second avis du même auteur est refusé proprement, pas en 500", async () => {
    // @@unique([missionId, authorId]) : la violation de contrainte remontait auparavant non
    // interceptée. La page, elle, masque le formulaire — mais l'API ne peut pas en dépendre.
    authAs(clientId);
    const target = await getTarget();
    const res = await reviewsPost(postReq({ targetId: target!.id, note: 3 }), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_reviewed");
  });

  it("V6 — l'id de la MISSION reste refusé (la régression d'origine)", async () => {
    authAs(providerId);
    const res = await reviewsPost(postReq({ targetId: missionId, note: 4 }), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_target");
  });
});
