/**
 * Candidature d'un prestataire NON vérifié (2026-11-09) : elle est enregistrée au lieu d'être
 * perdue, reste modifiable, puis part D'ELLE-MÊME au client à la validation du KYC — le
 * prestataire ne la valide qu'une fois. Par les vraies routes.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { GET as draftsGet } from "@/app/api/proposal-drafts/route";
import { DELETE as draftDelete } from "@/app/api/proposal-drafts/[id]/route";
import { sendPendingApplications } from "@/lib/candidature-submit";
import { closeExpiredAnnonces } from "@/lib/scheduled-tasks";
import { devisDraftFromPayload, proposalDraftFromPayload } from "@/lib/proposal-draft-restore";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const ids = { client: "", provider: "", other: "" };
const missions = { fixed: "", quote: "", closed: "", own: "", closing: "", full: "", attributed: "" };

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const jsonReq = (method: string, body?: unknown) =>
  new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const draftsOf = (providerId: string) => prisma.proposalDraft.findMany({ where: { providerId } });

const PROPOSAL = { montant: 150000, delaiPropose: 10, message: "Disponible dès lundi, portfolio sur demande." };
const DEVIS = {
  lineItems: [{ description: "Maquettes", quantity: 1, unit: "forfait", unitPrice: 200000 }],
  delay: "2 semaines",
  notes: "Date de début souhaitée : 15/12/2026\n\nJe propose de commencer par un atelier de cadrage.",
  tvaRate: 0,
  laborCost: 0,
  financingModeKey: "F2",
};

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, role: string, kycStatus: "verifie" | "en_attente") =>
    prisma.user.create({
      data: { email: `pd-${key}-${RUN}@flexwork.test`, tel: `+229${RUN}${++n}7`, status: "active", country: "BJ", kycStatus, role: role as "client" },
    });
  ids.client = (await mk("client", "client", "verifie")).id;
  ids.provider = (await mk("presta", "expert_digital", "en_attente")).id;
  ids.other = (await mk("autre", "expert_digital", "en_attente")).id;
  const base = { clientId: ids.client, description: "Mission de test.", domaine: "design", budget: 200000, currency: "XOF", delaiJours: 20, mode: "distance" as const };
  missions.fixed = (await prisma.mission.create({ data: { ...base, titre: `PD fixe ${RUN}`, status: "publiee" } })).id;
  missions.quote = (await prisma.mission.create({ data: { ...base, titre: `PD devis ${RUN}`, status: "publiee", budgetType: "QUOTE" } })).id;
  missions.closed = (await prisma.mission.create({ data: { ...base, titre: `PD fermée ${RUN}`, status: "cloturee" } })).id;
  missions.own = (await prisma.mission.create({ data: { ...base, clientId: ids.provider, titre: `PD sienne ${RUN}`, status: "publiee" } })).id;
});

afterAll(async () => {
  const all = Object.values(missions).filter(Boolean);
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: all } } });
  await prisma.proposalDraft.deleteMany({ where: { missionId: { in: all } } });
  await prisma.devisRevision.deleteMany({ where: { proposal: { missionId: { in: all } } } });
  await prisma.missionProposal.deleteMany({ where: { missionId: { in: all } } });
  await prisma.mission.deleteMany({ where: { id: { in: all } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

describe("candidature d'un prestataire non vérifié → brouillon", () => {
  it("prix fixe : 403 kyc_not_verified, mais la candidature est enregistrée telle quelle", async () => {
    authAs(ids.provider);
    const res = await proposalPost(jsonReq("POST", PROPOSAL), at(missions.fixed));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "kyc_not_verified", draftSaved: true });
    const [draft] = await draftsOf(ids.provider);
    expect(draft).toMatchObject({ missionId: missions.fixed, kind: "proposal", payload: PROPOSAL });
    // Aucune candidature n'existe pour le client.
    expect(await prisma.missionProposal.count({ where: { missionId: missions.fixed } })).toBe(0);
  });

  it("renvoyer la candidature met à jour le même brouillon (un par mission)", async () => {
    authAs(ids.provider);
    await proposalPost(jsonReq("POST", { ...PROPOSAL, montant: 140000 }), at(missions.fixed));
    const drafts = (await draftsOf(ids.provider)).filter((d) => d.missionId === missions.fixed);
    expect(drafts).toHaveLength(1);
    expect((drafts[0].payload as { montant: number }).montant).toBe(140000);
  });

  it("devis : enregistré de même, sur une mission sur devis", async () => {
    authAs(ids.provider);
    const res = await devisPost(jsonReq("POST", DEVIS), at(missions.quote));
    expect(res.status).toBe(403);
    expect((await res.json()).draftSaved).toBe(true);
    expect((await draftsOf(ids.provider)).find((d) => d.missionId === missions.quote)).toMatchObject({ kind: "devis" });
  });

  it("rien n'est enregistré pour une candidature invalide, une mission fermée ou sa propre mission", async () => {
    authAs(ids.other);
    for (const [body, missionId] of [
      [{ montant: -5 }, missions.fixed],
      [PROPOSAL, missions.closed],
    ] as const) {
      const res = await proposalPost(jsonReq("POST", body), at(missionId));
      expect(res.status).toBe(403);
      expect((await res.json()).draftSaved).toBe(false);
    }
    authAs(ids.provider);
    const own = await proposalPost(jsonReq("POST", PROPOSAL), at(missions.own));
    expect((await own.json()).draftSaved).toBe(false);
    expect(await draftsOf(ids.other)).toHaveLength(0);
    expect((await draftsOf(ids.provider)).some((d) => d.missionId === missions.own)).toBe(false);
  });

  it("GET /api/proposal-drafts : la liste à envoyer, avec l'état du KYC ; un autre ne peut pas supprimer", async () => {
    authAs(ids.provider);
    const body = await (await draftsGet(jsonReq("GET"))).json();
    expect(body.kycVerified).toBe(false);
    expect(body.items).toHaveLength(2);
    expect(body.items.find((i: { kind: string }) => i.kind === "devis")).toMatchObject({ endpoint: `/api/missions/${missions.quote}/devis`, missionOpen: true });
    authAs(ids.other);
    const del = await draftDelete(jsonReq("DELETE"), at(body.items[0].id));
    expect(del.status).toBe(404);
  });

  it("KYC validé : les candidatures partent d'elles-mêmes, sans nouvelle validation", async () => {
    // Une candidature sur une mission fermée entre-temps ne peut pas partir.
    const closing = await prisma.mission.create({
      data: { clientId: ids.client, titre: `PD fermée ensuite ${RUN}`, description: "x", domaine: "design", budget: 1000, currency: "XOF", delaiJours: 5, mode: "distance", status: "publiee" },
    });
    missions.closing = closing.id;
    authAs(ids.provider);
    await proposalPost(jsonReq("POST", PROPOSAL), at(closing.id));
    await prisma.mission.update({ where: { id: closing.id }, data: { status: "cloturee" } });

    await prisma.user.update({ where: { id: ids.provider }, data: { kycStatus: "verifie" } });
    expect(await sendPendingApplications(ids.provider)).toEqual({ sent: 2, failed: 1 });

    // Les deux candidatures valides sont chez le client, telles que modifiées en dernier.
    const sent = await prisma.missionProposal.findMany({ where: { providerId: ids.provider } });
    expect(sent.map((p) => p.missionId).sort()).toEqual([missions.fixed, missions.quote].sort());
    expect(sent.find((p) => p.missionId === missions.fixed)).toMatchObject({ montant: 140000, status: "envoyee" });
    // Le client en est notifié, comme pour un envoi manuel.
    expect(await prisma.missionNotification.count({ where: { userId: ids.client, missionId: missions.fixed, type: "candidature_recue" } })).toBe(1);

    // Celle qui n'a pas pu partir — mission fermée, rien à corriger — est retirée (2026-11-10),
    // et le prestataire en est prévenu sans être invité à « la corriger ».
    expect(await draftsOf(ids.provider)).toHaveLength(0);
    const note = await prisma.missionNotification.findFirst({ where: { userId: ids.provider, missionId: closing.id, type: "candidature_envoi_echoue" } });
    expect(note?.message).toContain("n'a pas pu être envoyée : la mission n'est plus ouverte aux candidatures. Elle a été retirée");
    expect(note?.message).not.toContain("Corrigez");

    // Un second passage ne renvoie rien en double.
    expect(await sendPendingApplications(ids.provider)).toEqual({ sent: 0, failed: 0 });
    expect(await prisma.missionProposal.count({ where: { providerId: ids.provider } })).toBe(2);
  });
});

describe("brouillon serveur → formulaire", () => {
  it("prix fixe : montant, délai, message ; au temps, le tarif saisi", () => {
    expect(proposalDraftFromPayload(PROPOSAL)).toEqual({ montant: 150000, delaiPropose: 10, message: PROPOSAL.message, financingModeKey: undefined });
    expect(proposalDraftFromPayload({ montant: 80000, unitRate: 8000 }).montant).toBe(8000);
  });

  it("devis : la date de début est retirée des notes et rendue à son champ", () => {
    const d = devisDraftFromPayload(DEVIS);
    expect(d.dateDebut).toBe("2026-12-15");
    expect(d.notes).toBe("Je propose de commencer par un atelier de cadrage.");
    expect(d.lineItems).toEqual([{ description: "Maquettes", quantity: 1, unit: "forfait", unitPrice: 200000, echeance: undefined }]);
    expect(devisDraftFromPayload({ ...DEVIS, notes: "Sans date." })).toMatchObject({ dateDebut: undefined, notes: "Sans date." });
  });
});

describe("annonce : places et clôture (2026-11-10)", () => {
  it("places pourvues : l'annonce reste ouverte, la candidature est enregistrée en attente", async () => {
    const full = await prisma.mission.create({
      data: { clientId: ids.client, titre: `PD complète ${RUN}`, description: "x", domaine: "design", budget: 1000, currency: "XOF", delaiJours: 5, mode: "distance", status: "publiee", maxCandidatures: 1 },
    });
    missions.full = full.id;
    await prisma.missionProposal.create({ data: { missionId: full.id, providerId: ids.provider, montant: 900, status: "envoyee" } });
    authAs(ids.other); // KYC en attente
    const res = await proposalPost(jsonReq("POST", PROPOSAL), at(full.id));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "kyc_not_verified", draftSaved: true });
    expect((await draftsOf(ids.other)).filter((d) => d.missionId === full.id)).toHaveLength(1);
  });

  it("annonce close à l'échéance : les brouillons restants sont retirés et leurs auteurs prévenus", async () => {
    const m = await prisma.mission.create({
      data: { clientId: ids.client, titre: `PD échue ${RUN}`, description: "x", domaine: "design", budget: 1000, currency: "XOF", delaiJours: 5, mode: "distance", status: "publiee" },
    });
    missions.attributed = m.id;
    authAs(ids.other);
    await proposalPost(jsonReq("POST", PROPOSAL), at(m.id));
    expect((await draftsOf(ids.other)).filter((d) => d.missionId === m.id)).toHaveLength(1);

    await prisma.mission.update({ where: { id: m.id }, data: { dateExpiration: new Date(Date.now() - 60_000) } });
    await closeExpiredAnnonces();

    expect((await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("annonce_close");
    expect((await draftsOf(ids.other)).filter((d) => d.missionId === m.id)).toHaveLength(0);
    const note = await prisma.missionNotification.findFirst({ where: { userId: ids.other, missionId: m.id } });
    expect(note?.message).toContain("période de candidature");
  });
});
