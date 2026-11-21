/**
 * Temps réel (2026-10-01) — signal publié en base, relayé par SSE au seul utilisateur concerné.
 */
import { describe, expect, it, vi, afterAll } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as stream } from "@/app/api/realtime/stream/route";
import { prisma } from "@/lib/db";
import { notifyUser } from "@/lib/notify";
import { localSubscriberCount, publishToUser, subscribe } from "@/lib/realtime/hub";

const RUN = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) throw new Error("délai dépassé");
    await wait(20);
  }
}

const createdUsers: string[] = [];
afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
});

describe("bus temps réel", () => {
  it("un signal publié n'atteint que l'utilisateur visé", async () => {
    const forA: string[] = [];
    const forB: string[] = [];
    const offA = await subscribe(`a-${RUN}`, (e) => forA.push(e.kind));
    const offB = await subscribe(`b-${RUN}`, (e) => forB.push(e.kind));
    await publishToUser(`a-${RUN}`, "message_received");
    await until(() => (forA.length ? true : undefined));
    expect(forA).toEqual(["message_received"]);
    await wait(100);
    expect(forB).toEqual([]);
    offA();
    offB();
  });

  it("une notification publie le signal de son destinataire", async () => {
    const user = await prisma.user.create({
      data: { email: `e2e-rt-${RUN}@flexwork.test`, tel: `+229${RUN}61`, role: "client", status: "active", country: "BJ" },
    });
    createdUsers.push(user.id);
    const got: string[] = [];
    const off = await subscribe(user.id, (e) => got.push(e.kind));
    await notifyUser({ userId: user.id, type: "contract_locked", message: "Mission engagée", email: false });
    await until(() => (got.length ? true : undefined));
    expect(got).toEqual(["contract_locked"]);
    off();
  });
});

describe("GET /api/realtime/stream", () => {
  it("sans session : 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await stream(new Request("http://localhost/api/realtime/stream"))).status).toBe(401);
  });

  it("annonce `ready`, relaie les signaux, se désabonne à la fermeture", async () => {
    const userId = `sse-${RUN}`;
    mockAuth.mockResolvedValue({ user: { id: userId } });
    const abort = new AbortController();
    const before = localSubscriberCount();
    const res = await stream(new Request("http://localhost/api/realtime/stream", { signal: abort.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    })();

    await until(() => (text.includes("event: ready") ? true : undefined));
    expect(localSubscriberCount()).toBe(before + 1);
    await publishToUser(userId, "deliverable_validated");
    await until(() => (text.includes("event: refresh") ? true : undefined));
    expect(text).toContain(`data: {"kind":"deliverable_validated"}`);

    abort.abort();
    await pump;
    expect(localSubscriberCount()).toBe(before);
  });
});
