import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { canViewProfile, isPubliclyListed } from "@/lib/profile-visibility";
import { readLanguages } from "@/lib/languages";
import { serializeGig } from "@/lib/gig-serialize";

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
//
// Connectés (2026-11-08) : un connecté ne lit plus N'IMPORTE QUEL compte en changeant l'id
// de l'URL. Hors profils listés, seuls le titulaire, un administrateur ou un utilisateur
// avec qui il partage une mission y ont accès (src/lib/profile-visibility.ts) ; les autres
// reçoivent 404, que le compte existe ou non. Un compte suspendu ou banni n'est plus listé.
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
        include: {
          declarations: {
            where: { removedAt: null },
            // Détail des diplômes et expériences (2026-11-07) : le profil public les affiche.
            // Les personnes ressources (`references`) ne sont PAS incluses : noms et téléphones
            // de tiers, jamais publiés.
            include: { documents: true, diplomas: true, experiences: true },
            orderBy: { declaredAt: "desc" },
          },
        },
      },
    },
  });
  const target = user ? { ...user, profileCount: user.profiles.length } : null;
  const publiclyListed = isPubliclyListed(target);

  if (isVisitor && !publiclyListed) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const viewer = session?.user
    ? { id: (session.user as { id: string }).id, isAdmin: (session.user as { isAdmin?: boolean }).isAdmin === true }
    : null;
  if (!user || !(await canViewProfile(viewer, target))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const profile = user.profiles.find((p) => p.isDefault) ?? user.profiles[0] ?? null;
  const declarations = profile?.declarations ?? [];

  const latestByType = new Map<string, (typeof declarations)[number]>();
  for (const d of declarations) {
    if (!latestByType.has(d.declarationType)) latestByType.set(d.declarationType, d);
  }

  const [missionsCompleted, reviews, gigs, doneMissionTags, doneGigTags] = await Promise.all([
    prisma.mission.count({
      where: { status: "cloturee", proposals: { some: { providerId: userId, status: "acceptee" } } },
    }),
    // Avis (2026-11-08) : note, commentaire, date, et ce qui situe l'avis sans identifier son
    // auteur — son pays et le métier de la mission. Jamais le nom du client.
    prisma.review.findMany({
      where: { targetId: userId, suspendu: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        note: true,
        commentaire: true,
        createdAt: true,
        author: { select: { country: true } },
        mission: { select: { domaine: true, metier: { select: { libelle: true } } } },
      },
    }),
    // Services publiés (Gigs), 2026-11-08 — la vitrine « Services » du profil.
    prisma.gig.findMany({
      where: { providerId: userId, status: "publie" },
      include: { packages: true, _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    // Compétences CONFIRMÉES : celles qu'une mission clôturée ou une commande de Gig terminée
    // a réellement mobilisées — un fait constaté sur la plateforme, pas une déclaration.
    prisma.mission.findMany({
      where: { status: "cloturee", proposals: { some: { providerId: userId, status: "acceptee" } } },
      select: { tags: true },
    }),
    prisma.gigOrder.findMany({ where: { providerId: userId, status: "completed" }, select: { gig: { select: { tags: true } } } }),
  ]);
  const averageNote = reviews.length ? reviews.reduce((s, r) => s + r.note, 0) / reviews.length : null;
  const ratingBreakdown = [5, 4, 3, 2, 1].map((n) => ({ note: n, count: reviews.filter((r) => r.note === n).length }));
  const usedTags = new Set(
    [...doneMissionTags.flatMap((m) => m.tags), ...doneGigTags.flatMap((o) => o.gig.tags)].map((t) => t.toLocaleLowerCase("fr")),
  );
  const confirmedSkills = (profile?.tags ?? []).filter((t) => usedTags.has(t.toLocaleLowerCase("fr")));

  const insurance = latestByType.get("insurance");
  const qualification = latestByType.get("qualification");
  const experienceDecl = latestByType.get("experience");

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
    verifie: {
      identiteVerifiee: user.kycStatus === "verifie",
      // Badge « Vérifié » (2026-11-08) : accordé par l'Admin KYC après examen d'un diplôme
      // d'État, POUR le métier du profil. Une vérification faite par Flexwork, comme l'identité.
      badgeMetier: profile?.badgeStatus === "accorde" ? profile.mainDomain : null,
    },
    // Bloc 2 — Déclaré par le prestataire (non vérifié).
    declare: {
      mainDomain: profile?.mainDomain ?? null,
      // Clé du métier au catalogue (2026-11-08) — donnée de catalogue, pas personnelle. Sert au
      // bouton « Publier une mission » du profil, qui pré-remplit le métier du prestataire.
      metierId: profile?.metierId ?? null,
      declaredLevel: profile?.declaredLevel ?? null,
      declaredExperienceYears: profile?.declaredExperienceYears ?? null,
      indicativeRate: profile?.indicativeRate ?? null,
      tarifUnite: profile?.tarifUnite ?? null,
      tags: profile?.tags ?? [],
      description: profile?.description ?? null,
      // Champs des étapes Présentation / Localisation / Configuration (2026-11-07). `quartier`
      // et `modeContact` restent hors du profil public : un quartier localise une personne, et
      // le contact passe de toute façon par une mission.
      title: profile?.title ?? null,
      languages: readLanguages(profile?.languages),
      confirmedSkills,
      providerKind: profile?.providerKind ?? null,
      overview: profile?.overview ?? null,
      currency: profile?.currency ?? null,
      workModes: profile?.workModes ?? [],
      coverageZones: profile?.coverageZones ?? [],
      deplacement: profile?.deplacement ?? [],
      availability: profile?.availability ?? null,
      // Déclaration la plus récente de chaque type = état en vigueur (voir GET /api/declarations).
      // Champs choisis un par un, comme pour l'assurance.
      diplomas: (qualification?.diplomas ?? []).map((d) => ({
        qualificationName: d.qualificationName,
        specialty: d.specialty,
        year: d.year,
        country: d.country,
        institution: d.institution,
        isStateIssued: d.isStateIssued,
      })),
      experiences: (experienceDecl?.experiences ?? []).map((x) => ({
        role: x.role,
        clientType: x.clientType,
        clientName: x.clientName,
        domain: x.domain,
        startDate: x.startDate,
        endDate: x.endDate,
        description: x.description,
      })),
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
      reviewCount: reviews.length,
      ratingBreakdown,
      memberSince: user.createdAt,
    },
    // Services publiés : mêmes champs que le catalogue (src/lib/gig-serialize.ts).
    services: gigs.map((g) => ({ ...serializeGig(g), ordersCount: g._count.orders })),
    avis: reviews.slice(0, 20).map((r) => ({
      id: r.id,
      note: r.note,
      commentaire: r.commentaire,
      createdAt: r.createdAt,
      pays: r.author.country,
      metier: r.mission.metier?.libelle ?? r.mission.domaine,
    })),
  });
}
