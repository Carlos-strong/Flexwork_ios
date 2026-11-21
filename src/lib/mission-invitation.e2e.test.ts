/**
 * Mission lancée depuis le profil d'un prestataire (2026-11-08) — route réelle, vraie base.
 *
 * Le bouton « Publier une mission en <métier> » du profil public ouvre le formulaire sur le
 * métier du prestataire et transmet son id (`invitedProviderId`). À la publication, ce
 * prestataire reçoit une invitation à candidater. L'id vient du navigateur : ces tests
 * verrouillent qu'il n'ouvre AUCUN droit — invitation seulement d'un prestataire listé,
 * autre que le client, dont le domaine est celui de la mission.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { POST as createMission } from "@/app/api/missions/route";

const RUN = Date.now();
const missionIds: string[] = [];
let clientId = "";
let invitedId = "";
let offDomainId = "";
let suspendedId = "";
let metierId = "";
let metierLibelle = "";

const as = (userId: string) => mockAuth.mockResolvedValue({ user: { id: userId } });

async function publish(invitedProviderId?: string) {
  as(clientId);
  const res = await createMission(
    new Request("http://localhost/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre: `Mission invitation ${RUN}`,
        description: "Description suffisamment longue pour passer la validation du schéma de publication.",
        delaiJours: 5,
        metierId,
        budgetType: "FIXED",
        budget: 100_000,
        mode: "distance",
        status: "publiee",
        invitedProviderId,
      }),
    }),
  );
  expect(res.status).toBe(200);
  const { id, status } = await res.json();
  expect(status).toBe("publiee");
  missionIds.push(id);
  return id as string;
}

const invitations = (missionId: string) =>
  prisma.missionNotification.findMany({ where: { missionId, type: "mission_invitation" }, select: { userId: true } });

beforeAll(async () => {
  const metier = await prisma.metier.findFirstOrThrow({ orderBy: { id: "asc" } });
  metierId = metier.id;
  metierLibelle = metier.libelle;

  let seq = 0;
  const mk = (label: string, data: Record<string, unknown>) =>
    prisma.user.create({
      data: {
        email: `inv-${label}-${RUN}@flexwork.test`,
        tel: `+2296${String(RUN).slice(-6)}${++seq}`,
        dateNaissance: new Date("1990-01-01"),
        ...data,
      } as never,
    });
  const [client, invited, offDomain, suspended] = await Promise.all([
    mk("c", { role: "client", kycStatus: "verifie", status: "active" }),
    mk("inv", { role: "artisan", kycStatus: "verifie", status: "active", firstname: "Awa" }),
    mk("offd", { role: "artisan", kycStatus: "verifie", status: "active" }),
    mk("susp", { role: "artisan", kycStatus: "verifie", status: "suspended" }),
  ]);
  clientId = client.id;
  invitedId = invited.id;
  offDomainId = offDomain.id;
  suspendedId = suspended.id;
  await prisma.profile.createMany({
    data: [
      { userId: invitedId, label: "P", isDefault: true, mainDomain: metierLibelle, metierId },
      { userId: offDomainId, label: "P", isDefault: true, mainDomain: `Domaine sans rapport ${RUN}` },
      { userId: suspendedId, label: "P", isDefault: true, mainDomain: metierLibelle, metierId },
    ],
  });
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  const ids = [clientId, invitedId, offDomainId, suspendedId];
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("POST /api/missions — invitation du prestataire depuis son profil", () => {
  it("le prestataire du profil, listé et du même domaine, est invité à candidater", async () => {
    const missionId = await publish(invitedId);
    expect((await invitations(missionId)).map((n) => n.userId)).toEqual([invitedId]);
    // Pas d'alerte générique en double pour lui.
    const generic = await prisma.missionNotification.count({ where: { missionId, userId: invitedId, type: "mission_match" } });
    expect(generic).toBe(0);
  });

  it("un prestataire hors du domaine de la mission n'est pas invité", async () => {
    expect(await invitations(await publish(offDomainId))).toEqual([]);
  });

  it("un compte suspendu n'est pas invité", async () => {
    expect(await invitations(await publish(suspendedId))).toEqual([]);
  });

  it("un id inexistant n'invite personne", async () => {
    expect(await invitations(await publish("cmzzzzzzzzzzzzzzzzzzzzzzz"))).toEqual([]);
  });

  // 2026-11-09 : une mission lancée depuis SON PROPRE profil est refusée — ni publiée, ni
  // enregistrée en brouillon (avant, seule l'invitation était ignorée et la mission partait).
  it.each([
    ["le prestataire du profil", () => invitedId, "publiee"],
    ["le prestataire du profil, en brouillon", () => invitedId, "brouillon"],
    ["un client qui se désigne lui-même", () => clientId, "publiee"],
  ] as const)("refuse une mission adressée à soi-même : %s", async (_label, who, status) => {
    const self = who();
    as(self);
    const titre = `Mission pour soi ${RUN} ${status} ${self}`;
    const res = await createMission(
      new Request("http://localhost/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titre,
          description: "Description suffisamment longue pour passer la validation du schéma de publication.",
          delaiJours: 5,
          metierId,
          budgetType: "FIXED",
          budget: 100_000,
          mode: "distance",
          status,
          invitedProviderId: self,
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("self_invitation");
    expect(await prisma.mission.count({ where: { titre } })).toBe(0);
  });

  it("sans invitation, la publication reste inchangée", async () => {
    expect(await invitations(await publish())).toEqual([]);
  });
});
