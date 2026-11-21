import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
// LECTURE de file d'attente → même garde que les autres files du module (§13 : le superviseur
// lit tout, il ne décide rien). En `requireAdminRole("kyc")`, un superviseur recevait un 403
// que l'écran rendait en « Aucune demande en attente » — soit une affirmation FAUSSE sur
// l'état de la file. Les décisions, elles, restent au seul rôle `kyc`.
import { requireAnyAdminRole } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

// File d'instruction des badges « Vérifié » (2026-09-23).
//
// ── Ce que cette route débloque ─────────────────────────────────────────────────────────
//
// Le badge s'obtenait jusqu'ici en boucle : le prestataire cliquait « Demander le badge », la
// route enregistrait `badgeStatus: "en_attente"`, et PLUS AUCUN code n'écrivait jamais
// `accorde` ni `refuse` — `badgeDecidedAt` et `badgeRefusalReason` n'étaient lus par aucun
// écran, et aucune file admin ne listait les demandes. La demande restait « en attente »
// indéfiniment, et une seconde demande était refusée pour cause de demande en cours. Une
// impasse définitive, présentée comme un état transitoire.
//
// ── Ce que l'Admin voit ─────────────────────────────────────────────────────────────────
//
// Le diplôme d'État déclaré, extrait du contenu scellé de la déclaration : c'est le PIVOT du
// badge (le schéma le dit). Un badge sans diplôme d'État en face ne serait qu'un autocollant.
// La demande ne porte pas sur autre chose : les expériences et références ne sont pas
// réexaminées ici, elles vivent leur propre vie dans /declarations.

export async function GET() {
  const guard = await requireAnyAdminRole(["kyc", "superviseur"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const profiles = await prisma.profile.findMany({
    where: { badgeStatus: "en_attente" },
    orderBy: { badgeRequestedAt: "asc" },
    include: {
      user: { select: { id: true, email: true, tel: true, firstname: true, lastname: true, role: true, kycStatus: true } },
      declarations: {
        where: { removedAt: null },
        include: { diplomas: { where: { isStateIssued: true } } },
      },
    },
  });

  return NextResponse.json({
    items: profiles.map((profile) => ({
      profileId: profile.id,
      userId: profile.user.id,
      label: profile.label,
      mainDomain: profile.mainDomain,
      title: profile.title,
      requestedAt: profile.badgeRequestedAt,
      user: profile.user,
      // Diplômes d'État non retirés, tous confondus : c'est la pièce sur laquelle l'Admin
      // instruit. Vide = demande inéligible (la route de demande l'impose normalement, mais
      // une déclaration peut avoir été retirée depuis).
      stateDiplomas: profile.declarations.flatMap((d) =>
        d.diplomas.map((diploma) => ({
          id: diploma.id,
          name: diploma.qualificationName,
          year: diploma.year,
          institution: diploma.institution,
          specialty: diploma.specialty,
        })),
      ),
    })),
    count: profiles.length,
  });
}
