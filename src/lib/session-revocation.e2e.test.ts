import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isSessionRevoked, newSessionId, revokeSession } from "@/lib/session-revocation";

// Déconnexion réelle (2026-11-09) : la session est révoquée en base, un cookie réécrit après
// coup ne rouvre rien.
const sids: string[] = [];
const sid = () => {
  const s = `test-${newSessionId()}`;
  sids.push(s);
  return s;
};

afterAll(async () => {
  await prisma.revokedSession.deleteMany({ where: { sid: { in: sids } } });
});

describe("révocation de session", () => {
  it("révoque la session du token, et seulement elle", async () => {
    const closed = sid();
    const other = sid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(await revokeSession({ sid: closed, id: "u1", exp })).toBe(true);
    expect(await isSessionRevoked(closed)).toBe(true);
    expect(await isSessionRevoked(other)).toBe(false);
    const row = await prisma.revokedSession.findUnique({ where: { sid: closed } });
    expect(row?.userId).toBe("u1");
    expect(row?.expiresAt.getTime()).toBe(exp * 1000);
  });

  it("est idempotente : une double déconnexion ne lève pas d'erreur", async () => {
    const s = sid();
    await revokeSession({ sid: s, id: "u1" });
    await expect(revokeSession({ sid: s, id: "u1" })).resolves.toBe(true);
    expect(await prisma.revokedSession.count({ where: { sid: s } })).toBe(1);
  });

  it("sans `exp`, la révocation dure au moins la vie maximale d'une session (30 jours)", async () => {
    const s = sid();
    const now = new Date();
    await revokeSession({ sid: s, sub: "u2" }, now);
    const row = await prisma.revokedSession.findUnique({ where: { sid: s } });
    expect(row?.userId).toBe("u2");
    expect(row!.expiresAt.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("un token sans identifiant de session n'est pas révocable (rien n'est écrit)", async () => {
    expect(await revokeSession({ id: "u1" })).toBe(false);
    expect(await revokeSession(null)).toBe(false);
  });

  it("purge les révocations expirées à chaque déconnexion", async () => {
    const expired = sid();
    await prisma.revokedSession.create({
      data: { sid: expired, userId: "u1", expiresAt: new Date(Date.now() - 1000) },
    });
    await revokeSession({ sid: sid(), id: "u1" });
    expect(await isSessionRevoked(expired)).toBe(false);
  });
});
