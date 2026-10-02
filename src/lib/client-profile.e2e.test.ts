/**
 * Profil client de bout en bout (2026-09-23) — GET/PUT /api/profile/client sur la vraie base.
 *
 * Le point délicat que ce fichier surveille : le formulaire couvre DEUX tables. Les
 * préférences vont dans ClientProfile, l'adresse et la localisation restent sur User (elles
 * servent aussi au prestataire). Une écriture partielle laisserait un profil incohérent et
 * un pourcentage de complétion faux.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import * as clientProfile from "@/app/api/profile/client/route";

const RUN = Date.now();
let clientId = "";

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const put = (body: unknown) =>
  new Request("http://localhost/api/profile/client", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `e2e-client-profil-${RUN}@flexwork.test`,
      tel: `+229${RUN}`.slice(0, 16),
      firstname: "Koffi",
      lastname: "Adjovi",
      country: "BJ",
      city: "Cotonou",
      role: "client",
    },
  });
  clientId = user.id;
});

afterAll(async () => {
  await prisma.clientProfile.deleteMany({ where: { userId: clientId } });
  await prisma.user.deleteMany({ where: { id: clientId } });
});

describe("accès", () => {
  it("refuse la lecture et l'écriture à un anonyme", async () => {
    as(null);
    expect((await clientProfile.GET()).status).toBe(401);
    expect((await clientProfile.PUT(put({ profession: "x" }))).status).toBe(401);
  });
});

describe("lecture avant toute saisie", () => {
  it("répond 200 avec un profil nul — un client qui n'a rien rempli n'est pas une erreur", async () => {
    as(clientId);
    const res = await clientProfile.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile).toBeNull();
  });

  it("calcule déjà une complétion sur les seuls champs de l'inscription", async () => {
    as(clientId);
    const body = await (await clientProfile.GET()).json();
    expect(body.completion.percent).toBe(38);
    expect(body.completion.missing.map((m: { key: string }) => m.key)).toContain("profession");
  });
});

describe("écriture sur deux tables", () => {
  it("crée le profil et écrit l'adresse sur User dans le même appel", async () => {
    as(clientId);
    const res = await clientProfile.PUT(
      put({
        profession: "Directeur d'exploitation",
        clientType: "entreprise",
        company: "SOBEBRA",
        sector: "Industrie et manufacture",
        languages: ["Français", "Fon"],
        currency: "XOF",
        address: "Rue 12.34",
        locality: "Fidjrossè",
      }),
    );
    expect(res.status).toBe(200);

    const profile = await prisma.clientProfile.findUnique({ where: { userId: clientId } });
    expect(profile?.company).toBe("SOBEBRA");
    expect(profile?.languages).toEqual(["Français", "Fon"]);

    const user = await prisma.user.findUnique({ where: { id: clientId } });
    expect(user?.address).toBe("Rue 12.34");
    expect(user?.locality).toBe("Fidjrossè");
  });

  it("renvoie la complétion recalculée, sans second appel", async () => {
    as(clientId);
    const body = await (await clientProfile.PUT(put({ profession: "Directrice" }))).json();
    // Le type reste « entreprise » : organisation et secteur entrent dans le barème.
    expect(body.completion.total).toBe(10);
    expect(body.completion.missing.map((m: { key: string }) => m.key)).toEqual(["photo"]);
  });

  it("met à jour sans dupliquer — un seul profil par compte", async () => {
    as(clientId);
    await clientProfile.PUT(put({ profession: "Chef de projet" }));
    expect(await prisma.clientProfile.count({ where: { userId: clientId } })).toBe(1);
    const profile = await prisma.clientProfile.findUnique({ where: { userId: clientId } });
    expect(profile?.profession).toBe("Chef de projet");
  });

  it("n'efface pas les champs User absents du payload", async () => {
    as(clientId);
    await clientProfile.PUT(put({ profession: "Chef de projet" }));
    const user = await prisma.user.findUnique({ where: { id: clientId } });
    // `address` n'était pas dans le dernier payload : il doit survivre.
    expect(user?.address).toBe("Rue 12.34");
    expect(user?.city).toBe("Cotonou");
  });

  it("efface en revanche un champ explicitement envoyé vide", async () => {
    as(clientId);
    await clientProfile.PUT(put({ address: "" }));
    const user = await prisma.user.findUnique({ where: { id: clientId } });
    expect(user?.address).toBe("");
  });
});

describe("validation", () => {
  it("refuse un type de client hors nomenclature", async () => {
    as(clientId);
    expect((await clientProfile.PUT(put({ clientType: "roi" }))).status).toBe(400);
  });

  it("refuse une devise hors zone couverte", async () => {
    as(clientId);
    expect((await clientProfile.PUT(put({ currency: "BTC" }))).status).toBe(400);
  });

  it("refuse un corps illisible, sans laisser remonter une 500", async () => {
    as(clientId);
    const res = await clientProfile.PUT(
      new Request("http://localhost/api/profile/client", { method: "PUT", body: "pas du json" }),
    );
    expect(res.status).toBe(400);
  });
});
