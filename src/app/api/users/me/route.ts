import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Identité complète de l'utilisateur connecté. La session JWT ne porte que id/email/role/
// isAdmin (voir src/auth.ts) — `session.user.name` en particulier n'est PAS un nom
// d'affichage : `authorize()` le fixe au numéro de téléphone (`name: user.tel`), un choix
// interne à NextAuth (label du provider credentials) jamais pensé pour être montré tel
// quel. Tout endroit qui a besoin du VRAI nom (ex. nom du signataire d'un contrat
// électronique, src/app/missions/[id]/contract/page.tsx) doit passer par cette route —
// jamais par session.user.name.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstname: true, lastname: true, tel: true, email: true, avatarPath: true, garantRequired: true },
  });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const fullName = [user.firstname, user.lastname].filter(Boolean).join(" ").trim();

  return NextResponse.json({
    firstname: user.firstname,
    lastname: user.lastname,
    // Nom complet à afficher — jamais le téléphone tant qu'un nom déclaré existe ;
    // le téléphone ne sert de dernier recours que si firstname/lastname sont tous deux vides.
    fullName: fullName || user.tel,
    avatarUrl: user.avatarPath ? `/api/users/${userId}/avatar` : null,
    // Exigence de garant activée (ou non) par l'Admin KYC pour CE compte — désactivée par
    // défaut. Les vues prestataire s'y réfèrent au lieu d'annoncer « garant obligatoire »
    // en dur pour toute la filière chantier (2026-09-09).
    garantRequired: user.garantRequired,
  });
}
