import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAnyAdminRole } from "@/lib/adminGuard";

// File de modération (US-306).
//
// Jusqu'ici la modération n'avait AUCUNE source de lecture : seul `POST
// /api/admin/declarations/[id]/remove` existait, ce qui obligeait l'administrateur à saisir
// de mémoire l'identifiant d'une déclaration qu'on venait de lui signaler — un pouvoir sans
// registre, donc inutilisable en pratique. Cette route rend le pouvoir exerçable : elle liste
// ce qui existe, avec les retraits déjà opérés pour éviter les doublons.
//
// Le superviseur y accède en lecture (§13) : il voit ce qui a été retiré et pourquoi, il ne
// retire rien — la garde d'écriture reste `requireAdminRole("moderation")` sur la route de
// retrait.
export async function GET() {
  const guard = await requireAnyAdminRole(["moderation", "superviseur"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const [declarations, active, removed] = await Promise.all([
    prisma.professionalDeclaration.findMany({
      orderBy: { declaredAt: "desc" },
      take: 100,
      include: {
        profile: { select: { user: { select: { id: true, email: true, role: true } } } },
        documents: { select: { id: true } },
      },
    }),
    prisma.professionalDeclaration.count({ where: { removedAt: null } }),
    prisma.professionalDeclaration.count({ where: { removedAt: { not: null } } }),
  ]);

  return NextResponse.json({
    counts: { active, removed },
    items: declarations.map((d) => ({
      id: d.id,
      declarationType: d.declarationType,
      label: d.label,
      insurerName: d.insurerName,
      policyNumber: d.policyNumber,
      coverageCeiling: d.coverageCeiling,
      validUntil: d.validUntil,
      declaredAt: d.declaredAt,
      removedAt: d.removedAt,
      removedReason: d.removedReason,
      documentCount: d.documents.length,
      // Le hash est la seule preuve d'intégrité de la chaîne append-only : on l'affiche
      // tronqué pour qu'un retrait reste rattachable à une déclaration précise.
      currentHash: d.currentHash,
      user: d.profile.user,
    })),
  });
}
