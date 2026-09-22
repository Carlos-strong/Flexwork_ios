/**
 * Architecture d'administration reprise de flexwork_job — les nouvelles routes, sous séparation
 * des pouvoirs, contre la vraie base (2026-09-21).
 *
 * Chaque bloc vérifie deux choses : que le rôle titulaire obtient ce qu'il doit, et que les
 * autres rôles ne l'obtiennent pas — un pouvoir se prouve autant par ses refus que par ses
 * succès.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import type { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { POST as publicReport } from "@/app/api/reports/route";
import { GET as listReports } from "@/app/api/admin/reports/route";
import { POST as decideReport } from "@/app/api/admin/reports/[id]/decision/route";
import { GET as listUsers } from "@/app/api/admin/users/route";
import { POST as setUserStatus } from "@/app/api/admin/users/[id]/status/route";
import { GET as dashboard } from "@/app/api/admin/dashboard/route";
import { GET as roles } from "@/app/api/admin/roles/route";
import { GET as exportCsv } from "@/app/api/admin/reporting/[dataset]/route";
import { GET as queues } from "@/app/api/admin/queues/route";
import { GET as contracts } from "@/app/api/admin/contracts/route";
import { POST as garantDecision } from "@/app/api/admin/garants/[id]/decision/route";

const RUN = Date.now();
const admins: Partial<Record<AdminRole, string>> = {};
let citizenId = "";
let otherAdminId = "";
const createdReports: string[] = [];

const as = (userId: string | null) => mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (url = "http://localhost") => new Request(url);

beforeAll(async () => {
  const roleList: AdminRole[] = ["kyc", "moderation", "mediation", "superviseur", "frontend"];
  for (const [i, role] of roleList.entries()) {
    const u = await prisma.user.create({
      data: { email: `e2e-archi-${role}-${RUN}@flexwork.test`, tel: `+229${RUN}8${i}`, role: "client", isAdmin: true, adminRole: role, country: "BJ" },
    });
    admins[role] = u.id;
  }
  otherAdminId = admins.kyc!;
  const citizen = await prisma.user.create({
    data: { email: `e2e-archi-citoyen-${RUN}@flexwork.test`, tel: `+229${RUN}90`, role: "client", country: "BJ" },
  });
  citizenId = citizen.id;
});

afterAll(async () => {
  const ids = [...Object.values(admins), citizenId].filter(Boolean) as string[];
  await prisma.report.deleteMany({ where: { OR: [{ id: { in: createdReports } }, { reporterId: { in: ids } }] } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("signalements — la route que /signalement attendait", () => {
  it("accepte un signalement anonyme et le met en file", async () => {
    as(null);
    const res = await publicReport(post({ targetType: "profile", targetId: citizenId, reason: `Profil suspect ${RUN} — photos volées` }, { "x-forwarded-for": `10.9.${RUN % 250}.1` }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    createdReports.push(id);
    const stored = await prisma.report.findUnique({ where: { id } });
    expect(stored?.status).toBe("ouvert");
    expect(stored?.reporterId).toBeNull();
    // L'adresse IP n'est jamais stockée, seulement son empreinte.
    expect(stored?.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuse un motif trop court", async () => {
    as(null);
    const res = await publicReport(post({ targetType: "mission", reason: "court" }));
    expect(res.status).toBe(400);
  });

  it("limite la cadence d'une même source anonyme", async () => {
    as(null);
    const ip = { "x-forwarded-for": `10.8.${RUN % 250}.7` };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await publicReport(post({ targetType: "review", reason: `Avis injurieux numéro ${i} ${RUN}` }, ip));
      statuses.push(res.status);
      if (res.status === 201) createdReports.push((await res.json()).id);
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("n'est lisible que par la modération et le superviseur", async () => {
    for (const role of ["kyc", "mediation", "frontend"] as AdminRole[]) {
      as(admins[role]!);
      expect((await listReports(get())).status, role).toBe(403);
    }
    as(admins.superviseur!);
    expect((await listReports(get())).status).toBe(200);
  });

  it("ne se décide que par la modération, motif obligatoire, une seule fois", async () => {
    const id = createdReports[0];
    const ctx = { params: Promise.resolve({ id }) };

    as(admins.superviseur!);
    expect((await decideReport(post({ status: "retenu", note: "Le superviseur ne décide pas." }), ctx)).status).toBe(403);

    as(admins.moderation!);
    expect((await decideReport(post({ status: "retenu", note: "court" }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await decideReport(post({ status: "retenu", note: "Photos issues d'une banque d'images." }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await decideReport(post({ status: "classe", note: "Tentative de réécriture." }), { params: Promise.resolve({ id }) })).status).toBe(409);

    const log = await prisma.adminAuditLog.findFirst({ where: { adminId: admins.moderation!, targetId: id } });
    expect(log?.action).toBe("report_upheld");
  });
});

describe("utilisateurs — liste et suspension", () => {
  it("ne renvoie jamais de hachage de mot de passe", async () => {
    as(admins.kyc!);
    const res = await listUsers(get(`http://localhost?q=e2e-archi-citoyen-${RUN}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0])).not.toContain("passwordHash");
  });

  it("est fermée à la médiation et à l'éditeur du site", async () => {
    for (const role of ["mediation", "frontend"] as AdminRole[]) {
      as(admins[role]!);
      expect((await listUsers(get())).status, role).toBe(403);
    }
  });

  it("réserve la suspension à la modération", async () => {
    for (const role of ["kyc", "superviseur", "mediation"] as AdminRole[]) {
      as(admins[role]!);
      const res = await setUserStatus(post({ status: "suspended", justification: "Tentative hors pouvoir." }), { params: Promise.resolve({ id: citizenId }) });
      expect(res.status, role).toBe(403);
    }
  });

  it("suspend avec motif, trace le geste, puis réactive", async () => {
    as(admins.moderation!);
    const ctx = () => ({ params: Promise.resolve({ id: citizenId }) });
    expect((await setUserStatus(post({ status: "suspended", justification: "Fausse déclaration d'assurance, signalement retenu." }), ctx())).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: citizenId } }))?.status).toBe("suspended");
    expect((await setUserStatus(post({ status: "suspended", justification: "Deuxième suspension identique." }), ctx())).status).toBe(409);
    expect((await setUserStatus(post({ status: "active", justification: "Recours accueilli après vérification." }), ctx())).status).toBe(200);

    const actions = (await prisma.adminAuditLog.findMany({ where: { adminId: admins.moderation!, targetId: citizenId } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["user_suspended", "user_reactivated"]));
  });

  it("refuse de suspendre un administrateur", async () => {
    as(admins.moderation!);
    const res = await setUserStatus(post({ status: "suspended", justification: "Un pouvoir contre un autre pouvoir." }), { params: Promise.resolve({ id: otherAdminId }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("cannot_target_admin");
  });
});

describe("dashboard — chaque rôle ne reçoit que ce qu'il peut lire", () => {
  it("n'envoie au KYC ni l'argent ni les signalements", async () => {
    as(admins.kyc!);
    const body = await (await dashboard()).json();
    expect(body.kyc).not.toBeNull();
    expect(body.mediation).toBeNull();
    expect(body.moderation).toBeNull();
    expect(body.supervision).toBeNull();
  });

  it("envoie l'argent à la médiation, pas les dossiers d'identité", async () => {
    as(admins.mediation!);
    const body = await (await dashboard()).json();
    expect(body.mediation).not.toBeNull();
    expect(typeof body.mediation.held).toBe("number");
    expect(body.kyc).toBeNull();
  });

  it("envoie tout au superviseur", async () => {
    as(admins.superviseur!);
    const body = await (await dashboard()).json();
    expect(body.kyc && body.moderation && body.mediation && body.supervision).toBeTruthy();
  });

  it("n'envoie rien à l'éditeur du site", async () => {
    as(admins.frontend!);
    const body = await (await dashboard()).json();
    expect([body.kyc, body.moderation, body.mediation, body.supervision]).toEqual([null, null, null, null]);
  });
});

describe("Back Office — superviseur seul", () => {
  it("Rôles & Accès liste les titulaires, sans rien permettre d'attribuer", async () => {
    as(admins.frontend!);
    expect((await roles()).status).toBe(403);
    as(admins.superviseur!);
    const body = await (await roles()).json();
    const mine = body.admins.find((a: { id: string }) => a.id === admins.moderation);
    expect(mine.adminRole).toBe("moderation");
    expect(mine.actions).toBeGreaterThan(0);
  });

  it("exporte en CSV, neutralise les formules et journalise l'export", async () => {
    // Un signalement dont le motif commence par « = » : ouvert tel quel dans un tableur, il
    // serait exécuté comme une formule.
    as(null);
    const res = await publicReport(post({ targetType: "mission", reason: `=HYPERLINK("http://piege.example","clic") ${RUN}` }, { "x-forwarded-for": `10.7.${RUN % 250}.3` }));
    createdReports.push((await res.json()).id);

    as(admins.mediation!);
    expect((await exportCsv(get(), { params: Promise.resolve({ dataset: "signalements" }) })).status).toBe(403);

    as(admins.superviseur!);
    const csvRes = await exportCsv(get(), { params: Promise.resolve({ dataset: "signalements" }) });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    // Lecture en OCTETS : `Response.text()` retire le BOM au décodage, comme le veut la norme
    // — il faut regarder le fichier tel qu'un tableur le recevra.
    const bytes = new Uint8Array(await csvRes.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain(`'=HYPERLINK(`);
    expect(csv).not.toMatch(/(^|;)=HYPERLINK/m);

    const log = await prisma.adminAuditLog.findFirst({ where: { adminId: admins.superviseur!, action: "report_export" } });
    expect(log?.targetId).toBe("signalements");
  });

  it("refuse un jeu de données inconnu", async () => {
    as(admins.superviseur!);
    expect((await exportCsv(get(), { params: Promise.resolve({ dataset: "utilisateurs-complets" }) })).status).toBe(404);
  });

  it("mesure l'arriéré des cinq tâches sans rien exécuter", async () => {
    as(admins.mediation!);
    expect((await queues()).status).toBe(403);
    as(admins.superviseur!);
    const body = await (await queues()).json();
    expect(body.tasks.map((t: { key: string }) => t.key)).toEqual([
      "contract-expirations",
      "devis-expirations",
      "gig-order-expirations",
      "tacit-acceptance",
      "residual-refunds",
    ]);
    for (const t of body.tasks) expect(t.due).toBeGreaterThanOrEqual(0);
  });
});

describe("gestes déplacés vers leur rôle titulaire", () => {
  it("la décision sur un garant appartient au KYC, plus au superviseur", async () => {
    as(admins.superviseur!);
    const res = await garantDecision(post({ statutAppel: "confirme" }), { params: Promise.resolve({ id: "garant-inexistant" }) });
    expect(res.status).toBe(403);
  });

  it("les contrats se lisent par la médiation et le superviseur, pas par le KYC", async () => {
    as(admins.kyc!);
    expect((await contracts(get())).status).toBe(403);
    as(admins.mediation!);
    expect((await contracts(get())).status).toBe(200);
  });
});
