/**
 * Pièces jointes déposées AVANT la création de la mission (2026-09-23).
 *
 * Le champ de téléversement du formulaire était de l'UI morte : il promettait « scan antivirus
 * + stockage chiffré » et n'envoyait rien. L'endpoint existant ne pouvait pas le remplacer —
 * il exige une mission déjà acceptée (US-1302, anti-travail-test gratuit).
 *
 * Ce que ces tests verrouillent : `draftId` vient du navigateur et n'authentifie RIEN. Toute
 * requête est filtrée sur l'utilisateur de la session, et un identifiant de brouillon deviné
 * ne doit donner accès à aucun fichier ni permettre de se les rattacher.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import * as draftRoute from "@/app/api/missions/attachments/draft/route";
import { POST as createMission } from "@/app/api/missions/route";

const RUN = Date.now();
let clientId = "";
let autreId = "";
let metierId = "";
const DRAFT = `draft-${RUN}`;
const missionIds: string[] = [];

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

function upload(draftId: string, name = "plan.pdf", type = "application/pdf", size = 1024) {
  const body = new FormData();
  body.append("draftId", draftId);
  body.append("file", new File([new Uint8Array(size)], name, { type }));
  return draftRoute.POST(new Request("http://localhost/api/missions/attachments/draft", { method: "POST", body }));
}

const list = (draftId: string) =>
  draftRoute.GET(new NextRequest(`http://localhost/api/missions/attachments/draft?draftId=${draftId}`));

const remove = (id: string) =>
  draftRoute.DELETE(
    new Request("http://localhost/api/missions/attachments/draft", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );

beforeAll(async () => {
  const [client, autre] = await Promise.all([
    prisma.user.create({ data: { email: `e2e-dpj-c-${RUN}@flexwork.test`, tel: `+2294${String(RUN).slice(-7)}`, role: "client", country: "BJ" } }),
    prisma.user.create({ data: { email: `e2e-dpj-a-${RUN}@flexwork.test`, tel: `+2293${String(RUN).slice(-7)}`, role: "client", country: "BJ" } }),
  ]);
  clientId = client.id;
  autreId = autre.id;
  // Catégorie STABLE (2026-10-01) : la plus ancienne qui ait un métier — celles du référentiel.
  // Un `findFirst` sans ordre pouvait tomber sur une catégorie de test qu'un autre fichier, exécuté
  // en parallèle, crée sans métier ou supprime en cours de route.
  const cat = await prisma.categorie.findFirst({ where: { metiers: { some: {} } }, orderBy: { id: "asc" }, include: { metiers: { take: 1, orderBy: { id: "asc" } } } });
  metierId = cat!.metiers[0].id;
});

afterAll(async () => {
  await prisma.missionAttachment.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.missionDraftAttachment.deleteMany({ where: { uploaderId: { in: [clientId, autreId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, autreId] } } });
});

describe("dépôt", () => {
  it("refuse un anonyme", async () => {
    as(null);
    expect((await upload(DRAFT)).status).toBe(401);
    expect((await list(DRAFT)).status).toBe(401);
  });

  it("accepte un PDF et le rend listable", async () => {
    as(clientId);
    const res = await upload(DRAFT);
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.fileName).toBe("plan.pdf");
    // URL signée, jamais un chemin de stockage.
    expect(created.url).toMatch(/^\/api\/files\/.+/);

    const { items } = await (await list(DRAFT)).json();
    expect(items).toHaveLength(1);
  });

  it("refuse un format non autorisé", async () => {
    as(clientId);
    const res = await upload(DRAFT, "virus.exe", "application/x-msdownload");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_file_type");
  });

  it("refuse un fichier de plus de 10 Mo", async () => {
    as(clientId);
    const res = await upload(DRAFT, "gros.pdf", "application/pdf", 11 * 1024 * 1024);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("file_too_large");
  });
});

describe("cloisonnement entre comptes", () => {
  it("ne montre à personne d'autre les fichiers d'un draftId, même connu", async () => {
    as(autreId);
    const { items } = await (await list(DRAFT)).json();
    // `draftId` est deviné ici : il ne doit rien donner.
    expect(items).toEqual([]);
  });

  it("refuse de supprimer la pièce jointe d'autrui", async () => {
    as(clientId);
    const { items } = await (await list(DRAFT)).json();
    as(autreId);
    const res = await remove(items[0].id);
    // 404 et non 403 : un tiers ne doit pas apprendre que ce fichier existe.
    expect(res.status).toBe(404);
  });

  it("laisse le propriétaire supprimer la sienne", async () => {
    as(clientId);
    const before = await (await list(DRAFT)).json();
    expect((await remove(before.items[0].id)).status).toBe(200);
    const after = await (await list(DRAFT)).json();
    expect(after.items).toHaveLength(before.items.length - 1);
  });
});

describe("rattachement à la création de la mission", () => {
  it("convertit les pièces jointes du brouillon, et seulement celles de l'appelant", async () => {
    const draftId = `${DRAFT}-convert`;
    as(clientId);
    await upload(draftId, "cahier.pdf");
    await upload(draftId, "photo.jpg", "image/jpeg");
    // Déposée par un AUTRE compte sous le MÊME draftId : ne doit pas suivre.
    as(autreId);
    await upload(draftId, "intrus.pdf");

    as(clientId);
    const res = await createMission(
      new Request("http://localhost/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titre: "Mission avec cahier des charges",
          description: "Description suffisamment longue pour la validation du schéma.",
          metierId,
          delaiJours: 5,
          status: "brouillon",
          draftId,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const mission = await res.json();
    missionIds.push(mission.id);

    const attached = await prisma.missionAttachment.findMany({ where: { missionId: mission.id } });
    expect(attached).toHaveLength(2);
    expect(attached.every((a) => a.uploaderId === clientId)).toBe(true);

    // Les lignes de brouillon converties sont consommées ; celle de l'autre compte reste.
    expect(await prisma.missionDraftAttachment.count({ where: { draftId, uploaderId: clientId } })).toBe(0);
    expect(await prisma.missionDraftAttachment.count({ where: { draftId, uploaderId: autreId } })).toBe(1);
  });

  it("crée la mission normalement quand aucun fichier n'a été déposé", async () => {
    as(clientId);
    const res = await createMission(
      new Request("http://localhost/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titre: "Mission sans pièce jointe",
          description: "Description suffisamment longue pour la validation du schéma.",
          metierId,
          delaiJours: 5,
          status: "brouillon",
          draftId: `${DRAFT}-vide`,
        }),
      }),
    );
    expect(res.status).toBe(200);
    missionIds.push((await res.json()).id);
  });
});
