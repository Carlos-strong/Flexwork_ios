import { describe, expect, it } from "vitest";
import { assertScopedFilter, prisma } from "@/lib/db";

// Garde-fou des tests (src/lib/db.ts) : une écriture de masse dont le filtre est vide ou contient
// `undefined` doit échouer bruyamment, jamais viser toute la table.
describe("garde-fou des écritures de masse en test", () => {
  const ok = (where: unknown) => () => assertScopedFilter("Mission", "deleteMany", where);

  it("refuse un filtre absent, vide ou undefined", () => {
    let missionId: string | undefined;
    expect(ok(undefined)).toThrow(/where absent/);
    expect(ok({})).toThrow(/where vide/);
    expect(ok({ missionId })).toThrow(/where.missionId vaut undefined/);
    expect(ok({ contract: { missionId } })).toThrow(/where.contract.missionId vaut undefined/);
    expect(ok({ id: { in: [undefined] } })).toThrow(/where.id.in\[0\] vaut undefined/);
  });

  it("laisse passer un filtre réel (y compris null, dates, listes)", () => {
    expect(ok({ id: "m1" })).not.toThrow();
    expect(ok({ jalonId: null, missionId: "m1" })).not.toThrow();
    expect(ok({ id: { in: ["a", "b"] } })).not.toThrow();
    expect(ok({ createdAt: { lt: new Date() } })).not.toThrow();
    expect(ok({ OR: [{ id: "a" }, { id: "b" }] })).not.toThrow();
  });

  it("est branché sur le client Prisma des tests : rien n'est supprimé", async () => {
    let missionId: string | undefined;
    await expect(prisma.mission.deleteMany({ where: { missionId } as never })).rejects.toThrow(/garde-fou tests/);
    await expect(prisma.message.deleteMany({ where: { missionId } })).rejects.toThrow(/garde-fou tests/);
    await expect(prisma.mission.updateMany({ where: {}, data: { urgent: false } })).rejects.toThrow(/where vide/);
  });
});
