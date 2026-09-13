import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";
import { CHANTIER_ROLES } from "@/lib/age-gate";

// Comptes de filière chantier (artisan, manœuvre, expert BTP) — TOUS statuts KYC confondus —
// pour piloter « garant requis » compte par compte (User.garantRequired, défaut OFF).
//
// Pourquoi une route distincte de /api/admin/kyc/queue : la file KYC ne liste que les
// dossiers `kycStatus = "en_attente"`, alors que candidater exige un KYC *vérifié*
// (requireVerifiedKyc en tête de POST /api/missions/[id]/proposals et .../devis). Les
// comptes réellement concernés par l'exigence de garant sont donc, par construction, absents
// de la file : le drapeau devenait inatteignable dès le dossier validé. Cette route expose
// la population pertinente, sans filtre de statut (2026-09-09).
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const users = await prisma.user.findMany({
    where: { role: { in: [...CHANTIER_ROLES] } },
    select: {
      id: true,
      email: true,
      tel: true,
      role: true,
      kycStatus: true,
      garantRequired: true,
      garantRequiredSetAt: true,
      garantRequiredSetById: true,
    },
    // Exigences actives en tête : ce sont elles qui bloquent des candidatures.
    orderBy: [{ garantRequired: "desc" }, { email: "asc" }],
  });

  // garantRequiredSetById n'a pas de relation Prisma (simple identifiant d'admin, comme
  // AdminAuditLog.adminId côté lecture) — on résout les emails en une seule requête pour
  // afficher « activé par … », sinon la trace resterait écrite mais jamais lue.
  const setterIds = [...new Set(users.map((u) => u.garantRequiredSetById).filter((v): v is string => !!v))];
  const setters = setterIds.length
    ? await prisma.user.findMany({ where: { id: { in: setterIds } }, select: { id: true, email: true } })
    : [];
  const setterEmail = new Map(setters.map((s) => [s.id, s.email]));

  return NextResponse.json({
    items: users.map((u) => ({
      userId: u.id,
      email: u.email,
      tel: u.tel,
      role: u.role,
      kycStatus: u.kycStatus,
      garantRequired: u.garantRequired,
      garantRequiredSetAt: u.garantRequiredSetAt,
      garantRequiredSetByEmail: u.garantRequiredSetById ? setterEmail.get(u.garantRequiredSetById) ?? null : null,
    })),
  });
}
