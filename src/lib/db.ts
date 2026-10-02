import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function createClient(): PrismaClient {
  const client = new PrismaClient();
  // Garde-fou des TESTS uniquement (2026-10-01) — voir assertScopedFilter.
  if (process.env.VITEST) client.$use(refuseUnscopedBulkWrites);
  return client;
}

/**
 * Pendant les tests, refuse un `deleteMany` / `updateMany` dont le filtre est vide ou contient
 * une valeur `undefined`.
 *
 * Prisma IGNORE une clé `undefined` : `deleteMany({ where: { missionId } })` avec un `missionId`
 * jamais affecté (son `beforeAll` a échoué) devient `deleteMany({})` — toute la table. C'est ce
 * qui a vidé missions, contrats, candidatures et messages de la base de développement le
 * 2026-10-01 : un `beforeAll` en échec sous charge, puis un `afterAll` qui nettoyait « sa »
 * mission. Plutôt que de corriger une à une les ~140 opérations de nettoyage des tests, la règle
 * est posée ici : une écriture de masse doit toujours dire ce qu'elle vise.
 *
 * Inactif hors tests : le code applicatif n'est pas concerné, et la production ne paie rien.
 */
// Déclaration de FONCTION (hissée) et non `const` : `createClient()` s'exécute à l'import du
// module, avant que les lignes suivantes ne soient évaluées.
async function refuseUnscopedBulkWrites(
  params: Prisma.MiddlewareParams,
  next: (params: Prisma.MiddlewareParams) => Promise<unknown>
) {
  if (params.action === "deleteMany" || params.action === "updateMany") {
    assertScopedFilter(params.model ?? "?", params.action, params.args?.where);
  }
  return next(params);
}

export function assertScopedFilter(model: string, action: string, where: unknown): void {
  const motif = unscopedReason(where);
  if (motif) {
    throw new Error(
      `[garde-fou tests] ${model}.${action} refusé : ${motif}. Un filtre vide ou undefined viserait toute la table.`
    );
  }
}

function unscopedReason(where: unknown, path = "where"): string | null {
  if (where === undefined || where === null) return `${path} absent`;
  if (typeof where !== "object") return null;
  if (Array.isArray(where)) {
    for (let i = 0; i < where.length; i++) {
      if (where[i] === undefined) return `${path}[${i}] vaut undefined`;
      const r = unscopedReason(where[i], `${path}[${i}]`);
      if (r && !r.endsWith("absent")) return r;
    }
    return null;
  }
  const entries = Object.entries(where as Record<string, unknown>);
  if (path === "where" && entries.length === 0) return "where vide";
  for (const [key, value] of entries) {
    if (value === undefined) return `${path}.${key} vaut undefined`;
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      const r = unscopedReason(value, `${path}.${key}`);
      if (r && !r.endsWith("absent")) return r;
    }
  }
  return null;
}
