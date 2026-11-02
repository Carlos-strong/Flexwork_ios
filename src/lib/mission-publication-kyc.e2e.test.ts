/**
 * Publication et vérification d'identité, par les vraies routes (politique 2026-11-02,
 * src/lib/kyc-policy.ts) :
 *
 *  1. KYC en attente → la mission est PUBLIÉE : l'identité n'est exigée qu'à la
 *     contractualisation et au financement.
 *  2. Contrôles antifraude : au-delà de UNVERIFIED_PUBLISHED_LIMIT missions en ligne, ou KYC
 *     rejeté, la mission n'est pas perdue mais gardée en brouillon marqué
 *     `publicationRequestedAt` (réponse `publicationPending: "kyc"`).
 *  3. Elle reste conforme aux règles de publication : une mission non publiable est refusée
 *     AVANT, comme une publication normale.
 *  4. Débloqué (identité vérifiée) → POST /api/missions/[id]/publish la publie, une seule fois.
 *  5. Encore retenue, ou mission d'autrui → refus.
 *  6. Un client non vérifié ne retient pas de prestataire (acceptation refusée en 403).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as publishPost } from "@/app/api/missions/[id]/publish/route";
import { GET as pendingGet } from "@/app/api/missions/pending-publication/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { prisma } from "@/lib/db";
import { UNVERIFIED_PUBLISHED_LIMIT } from "@/lib/kyc-policy";

const RUN = Date.now();
const ids = { client: "", other: "", provider: "" };
const missionIds: string[] = [];

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const at = (id: string) => ({ params: Promise.resolve({ id }) });

async function publier(body: Record<string, unknown> = {}) {
  authAs(ids.client);
  const res = await missionPost(
    new Request("http://localhost/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre: `Publication KYC ${RUN}`,
        description: "Mission de test : publication demandée avant la vérification de l'identité.",
        domaine: "batiment",
        mode: "distance",
        currency: "XOF",
        delaiJours: 10,
        budgetType: "FIXED",
        budget: 80_000,
        status: "publiee",
        ...body,
      }),
    }),
  );
  const data = await res.clone().json().catch(() => ({}));
  if (data.id) missionIds.push(data.id);
  return { res, data };
}

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, kycStatus: "en_attente" | "verifie", role: "client" | "artisan" = "client") =>
    prisma.user.create({
      data: {
        email: `pk-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}7`,
        status: "active",
        country: "BJ",
        kycStatus,
        role,
      },
    });
  ids.client = (await mk("client", "en_attente")).id;
  ids.other = (await mk("autre", "verifie")).id;
  ids.provider = (await mk("prestataire", "verifie", "artisan")).id;
});

afterAll(async () => {
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.missionProposal.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

const atProposal = (id: string, proposalId: string) => ({ params: Promise.resolve({ id, proposalId }) });

describe("publication avec un KYC en attente", () => {
  const publishedIds: string[] = [];
  let heldId = "";

  it("publie directement, sans attendre la vérification", async () => {
    const { res, data } = await publier();
    expect(res.status).toBe(200);
    expect(data.status).toBe("publiee");
    expect(data.publicationPending).toBeUndefined();
    publishedIds.push(data.id);
  });

  it("refuse d'abord une mission non publiable (budget manquant), comme une publication normale", async () => {
    const { res, data } = await publier({ budget: undefined });
    expect(res.status).toBe(400);
    expect(data.error).toBe("budget_required_to_publish");
  });

  it(`au-delà de ${UNVERIFIED_PUBLISHED_LIMIT} missions en ligne : gardée en brouillon marqué`, async () => {
    while (publishedIds.length < UNVERIFIED_PUBLISHED_LIMIT) {
      const { data } = await publier();
      expect(data.status).toBe("publiee");
      publishedIds.push(data.id);
    }
    const { res, data } = await publier();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ status: "brouillon", publicationPending: "kyc" });
    expect(data.publicationBlock.error).toBe("unverified_publication_limit");
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: data.id } });
    expect(mission.publicationRequestedAt).toBeInstanceOf(Date);
    heldId = data.id;
  });

  it("la carte du tableau de bord dit pourquoi, et publier reste refusé", async () => {
    authAs(ids.client);
    const body = await (await pendingGet()).json();
    expect(body).toMatchObject({ kycVerified: false, canPublish: false });
    expect(body.publicationBlock.error).toBe("unverified_publication_limit");
    expect(body.missions.map((m: { id: string }) => m.id)).toEqual([heldId]);

    const res = await publishPost(new Request("http://localhost"), at(heldId));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("unverified_publication_limit");
  });

  it("un autre client ne peut pas publier ce brouillon", async () => {
    authAs(ids.other);
    const res = await publishPost(new Request("http://localhost"), at(heldId));
    expect(res.status).toBe(404);
  });

  it("un client non vérifié ne retient pas de prestataire", async () => {
    const proposal = await prisma.missionProposal.create({
      data: { missionId: publishedIds[0], providerId: ids.provider, message: "Candidature de test" },
    });
    authAs(ids.client);
    const res = await acceptPost(new Request("http://localhost"), atProposal(publishedIds[0], proposal.id));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("kyc_not_verified");
    const unchanged = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(unchanged.status).toBe(proposal.status);
  });

  it("KYC rejeté : plus aucune publication, même sous le plafond", async () => {
    await prisma.mission.updateMany({ where: { id: { in: publishedIds } }, data: { status: "cloturee" } });
    await prisma.user.update({ where: { id: ids.client }, data: { kycStatus: "rejete" } });
    const { data } = await publier();
    expect(data).toMatchObject({ status: "brouillon", publicationPending: "kyc" });
    expect(data.publicationBlock.error).toBe("kyc_rejected");
  });

  it("identité vérifiée : publication en un clic, une seule fois", async () => {
    await prisma.user.update({ where: { id: ids.client }, data: { kycStatus: "verifie" } });
    authAs(ids.client);

    const first = await publishPost(new Request("http://localhost"), at(heldId));
    expect(first.status).toBe(200);
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: heldId } });
    expect(mission.status).toBe("publiee");
    expect(mission.publicationRequestedAt).toBeNull();

    const again = await publishPost(new Request("http://localhost"), at(heldId));
    expect(again.status).toBe(409);

    const body = await (await pendingGet()).json();
    expect(body).toMatchObject({ kycVerified: true, canPublish: true, publicationBlock: null });
  });
});
