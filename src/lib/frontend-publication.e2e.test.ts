/**
 * Chaîne de publication du frontend, de bout en bout (2026-09-21).
 *
 * Le point central : le brouillon NE FUIT PAS. Tout le reste de la console s'appuie sur cette
 * promesse — c'est elle qui autorise à éditer en pleine journée sans mettre le site public en
 * désordre. Elle tient par un seul mécanisme, l'instantané figé à la publication ; ce fichier
 * l'exerce sur la vraie base, contre les vraies routes.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { GET as publicConfig } from "@/app/api/frontend/config/route";
import { POST as publish, GET as listReleases } from "@/app/api/admin/frontend/releases/route";
import { POST as rollback } from "@/app/api/admin/frontend/releases/[version]/route";
import { POST as createMenuItem } from "@/app/api/admin/frontend/menus/route";
import { PATCH as patchMenuItem } from "@/app/api/admin/frontend/menus/[id]/route";
import { frontendEtag } from "@/lib/frontend-config";

const RUN = Date.now();
const EDITOR_EMAIL = `e2e-frontend-editeur-${RUN}@flexwork.test`;
const KYC_EMAIL = `e2e-frontend-kyc-${RUN}@flexwork.test`;
const CLIENT_EMAIL = `e2e-frontend-client-${RUN}@flexwork.test`;
// Sonde du brouillon : une entrée de menu. La taxonomie servait à cet usage jusqu'au
// 2026-09-22 ; reprise de flexwork_job, elle s'édite désormais en direct et n'a plus de
// brouillon (voir taxonomy-catalog.e2e.test.ts).
const PROBE_MENU = "footer_apropos";
const PROBE_LABEL = `E2E ${RUN} Sonde`;

let editorId = "";
let kycAdminId = "";
let clientId = "";
let probeId = "";

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const json = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const [editor, kycAdmin, client] = await Promise.all([
    prisma.user.create({
      data: { email: EDITOR_EMAIL, tel: `+229${RUN}70`, role: "client", isAdmin: true, adminRole: "frontend", country: "BJ" },
    }),
    prisma.user.create({
      data: { email: KYC_EMAIL, tel: `+229${RUN}71`, role: "client", isAdmin: true, adminRole: "kyc", country: "BJ" },
    }),
    prisma.user.create({
      data: { email: CLIENT_EMAIL, tel: `+229${RUN}72`, role: "client", country: "BJ" },
    }),
  ]);
  editorId = editor.id;
  kycAdminId = kycAdmin.id;
  clientId = client.id;
});

afterAll(async () => {
  await prisma.frontendRelease.deleteMany({ where: { publishedById: editorId } });
  await prisma.frontendMenuItem.deleteMany({ where: { label: { startsWith: `E2E ${RUN}` } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [editorId, kycAdminId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [editorId, kycAdminId, clientId] } } });
});

async function currentVersion(): Promise<number> {
  const release = await prisma.frontendRelease.findFirst({ orderBy: { version: "desc" } });
  return release?.version ?? 0;
}

async function publicMenuLabels(): Promise<string[]> {
  const res = await publicConfig(new Request("http://localhost"));
  const body = await res.json();
  return ((body.menus?.[PROBE_MENU] ?? []) as { label: string }[]).map((m) => m.label);
}

const patchProbe = (body: unknown) =>
  patchMenuItem(
    new Request("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: probeId }) }
  );

describe("séparation des pouvoirs", () => {
  it("refuse l'édition à un administrateur d'un autre rôle", async () => {
    as(kycAdminId);
    const res = await createMenuItem(json({ menu: PROBE_MENU, label: `E2E ${RUN} refus`, href: "/faq" }));
    expect(res.status).toBe(403);
  });

  it("refuse l'édition à un utilisateur non administrateur", async () => {
    as(clientId);
    const res = await createMenuItem(json({ menu: PROBE_MENU, label: `E2E ${RUN} refus`, href: "/faq" }));
    expect(res.status).toBe(403);
  });

  it("refuse l'édition à un visiteur anonyme", async () => {
    as(null);
    const res = await createMenuItem(json({ menu: PROBE_MENU, label: `E2E ${RUN} refus`, href: "/faq" }));
    expect(res.status).toBe(401);
  });
});

describe("le brouillon ne fuit pas", () => {
  it("une entrée créée reste invisible du public jusqu'à la publication", async () => {
    as(editorId);

    const created = await createMenuItem(json({ menu: PROBE_MENU, label: PROBE_LABEL, href: "/faq" }));
    expect(created.status).toBe(201);
    probeId = (await created.json()).id;

    // Créée en brouillon : absente de l'API publique, même sans republier.
    expect(await publicMenuLabels()).not.toContain(PROBE_LABEL);

    // Passée en publié : TOUJOURS absente — le statut ne suffit pas, il faut publier une version.
    // C'est la distinction que la console matérialise par sa barre « brouillon en attente ».
    await patchProbe({ status: "publie" });
    expect(await publicMenuLabels()).not.toContain(PROBE_LABEL);

    const before = await currentVersion();
    const released = await publish(json({ note: `Publication e2e ${RUN}` }));
    expect(released.status).toBe(201);
    expect((await released.json()).version).toBe(before + 1);

    expect(await publicMenuLabels()).toContain(PROBE_LABEL);
  });

  it("dépublier une entrée la retire du public à la publication suivante", async () => {
    as(editorId);
    await patchProbe({ status: "desactive" });
    expect(await publicMenuLabels()).toContain(PROBE_LABEL);

    await publish(json({ note: `Retrait e2e ${RUN}` }));
    expect(await publicMenuLabels()).not.toContain(PROBE_LABEL);
  });
});

describe("validateur d'ETag", () => {
  it("répond 304 sans corps quand le client détient déjà la version servie", async () => {
    const version = await currentVersion();
    const res = await publicConfig(
      new Request("http://localhost", { headers: { "If-None-Match": frontendEtag(version) } })
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("répond 200 quand le validateur présenté est périmé", async () => {
    const res = await publicConfig(
      new Request("http://localhost", { headers: { "If-None-Match": frontendEtag(0) } })
    );
    expect(res.status).toBe(200);
  });
});

describe("retour arrière", () => {
  // L'historique s'allonge, il ne se réécrit pas : c'est ce qui rend le geste lui-même lisible
  // dans la liste, au lieu de le faire disparaître avec ce qu'il corrige.
  it("republie un instantané ancien sous un nouveau numéro, sans effacer la version corrigée", async () => {
    as(editorId);

    // La version où l'entrée est visible : l'avant-dernière, avant son retrait.
    const target = await prisma.frontendRelease.findFirst({
      where: { note: `Publication e2e ${RUN}` },
      orderBy: { version: "desc" },
    });
    expect(target).not.toBeNull();

    const before = await currentVersion();
    const res = await rollback(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ version: String(target!.version) }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.version).toBe(before + 1);
    expect(body.rolledBackFromVersion).toBe(target!.version);

    // Le contenu repris est bien celui de la version choisie…
    expect(await publicMenuLabels()).toContain(PROBE_LABEL);

    // …et la version corrigée reste consultable.
    as(editorId);
    const list = await listReleases();
    const versions = (await list.json()).releases.map((r: { version: number }) => r.version);
    expect(versions).toContain(before);
    expect(versions).toContain(target!.version);
  });
});

describe("garde-fou des liens de menu", () => {
  // Le pied de page a porté quatre liens morts (« Carrières », « Presse », « Blog AfroTech »,
  // « Événements Dakar ») jusqu'au 2026-09-09, retirés à la main. Rendre les menus éditables
  // sans cette garde rouvrirait la porte, cette fois sans déploiement pour s'en apercevoir.
  it("refuse une destination qui ne correspond à aucune page réelle", async () => {
    as(editorId);
    const res = await createMenuItem(
      json({ menu: "footer_apropos", label: `E2E ${RUN} Carrières`, href: "/carrieres" })
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("unlinkable_href");
  });

  it("accepte une destination réellement servie", async () => {
    as(editorId);
    const res = await createMenuItem(json({ menu: "footer_apropos", label: `E2E ${RUN} FAQ`, href: "/faq" }));
    expect(res.status).toBe(201);
  });

  it("refuse un menu que le code ne connaît pas", async () => {
    as(editorId);
    const res = await createMenuItem(json({ menu: "footer_inconnu", label: `E2E ${RUN} X`, href: "/faq" }));
    expect(res.status).toBe(404);
  });
});

describe("journal d'audit", () => {
  // Chaque geste d'édition doit être attribuable : la console modifie ce que lisent les
  // visiteurs, et « qui a écrit ça ? » doit avoir une réponse.
  it("trace les gestes de l'éditeur", async () => {
    const entries = await prisma.adminAuditLog.findMany({ where: { adminId: editorId } });
    const actions = new Set(entries.map((e) => e.action));
    expect(actions).toContain("frontend_menu_create");
    expect(actions).toContain("frontend_publish");
    expect(actions).toContain("frontend_rollback");
    expect(entries.every((e) => e.justification.trim().length > 0)).toBe(true);
  });
});
