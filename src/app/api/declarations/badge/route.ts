import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recordVerificationHistory } from "@/lib/verification-history";
import { findPrimaryProfile } from "@/lib/profile-query";

// Demande du badge « Vérifié » (2026-09-23).
//
// Cette route N'EXISTAIT PAS. Le bouton de /declarations l'appelait déjà : chaque clic
// repartait en 404, et l'écran affichait « Échec — complétez toutes les sections », un
// message qui accusait le prestataire d'un tort qui n'était pas le sien.
//
// Ce que la route vérifie vraiment, et pourquoi :
//
//   - un profil existe (le badge est porté par le profil, pas par le compte : un prestataire
//     multi-profils peut être vérifié sur son métier principal sans l'être sur un autre) ;
//   - au moins un DIPLÔME D'ÉTAT est déclaré. Le schéma le dit : « le diplôme d'État est le
//     pivot du badge ». Un diplôme purement déclaratif ne vaut que ce que son auteur en dit,
//     et ne peut donc pas ouvrir seul une vérification ;
//   - la demande n'est pas déjà en cours d'instruction, ni déjà accordée.
//
// La route n'ACCORDE rien : elle enregistre une demande que l'Admin KYC instruira. Une
// plateforme qui s'auto-décernerait ses propres badges ne vérifierait rien.

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const profile = await findPrimaryProfile(userId);
  if (!profile) {
    return NextResponse.json(
      { error: "profile_required", message: "Complétez d'abord votre domaine d'intervention." },
      { status: 409 },
    );
  }

  if (profile.badgeStatus === "en_attente") {
    return NextResponse.json(
      { error: "badge_already_requested", message: "Votre demande est déjà en cours d'instruction." },
      { status: 409 },
    );
  }
  if (profile.badgeStatus === "accorde") {
    return NextResponse.json(
      { error: "badge_already_granted", message: "Votre badge est déjà accordé." },
      { status: 409 },
    );
  }

  // Le diplôme est cherché parmi les déclarations NON RETIRÉES du profil : une déclaration
  // retirée ne peut plus fonder quoi que ce soit.
  const diplomeEtat = await prisma.declaredDiploma.findFirst({
    where: {
      isStateIssued: true,
      declaration: { profileId: profile.id, removedAt: null },
    },
    select: { id: true },
  });
  if (!diplomeEtat) {
    return NextResponse.json(
      {
        error: "state_diploma_required",
        message:
          "Le badge exige au moins un diplôme d'État déclaré. Ajoutez-le dans la section Qualifications, puis renouvelez la demande.",
      },
      { status: 409 },
    );
  }

  const updated = await prisma.profile.update({
    where: { id: profile.id },
    data: { badgeStatus: "en_attente", badgeRequestedAt: new Date(), badgeRefusalReason: null },
    select: { badgeStatus: true, badgeRequestedAt: true },
  });

  // Tracé dans la même chaîne que les déclarations : la demande est un acte, elle se date.
  await recordVerificationHistory({
    subjectType: "declaration",
    subjectId: profile.id,
    event: "badge:requested",
  });

  return NextResponse.json(updated, { status: 201 });
}

/** GET — état du badge, pour que l'écran sache quoi afficher au lieu de deviner. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const profile = await findPrimaryProfile(userId);
  if (!profile) return NextResponse.json({ badgeStatus: "non_demande", eligible: false });

  const diplomeEtat = await prisma.declaredDiploma.count({
    where: { isStateIssued: true, declaration: { profileId: profile.id, removedAt: null } },
  });

  // `eligible` dit à l'écran si le bouton a une chance d'aboutir — plutôt que de laisser
  // l'utilisateur le découvrir par un refus.
  return NextResponse.json({
    // Champs du badge seulement : `findPrimaryProfile` ramène le profil entier (portfolio,
    // CV…), que cet écran n'affiche pas.
    id: profile.id,
    badgeStatus: profile.badgeStatus,
    badgeRequestedAt: profile.badgeRequestedAt,
    badgeDecidedAt: profile.badgeDecidedAt,
    badgeRefusalReason: profile.badgeRefusalReason,
    eligible: diplomeEtat > 0,
  });
}
