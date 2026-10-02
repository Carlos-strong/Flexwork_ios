import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAnyAdminRole } from "@/lib/adminGuard";

// US-103 : file d'attente KYC triée par date de dépôt, pour revue admin.
//
// Deux populations, et la seconde est un RATTRAPAGE (2026-09-24) :
//
//   1. les dossiers déposés et non encore instruits (`en_attente`) — le cas ordinaire ;
//   2. les comptes dont l'identité est DÉJÀ vérifiée mais dont la date de naissance n'a jamais
//      été relevée. Ils sortaient de cette file, et comme c'est ici — et nulle part ailleurs —
//      que l'équipe lit la pièce d'identité, leur âge ne pouvait plus être établi. Tant que la
//      barrière d'âge portait sur la filière choisie à l'activation, ils passaient pour des cas
//      limites ; depuis qu'elle porte sur la catégorie du métier, ils sont bloqués au moment de
//      choisir leur métier, sans aucun recours. Les faire réapparaître ici est ce qui rend la
//      barrière praticable.
export async function GET() {
  const guard = await requireAnyAdminRole(["kyc", "superviseur"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const pendingUsers = await prisma.user.findMany({
    where: {
      OR: [
        { kycStatus: "en_attente" },
        { kycStatus: "verifie", dateNaissance: null, isProvider: true },
      ],
    },
    include: {
      kycDocuments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: pendingUsers.map((u) => ({
      userId: u.id,
      email: u.email,
      tel: u.tel,
      role: u.role,
      // « Garant requis » activé par l'Admin KYC (défaut OFF) — affiché dans les dashboards
      // admin pour activer/désactiver l'exigence de garant par compte (2026-09-09).
      garantRequired: u.garantRequired,
      // UserRole n'a pas de valeur "admin" (prisma/schema.prisma) — un compte admin garde
      // role="client" par défaut, ce qui affichait à tort "Client" pour ces comptes.
      isAdmin: u.isAdmin,
      adminRole: u.adminRole,
      createdAt: u.createdAt,
      // Pourquoi ce dossier est ici. L'écran s'en sert pour ne pas proposer un rejet sur un
      // compte dont l'identité est déjà vérifiée : il n'y a qu'une chose à faire, saisir la date.
      reason: u.kycStatus === "en_attente" ? "dossier_a_instruire" : "date_naissance_manquante",
      documents: u.kycDocuments.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        createdAt: d.createdAt,
      })),
    })),
  });
}
