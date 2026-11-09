/**
 * Fiche publique d'une mission (2026-11-09) — route réelle, vraie base. Un visiteur non connecté
 * lit une mission PUBLIÉE, sans rien qui identifie le client ni ce qui est réservé aux
 * candidats ; toute autre mission répond 404.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/missions/[id]/public/route";
import { MASKED, maskContacts } from "@/lib/public-mission";

const RUN = Date.now();
let clientId = "";
let suspendedId = "";
const ids: Record<string, string> = {};

const get = (id: string) => GET(new Request(`http://localhost/api/missions/${id}/public`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  let seq = 0;
  const mk = (label: string, status: string) =>
    prisma.user.create({
      data: {
        email: `pubm-${label}-${RUN}@flexwork.test`,
        tel: `+2295${String(RUN).slice(-6)}${++seq}`,
        firstname: "Ignace",
        lastname: "Confidentiel",
        role: "client",
        kycStatus: "en_attente",
        status,
        country: "BJ",
      } as never,
    });
  const [client, suspended] = await Promise.all([mk("c", "active"), mk("s", "suspended")]);
  clientId = client.id;
  suspendedId = suspended.id;
  const base = { domaine: "design", budget: 150_000, currency: "XOF", delaiJours: 7, ville: "Cotonou", quartier: "Haie Vive" };
  const mkMission = (key: string, clientId: string, status: string, extra: Record<string, unknown> = {}) =>
    prisma.mission
      .create({
        data: {
          ...base,
          clientId,
          status,
          titre: `Mission publique ${key} ${RUN}`,
          description: "Logo pour mon restaurant. Appelez-moi au +229 97 12 34 56 ou ignace@exemple.bj.",
          cahierDesCharges: "Cahier secret",
          tags: ["Logo"],
          ...extra,
        } as never,
      })
      .then((m) => (ids[key] = m.id));
  await Promise.all([
    mkMission("publiee", clientId, "publiee"),
    mkMission("brouillon", clientId, "brouillon"),
    mkMission("engagee", clientId, "en_cours"),
    mkMission("suspendu", suspendedId, "publiee"),
  ]);
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, suspendedId] } } });
});

describe("GET /api/missions/[id]/public", () => {
  it("expose une mission publiée, sans identifier le client ni livrer le réservé", async () => {
    const res = await get(ids.publiee);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.titre).toContain("Mission publique publiee");
    expect(body.budget).toBe(150000);
    expect(body.ville).toBe("Cotonou");
    expect(body.clientVerified).toBe(false);
    expect(body.clientCountry).toBe("BJ");
    expect(body.competences).toEqual(["Logo"]);
    const raw = JSON.stringify(body);
    for (const secret of ["Confidentiel", "Ignace", clientId, "Haie Vive", "Cahier secret", "97 12 34 56", "ignace@exemple.bj"]) {
      expect(raw).not.toContain(secret);
    }
    expect(body.description).toContain(MASKED);
  });

  it.each(["brouillon", "engagee", "suspendu"])("répond 404 pour une mission %s", async (key) => {
    expect((await get(ids[key])).status).toBe(404);
  });

  it("répond 404 pour un identifiant inexistant ou mal formé", async () => {
    expect((await get("cmzzzzzzzzzzzzzzzzzzzzzzz")).status).toBe(404);
    expect((await get("../../etc")).status).toBe(404);
  });
});

describe("maskContacts", () => {
  it("masque emails, numéros et liens WhatsApp, garde le reste", () => {
    expect(maskContacts("Écrivez à a.b@c.com")).toBe(`Écrivez à ${MASKED}`);
    expect(maskContacts("Tel 0022997123456 ou 97.12.34.56")).toBe(`Tel ${MASKED} ou ${MASKED}`);
    expect(maskContacts("wa.me/22997123456 merci")).toBe(`${MASKED} merci`);
    expect(maskContacts("Budget 150 000 XOF, 3 pages, livraison en 2026")).toBe("Budget 150 000 XOF, 3 pages, livraison en 2026");
  });
});
