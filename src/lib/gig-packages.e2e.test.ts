/**
 * Gigs à trois formules (2026-11-08) — routes réelles, vraie base.
 *
 * Verrouille : les règles de création (titre « Je vais… », trois formules progressives,
 * visuel pour publier), l'achat d'une formule précise (prix, délai et révisions lus en base,
 * jamais dans la requête), la modification réservée au titulaire, la publication d'un Gig
 * complet seulement, et la visibilité de l'image de couverture.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as gigsGet, POST as gigPost } from "@/app/api/gigs/route";
import { PATCH as gigPatch } from "@/app/api/gigs/[id]/route";
import { POST as imagesPost, PATCH as imagesPatch } from "@/app/api/gigs/[id]/images/route";
import { GET as imageGet, DELETE as imageDelete } from "@/app/api/gigs/[id]/images/[index]/route";
import { POST as purchasePost } from "@/app/api/gigs/[id]/purchase/route";
import { prisma } from "@/lib/db";
import { gigBody } from "@/test/gig-fixture";

const RUN = Date.now();
let providerId = "";
let otherProviderId = "";
let clientId = "";
const gigIds: string[] = [];

const as = (id: string | null) => mockAuth.mockResolvedValue(id ? { user: { id } } : null);
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const imgCtx = (id: string, index: number) => ({ params: Promise.resolve({ id, index: String(index) }) });
function photoReq(name = "a.png") {
  const form = new FormData();
  form.append("file", new File([Buffer.from("png")], name, { type: "image/png" }));
  return new Request("http://localhost/api", { method: "POST", body: form });
}

async function createGig(body: Record<string, unknown>) {
  as(providerId);
  const res = await gigPost(json(body));
  if (res.status === 201) gigIds.push((await res.clone().json()).id);
  return res;
}

beforeAll(async () => {
  let seq = 0;
  const mk = (role: "artisan" | "client") =>
    prisma.user.create({
      data: {
        email: `gpk-${role}-${RUN}-${++seq}@flexwork.test`,
        tel: `+2295${String(RUN).slice(-6)}${seq}`,
        role,
        kycStatus: "verifie",
        status: "active",
        dateNaissance: new Date("1990-01-01"),
      },
    });
  const [p, o, c] = [await mk("artisan"), await mk("artisan"), await mk("client")];
  providerId = p.id;
  otherProviderId = o.id;
  clientId = c.id;
  await prisma.profile.create({ data: { userId: providerId, label: "P", isDefault: true, mainDomain: "Design" } });
});

afterAll(async () => {
  await prisma.gigOrder.deleteMany({ where: { gigId: { in: gigIds } } });
  await prisma.gig.deleteMany({ where: { id: { in: gigIds } } });
  await prisma.profile.deleteMany({ where: { userId: providerId } });
  await prisma.user.deleteMany({ where: { id: { in: [providerId, otherProviderId, clientId] } } });
});

describe("création", () => {
  it("crée un Gig à trois formules ; prix « à partir de » = Basique", async () => {
    const res = await createGig(gigBody({ titre: "créer votre logo", prix: 20_000, delaiJours: 3, status: "publie" }));
    expect(res.status).toBe(201);
    const gig = await prisma.gig.findUniqueOrThrow({ where: { id: gigIds[0] }, include: { packages: true } });
    expect(gig.titre).toBe("Je vais créer votre logo");
    expect(gig.packages).toHaveLength(3);
    expect(gig.prix).toBe(20_000);
    expect(gig.status).toBe("publie");
  });

  it("refuse un titre hors format, des prix non progressifs, l'ancien format à prix unique", async () => {
    expect((await createGig({ ...gigBody({ prix: 1, delaiJours: 1 }), titre: "Logo pro pas cher" })).status).toBe(400);
    const body = gigBody({ prix: 10_000, delaiJours: 2 });
    body.packages[2].prix = 5_000;
    expect((await createGig(body)).status).toBe(400);
    expect((await createGig({ titre: "Logo", description: "x", domaine: "design", prix: 1000, delaiJours: 1 })).status).toBe(400);
  });

  it("publier sans visuel est refusé ; en brouillon, c'est accepté", async () => {
    const sansVisuel = { ...gigBody({ prix: 10_000, delaiJours: 2, status: "publie" }), videoUrl: null };
    const res = await createGig(sansVisuel);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("visual_required");
    expect((await createGig({ ...sansVisuel, status: "brouillon" })).status).toBe(201);
  });
});

describe("achat d'une formule", () => {
  it("la commande prend prix, délai et révisions de la formule choisie, lus en base", async () => {
    as(clientId);
    const res = await purchasePost(json({ tier: "premium", prix: 1 }), ctx(gigIds[0]));
    expect(res.status).toBe(201);
    const order = await prisma.gigOrder.findUniqueOrThrow({ where: { id: (await res.json()).orderId } });
    expect(order.packageTier).toBe("premium");
    expect(order.montant).toBe(60_000);
    const snap = order.termsSnapshot as { prix: number; delaiJours: number; formule: { revisions: number } };
    expect(snap).toMatchObject({ prix: 60_000, delaiJours: 8, formule: { revisions: 5 } });
  });

  it("sans formule précisée : Basique ; formule inconnue : Basique aussi", async () => {
    as(clientId);
    const a = await purchasePost(json({}), ctx(gigIds[0]));
    const b = await purchasePost(json({ tier: "luxe" }), ctx(gigIds[0]));
    for (const res of [a, b]) {
      const order = await prisma.gigOrder.findUniqueOrThrow({ where: { id: (await res.json()).orderId } });
      expect(order.montant).toBe(20_000);
      expect(order.packageTier).toBe("basique");
    }
  });
});

describe("modification et publication", () => {
  it("seul le titulaire modifie ; les autres reçoivent 404", async () => {
    as(otherProviderId);
    expect((await gigPatch(json({ status: "cloture" }, "PATCH"), ctx(gigIds[0]))).status).toBe(404);
    as(providerId);
    const res = await gigPatch(json(gigBody({ titre: "créer votre identité visuelle", prix: 30_000, delaiJours: 4 }), "PATCH"), ctx(gigIds[0]));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.titre).toBe("Je vais créer votre identité visuelle");
    expect(view.prixDepart).toBe(30_000);
    // Les commandes passées gardent leur prix figé.
    const orders = await prisma.gigOrder.findMany({ where: { gigId: gigIds[0] }, select: { montant: true } });
    expect(orders.map((o) => o.montant).sort()).toEqual([20_000, 20_000, 60_000]);
  });

  it("publier un brouillon sans visuel est refusé, puis accepté une fois une photo ajoutée", async () => {
    const draftId = gigIds[gigIds.length - 1];
    as(providerId);
    const refused = await gigPatch(json({ status: "publie" }, "PATCH"), ctx(draftId));
    expect((await refused.json()).error).toBe("visual_required");

    const up = await imagesPost(photoReq(), ctx(draftId));
    expect(up.status).toBe(201);
    expect((await gigPatch(json({ status: "publie" }, "PATCH"), ctx(draftId))).status).toBe(200);

    // Photo d'un service publié par un prestataire listé : visible d'un visiteur.
    as(null);
    expect((await imageGet(new Request("http://localhost/api"), imgCtx(draftId, 0))).status).toBe(200);
    // La seule photo d'un service en ligne sans vidéo ne peut pas être retirée.
    as(providerId);
    expect((await imageDelete(new Request("http://localhost/api", { method: "DELETE" }), imgCtx(draftId, 0))).status).toBe(409);
    // Remis en brouillon : invisible pour un visiteur, visible du titulaire.
    await gigPatch(json({ status: "brouillon" }, "PATCH"), ctx(draftId));
    as(null);
    expect((await imageGet(new Request("http://localhost/api"), imgCtx(draftId, 0))).status).toBe(404);
    as(providerId);
    expect((await imageGet(new Request("http://localhost/api"), imgCtx(draftId, 0))).status).toBe(200);
  });

  it("3 photos au plus ; réordonner change la couverture ; retirer décale les suivantes", async () => {
    const draftId = gigIds[gigIds.length - 1];
    as(providerId);
    expect((await imagesPost(photoReq("b.png"), ctx(draftId))).status).toBe(201);
    expect((await imagesPost(photoReq("c.png"), ctx(draftId))).status).toBe(201);
    const fourth = await imagesPost(photoReq("d.png"), ctx(draftId));
    expect(fourth.status).toBe(409);
    expect((await fourth.json()).error).toBe("too_many_images");

    const before = (await prisma.gig.findUniqueOrThrow({ where: { id: draftId } })).imagePaths;
    expect(before).toHaveLength(3);
    const reordered = await imagesPatch(json({ order: [2, 0, 1] }, "PATCH"), ctx(draftId));
    expect(reordered.status).toBe(200);
    expect((await prisma.gig.findUniqueOrThrow({ where: { id: draftId } })).imagePaths).toEqual([before[2], before[0], before[1]]);
    // Un ordre qui n'est pas une permutation exacte est refusé.
    expect((await imagesPatch(json({ order: [0, 0, 1] }, "PATCH"), ctx(draftId))).status).toBe(400);

    expect((await imageDelete(new Request("http://localhost/api", { method: "DELETE" }), imgCtx(draftId, 0))).status).toBe(200);
    expect((await prisma.gig.findUniqueOrThrow({ where: { id: draftId } })).imagePaths).toEqual([before[0], before[1]]);
    // Hors de la série (index 2 désormais vide, ou invalide) : 404.
    expect((await imageGet(new Request("http://localhost/api"), imgCtx(draftId, 2))).status).toBe(404);
    expect((await imageGet(new Request("http://localhost/api"), { params: Promise.resolve({ id: draftId, index: "../x" }) })).status).toBe(404);
  });

  it("un tiers ne téléverse, ne réordonne ni ne retire les photos du service d'un autre", async () => {
    as(otherProviderId);
    const draftId = gigIds[gigIds.length - 1];
    expect((await imagesPost(photoReq(), ctx(draftId))).status).toBe(404);
    expect((await imagesPatch(json({ order: [1, 0] }, "PATCH"), ctx(draftId))).status).toBe(404);
    expect((await imageDelete(new Request("http://localhost/api", { method: "DELETE" }), imgCtx(draftId, 0))).status).toBe(404);
  });

  it("refuse un fichier qui n'est pas une image", async () => {
    as(providerId);
    const form = new FormData();
    form.append("file", new File([Buffer.from("%PDF")], "x.pdf", { type: "application/pdf" }));
    const res = await imagesPost(new Request("http://localhost/api", { method: "POST", body: form }), ctx(gigIds[0]));
    expect(res.status).toBe(400);
  });
});

describe("recherche par mots-clés", () => {
  it("?q= trouve un Gig par son mot-clé", async () => {
    as(providerId);
    await gigPatch(json(gigBody({ titre: "créer votre logo", prix: 30_000, delaiJours: 4, tags: [`motcle${RUN}`] }), "PATCH"), ctx(gigIds[0]));
    as(clientId);
    const res = await gigsGet(new Request(`http://localhost/api/gigs?q=motcle${RUN}`));
    const { items } = await res.json();
    expect(items.map((g: { id: string }) => g.id)).toEqual([gigIds[0]]);
    expect(items[0].packages).toHaveLength(3);
  });
});

describe("catalogue client", () => {
  it("un compte prestataire ne voit pas ses propres services dans le catalogue (il ne peut pas les commander)", async () => {
    as(providerId);
    const own = await gigsGet(new Request(`http://localhost/api/gigs?q=motcle${RUN}`));
    expect((await own.json()).items).toEqual([]);
    // …mais les retrouve dans « Mes services ».
    const mine = await gigsGet(new Request("http://localhost/api/gigs?mine=true"));
    expect((await mine.json()).items.map((g: { id: string }) => g.id)).toContain(gigIds[0]);
  });
});

describe("suppression", () => {
  it("le titulaire supprime un service jamais commandé ; un tiers reçoit 404", async () => {
    const { DELETE: gigDelete } = await import("@/app/api/gigs/[id]/route");
    const res = await createGig(gigBody({ titre: "supprimer ce service", prix: 5_000, delaiJours: 1, status: "brouillon" }));
    const id = (await res.json()).id as string;
    as(otherProviderId);
    expect((await gigDelete(new Request("http://localhost/api", { method: "DELETE" }), ctx(id))).status).toBe(404);
    as(providerId);
    expect((await gigDelete(new Request("http://localhost/api", { method: "DELETE" }), ctx(id))).status).toBe(200);
    expect(await prisma.gig.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.gigPackage.count({ where: { gigId: id } })).toBe(0);
  });

  it("un service déjà commandé ne se supprime pas (409) : ses commandes restent", async () => {
    const { DELETE: gigDelete } = await import("@/app/api/gigs/[id]/route");
    as(providerId);
    const res = await gigDelete(new Request("http://localhost/api", { method: "DELETE" }), ctx(gigIds[0]));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("gig_has_orders");
    expect(await prisma.gigOrder.count({ where: { gigId: gigIds[0] } })).toBeGreaterThan(0);
  });
});
