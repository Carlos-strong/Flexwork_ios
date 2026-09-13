import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// US-304 (Phase 3) : profil affiché en trois blocs strictement séparés — « Vérifié par
// Flexwork » (identité uniquement), « Déclaré par le prestataire (non vérifié) »,
// « Activité sur la plateforme » (faits d'usage constatés, pas des déclarations).
//
// Ouverte aux VISITEURS (2026-09-09), mais pour les seuls profils déjà listés publiquement —
// mêmes critères que /api/search/prestataires et la vitrine d'accueil (identité vérifiée,
// rôle prestataire, au moins un profil). Sans ça la chaîne d'entrée du site s'arrêtait net :
// accueil → carte « Talents d'Afrique » → /profil/[id] → 401 et page vide. Un profil non
// listé (client, compte non vérifié, sans profil) reste réservé aux connectés, et un
// visiteur reçoit le même 401 qu'il existe ou non — sinon la route devient un oracle
// permettant d'énumérer les identifiants de comptes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const isVisitor = !session?.user;
  const { id: userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profiles: {
        include: { declarations: { where: { removedAt: null }, include: { documents: true }, orderBy: { declaredAt: "desc" } } },
      },
    },
  });
  const publiclyListed =
    !!user &&
    user.kycStatus === "verifie" &&
    PROVIDER_ROLES.includes(user.role) &&
    user.profiles.length > 0;

  if (isVisitor && !publiclyListed) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const profile = user.profiles.find((p) => p.isDefault) ?? user.profiles[0] ?? null;
  const declarations = profile?.declarations ?? [];

  const latestByType = new Map<string, (typeof declarations)[number]>();
  for (const d of declarations) {
    if (!latestByType.has(d.declarationType)) latestByType.set(d.declarationType, d);
  }

  const [missionsCompleted, reviews] = await Promise.all([
    prisma.mission.count({
      where: { status: "cloturee", proposals: { some: { providerId: userId, status: "acceptee" } } },
    }),
    prisma.review.findMany({ where: { targetId: userId, suspendu: false }, select: { note: true } }),
  ]);
  const averageNote = reviews.length ? reviews.reduce((s, r) => s + r.note, 0) / reviews.length : null;

  const insurance = latestByType.get("insurance");
  const qualification = latestByType.get("qualification");

  return NextResponse.json({
    // Identité publique (déjà visible sur les cartes de mission/candidature dans la
    // marketplace) — le rôle est la filière métier, pas une donnée privée.
    identite: {
      prenom: user.firstname,
      nom: user.lastname,
      role: user.role,
      pays: user.country,
      ville: user.city,
      // Null si pas de photo : la vue retombe sur les initiales sans lancer de requête
      // 404 inutile sur /api/users/[id]/avatar.
      avatarPath: user.avatarPath,
    },
    // Bloc 1 — Vérifié par Flexwork : identité uniquement, jamais rien d'autre.
    verifie: { identiteVerifiee: user.kycStatus === "verifie" },
    // Bloc 2 — Déclaré par le prestataire (non vérifié).
    declare: {
      mainDomain: profile?.mainDomain ?? null,
      declaredLevel: profile?.declaredLevel ?? null,
      declaredExperienceYears: profile?.declaredExperienceYears ?? null,
      indicativeRate: profile?.indicativeRate ?? null,
      tarifUnite: profile?.tarifUnite ?? null,
      tags: profile?.tags ?? [],
      description: profile?.description ?? null,
      // CV et pièces de portfolio sont servis par /api/profile/portfolio-file, qui exige une
      // session : les exposer à un visiteur ne produirait que des liens morts, et un CV
      // contient l'adresse et le téléphone du prestataire — même raisonnement que l'email
      // retiré de /api/search/prestataires. Ils restent visibles pour un connecté.
      portfolioUrls: isVisitor ? [] : profile?.portfolioUrls ?? [],
      cvUrl: isVisitor ? null : profile?.cvUrl ?? null,
      zonePays: profile?.zonePays ?? null,
      zoneVille: profile?.zoneVille ?? null,
      zoneRayonKm: profile?.zoneRayonKm ?? null,
      // Champs choisis un par un : `latestByType` porte la déclaration COMPLÈTE, dont
      // ipAddress, userAgent, les hachages de chaînage et le filePath de chaque document
      // justificatif. Renvoyer l'objet tel quel exposait ces données à tout appelant — et
      // les aurait exposées au web entier en ouvrant la route. Le numéro de police est un
      // identifiant de contrat, pas un signal de confiance : masqué au visiteur, l'assureur,
      // le plafond et la validité suffisent à la réassurance publique.
      insurance: insurance
        ? {
            insurerName: insurance.insurerName,
            policyNumber: isVisitor ? null : insurance.policyNumber,
            coverageCeiling: insurance.coverageCeiling,
            validUntil: insurance.validUntil,
          }
        : null,
      qualification: qualification ? { label: qualification.label } : null,
      mention: "Ces informations sont déclarées par le prestataire. Flexwork ne les a pas vérifiées.",
    },
    // Bloc 3 — Activité sur la plateforme : faits d'usage constatés, pas des déclarations.
    activite: {
      missionsCompleted,
      averageNote,
      memberSince: user.createdAt,
    },
  });
}
