/**
 * Publication demandée avant vérification d'identité (2026-10-06), par les vraies routes :
 *
 *  1. « Publier » sans KYC vérifié → la mission n'est pas perdue : enregistrée en brouillon,
 *     marquée `publicationRequestedAt`, réponse `publicationPending: "kyc"`.
 *  2. Elle reste conforme aux règles de publication : une mission non publiable est refusée
 *     AVANT, comme une publication normale (sinon on enregistrerait un brouillon impubliable).
 *  3. Identité vérifiée → POST /api/missions/[id]/publish la publie, une seule fois.
 *  4. Encore non vérifiée, ou mission d'autrui → refus.
 *  5. Tant qu'elle n'est pas publiée, une mission n'apparaît PAS dans la gestion des missions
 *     (GET /api/missions, résumé du tableau de bord) — seulement dans la carte des brouillons.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as publishPost } from "@/app/api/missions/[id]/publish/route";
import { GET as pendingGet } from "@/app/api/missions/pending-publication/route";
import { GET as missionsGet } from "@/app/api/missions/route";
import { GET as summaryGet } from "@/app/api/dashboard/client-summary/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const ids = { client: "", other: "" };
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
  const mk = (key: string, kycStatus: "en_attente" | "verifie") =>
    prisma.user.create({
      data: {
        email: `pk-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}7`,
        status: "active",
        country: "BJ",
        kycStatus,
        role: "client",
      },
    });
  ids.client = (await mk("client", "en_attente")).id;
  ids.other = (await mk("autre", "verifie")).id;
});

afterAll(async () => {
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

const managedIds = async () => {
  authAs(ids.client);
  const list = await (await missionsGet()).json();
  const summary = await (await summaryGet()).json();
  return {
    missions: list.items.map((m: { id: string }) => m.id) as string[],
    recent: summary.missions.map((m: { id: string }) => m.id) as string[],
    total: summary.stats.total as number,
  };
};

describe("publication demandée sans identité vérifiée", () => {
  let pendingId = "";
  let draftId = "";

  it("enregistre la mission en brouillon marqué, au lieu de la refuser", async () => {
    const { res, data } = await publier();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ status: "brouillon", publicationPending: "kyc" });
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: data.id } });
    expect(mission.status).toBe("brouillon");
    expect(mission.publicationRequestedAt).toBeInstanceOf(Date);
    pendingId = data.id;
  });

  it("refuse d'abord une mission non publiable (budget manquant), comme une publication normale", async () => {
    const { res, data } = await publier({ budget: undefined });
    expect(res.status).toBe(400);
    expect(data.error).toBe("budget_required_to_publish");
  });

  it("un brouillon ordinaire n'est pas marqué", async () => {
    const { data } = await publier({ status: "brouillon" });
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: data.id } });
    expect(mission.publicationRequestedAt).toBeNull();
    draftId = data.id;
  });

  it("aucun brouillon dans la gestion des missions (liste et tableau de bord)", async () => {
    const managed = await managedIds();
    expect(managed.missions).not.toContain(pendingId);
    expect(managed.missions).not.toContain(draftId);
    expect(managed.recent).toEqual([]);
    expect(managed.total).toBe(0);
  });

  it("la carte du tableau de bord liste les brouillons, publication demandée en tête", async () => {
    authAs(ids.client);
    const body = await (await pendingGet()).json();
    expect(body.kycVerified).toBe(false);
    expect(body.missions.map((m: { id: string }) => m.id)).toEqual([pendingId, draftId]);
  });

  it("publier le brouillon reste refusé tant que l'identité n'est pas vérifiée", async () => {
    authAs(ids.client);
    const res = await publishPost(new Request("http://localhost"), at(pendingId));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("kyc_not_verified");
  });

  it("un autre client ne peut pas publier ce brouillon", async () => {
    authAs(ids.other);
    const res = await publishPost(new Request("http://localhost"), at(pendingId));
    expect(res.status).toBe(404);
  });

  it("identité vérifiée : publication en un clic, une seule fois", async () => {
    await prisma.user.update({ where: { id: ids.client }, data: { kycStatus: "verifie" } });
    authAs(ids.client);

    const first = await publishPost(new Request("http://localhost"), at(pendingId));
    expect(first.status).toBe(200);
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: pendingId } });
    expect(mission.status).toBe("publiee");
    expect(mission.publicationRequestedAt).toBeNull();

    const again = await publishPost(new Request("http://localhost"), at(pendingId));
    expect(again.status).toBe(409);

    const body = await (await pendingGet()).json();
    expect(body.kycVerified).toBe(true);
    expect(body.missions.map((m: { id: string }) => m.id)).toEqual([draftId]);

    // Publiée : elle entre dans la gestion des missions ; le brouillon, toujours pas.
    const managed = await managedIds();
    expect(managed.missions).toEqual([pendingId]);
    expect(managed.recent).toEqual([pendingId]);
    expect(managed.total).toBe(1);
  });
});
