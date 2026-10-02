import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { profileSchema, declaredLevelSchema } from "@/lib/validation";
import { isCategorieAgeOk } from "@/lib/age-categorie";
import { findPrimaryProfile } from "@/lib/profile-query";

// US-102 (Phase 1) : profil générique, quel que soit le rôle. Ne conditionne aucune
// vérification de la plateforme — jamais bloqué par le statut KYC (modele-skillafrica-v3-
// Flexwork.md §9 : le KYC ne bloque jamais la complétion du profil).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // A13 — la barrière d'âge n'est plus ici (2026-09-24).
  //
  // Elle s'évaluait sur la FILIÈRE du compte, donc à l'enregistrement d'importe quel onglet,
  // y compris ceux qui ne disent rien du travail (une biographie, une ville). Or la filière dit
  // COMMENT on exerce, pas QUEL travail on fait : depuis que « Prestataire indépendant » a
  // remplacé « Expert digital », elle ne délimite plus rien, et un électricien pouvait s'y
  // déclarer sans jamais rencontrer le contrôle.
  //
  // Le contrôle est descendu au MÉTIER, juste en dessous : c'est là que la catégorie est
  // connue, et c'est la catégorie qui dit le travail.

  // ⚠️ Pas de prisma.profile.upsert({ where: { userId } }) : depuis le passage multi-profils
  // (2026-08-06), Profile n'a plus de contrainte unique sur userId seul — seulement le
  // couple userId_label (@@unique([userId, label])). `where: { userId }` ne compile même
  // pas contre le type ProfileWhereUniqueInput généré ; en JS non strictement vérifié au
  // runtime ça levait une PrismaClientValidationError non interceptée = 500 systématique,
  // sans exception, sur CHAQUE tentative d'enregistrement du profil ("Domaine
  // d'intervention" ne pouvait jamais être sauvegardé).
  //
  // `findPrimaryProfile` (2026-09-23) remplace le findFirst({ where: { userId } }) recopié
  // ici et dans les autres routes profil : sans `orderBy`, PostgreSQL ne garantissait pas
  // de rendre toujours le même profil, et l'écran pouvait afficher un autre métier que
  // celui qu'on venait d'enregistrer.
  const existing = await findPrimaryProfile(userId);

  // ── Le métier du catalogue fait foi (2026-09-23) ────────────────────────────────────────
  //
  //`mainDomain` ne stockait que le LIBELLÉ du métier, exactement comme `Mission.domaine`.
  // Un libellé suffit à rapprocher, mais il ne dit pas de quelle CATÉGORIE il vient : à la
  // réédition, la cascade de l'onglet Domaines se rouvrait vide et le profil ne pouvait plus
  // être reclassé proprement. La clé étrangère répare ça.
  //
  // Et, comme pour les missions, c'est la FK qui commande : le libellé envoyé par l'écran est
  // IGNORÉ au profit de celui du catalogue. Un écran qui se trompe — ou un appel direct — ne
  // peut donc pas inscrire un métier de fantaisie, ni faire diverger l'affichage du
  // rapprochement. Un métier inconnu est un refus, pas un enregistrement silencieux.
  //
  // Les profils antérieurs gardent leur texte seul : aucun backfill ne peut deviner de quel
  // métier il venait, et l'inventer serait pire que l'absence.
  let mainDomain = parsed.data.mainDomain;
  if (parsed.data.metierId) {
    const metier = await prisma.metier.findUnique({ where: { id: parsed.data.metierId } });
    if (!metier) {
      return NextResponse.json({ error: "metier_not_found" }, { status: 400 });
    }
    mainDomain = metier.libelle;

    // A13 — la barrière d'âge se dresse sur la CATÉGORIE du métier qu'on vient de choisir
    // (2026-09-24). Un métier n'est contrôlé que si un administrateur a marqué sa catégorie
    // dans la taxonomie — le seuil, lui, reste celui configuré par pays pour la filière du
    // compte. La distinction des refus est conservée : un âge INCONNU n'est pas un âge
    // insuffisant, et l'identité déjà vérifiée n'a plus rien à vérifier.
    const ageOk = await isCategorieAgeOk({
      categorieId: metier.categorieId,
      role: user.role,
      country: user.country,
      dateNaissance: user.dateNaissance,
    });
    if (!ageOk.ok) {
      const error =
        ageOk.reason === "no_birth_date"
          ? user.kycStatus === "verifie"
            ? "birth_date_missing"
            : "kyc_required_for_age"
          : "profile_below_minimum_age";
      return NextResponse.json({ error }, { status: 403 });
    }
  }

  // `Profile.mainDomain` est NON NULL en base, mais `profileSchema.mainDomain` est devenu
  // facultatif (2026-09-23) pour que les onglets du formulaire s'enregistrent séparément :
  // saisir sa biographie ne doit pas obliger à renvoyer son métier. L'exigence vit donc ici,
  // à l'endroit qui sait s'il y a déjà un profil — et elle ne vaut que pour la création.
  // Elle porte sur le libellé EFFECTIF : choisir un métier du catalogue suffit, même sans
  // renvoyer `mainDomain`.
  if (!existing && !mainDomain) {
    return NextResponse.json(
      {
        error: "main_domain_required",
        message: "Choisissez votre métier principal (onglet Domaines) avant d'enregistrer cette section.",
      },
      { status: 400 },
    );
  }

  // Le libellé dérivé remplace celui de l'écran, et la clé du métier inconnu est écartée.
  // Une clé absente laisse les colonnes intactes : l'onglet Localisation ne connaît pas le
  // métier et ne doit pas l'effacer.
  const data = {
    ...parsed.data,
    ...(mainDomain ? { mainDomain } : {}),
  };
  const profile = existing
    ? await prisma.profile.update({ where: { id: existing.id }, data })
    : await prisma.profile.create({ data: { userId, label: "Principal", isDefault: true, ...data, mainDomain: data.mainDomain! } });

  return NextResponse.json(profile);
}

// US-305 (Phase 3) : niveau et expérience purement auto-déclarés, aucun calcul serveur.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = declaredLevelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  // Même correctif qu'au POST ci-dessus : { where: { userId } } n'est pas une clé unique valide.
  const existing = await findPrimaryProfile(userId);
  if (!existing) {
    return NextResponse.json({ error: "profile_required" }, { status: 409 });
  }
  const profile = await prisma.profile.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  return NextResponse.json(profile);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  // Même correctif : { where: { userId } } n'est plus une clé unique valide depuis le
  // passage multi-profils — findPrimaryProfile() n'a besoin d'aucune contrainte unique.
  const profile = await findPrimaryProfile(userId);
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(profile);
}
