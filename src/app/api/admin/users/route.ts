import { NextResponse } from "next/server";
import type { KycStatus, Prisma, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAnyAdminRole } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

const KYC: KycStatus[] = ["en_attente", "verifie", "rejete"];
const STATUS: UserStatus[] = ["active", "suspended", "banned"];

/**
 * Liste des comptes — rubrique « Utilisateurs » de flexwork_job.
 *
 * Là-bas, `GET /api/users` n'a aucune garde et renvoie `prisma.user.findMany()` brut, hachage
 * du mot de passe compris. Ici : trois rôles seulement (la Modération qui suspend, le KYC qui
 * retrouve un compte, le superviseur qui lit), et un `select` explicite — un champ ajouté au
 * modèle User demain ne sortira pas par cette route sans qu'on l'y ait écrit.
 */
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["moderation", "kyc", "superviseur"]);
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const kyc = url.searchParams.get("kyc");
  const status = url.searchParams.get("status");

  const where: Prisma.UserWhereInput = {
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { tel: { contains: q } },
            { firstname: { contains: q, mode: "insensitive" } },
            { lastname: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(KYC.includes(kyc as KycStatus) ? { kycStatus: kyc as KycStatus } : {}),
    ...(STATUS.includes(status as UserStatus) ? { status: status as UserStatus } : {}),
  };

  const [items, total, byStatus, byKyc] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        tel: true,
        firstname: true,
        lastname: true,
        role: true,
        status: true,
        kycStatus: true,
        isAdmin: true,
        adminRole: true,
        country: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.groupBy({ by: ["kycStatus"], _count: { _all: true } }),
  ]);

  return NextResponse.json({
    items,
    total,
    counts: {
      status: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      kyc: Object.fromEntries(byKyc.map((r) => [r.kycStatus, r._count._all])),
    },
  });
}
