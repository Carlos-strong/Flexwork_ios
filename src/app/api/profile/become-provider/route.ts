import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recordVerificationHistory } from "@/lib/verification-history";
import { PROVIDER_ROLES, PROVIDER_ROLE_LABELS } from "@/lib/provider-options";
import type { UserRole } from "@prisma/client";

// Activation de l'espace prestataire (2026-09-23) — décision « Option C ».
//
// ── Ce que cette route remplace ─────────────────────────────────────────────────────────
//
// Aucun écran ni aucune API ne permettait de devenir prestataire après l'inscription :
// `prisma.user.update` n'écrivait JAMAIS `role`, qui n'était fixé qu'à la création du compte.
// Un client qui découvrait la plateforme, y prenait goût et voulait proposer ses services
// n'avait aucun chemin : il lui fallait un second compte, avec une seconde vérification KYC.
//
// ── Ce qui est décidé, et pourquoi ──────────────────────────────────────────────────────
//
// Le rôle par défaut est CLIENT. Devenir prestataire est une action explicite, pas un état
// déduit d'un formulaire à moitié rempli : un compte qui a saisi un métier par curiosité
// n'a pas pour autant demandé à candidater. D'où deux marqueurs distincts :
//
//   - `role`            : QUELLE filière (artisan, manœuvre, expert digital…) — pilote les
//                         missions proposées et l'affichage ;
//   - `isProvider`      : l'espace prestataire est OUVERT. `providerActivatedAt` le date.
//
// L'activation n'accorde AUCUNE vérification : le KYC reste à faire, et c'est lui — pas ce
// drapeau — qui autorise à candidater.
//
// ── Le contrôle d'âge (A13) ne vit plus ici (2026-09-24) ─────────────────────────────────────
//
// Il portait sur la FILIÈRE : activer « artisan » était refusé si l'âge minimum du pays n'était
// pas atteint. Le défaut était structurel — un compte dont la plateforme ne connaît AUCUN âge
// était refusé comme s'il était trop jeune, et la date de naissance n'est saisissable par
// personne côté utilisateur : elle est relevée sur la pièce d'identité par l'équipe KYC. Un
// nouvel arrivant devait donc faire vérifier son identité AVANT de pouvoir dire quel métier il
// exerce, alors que c'est le métier — et lui seul — qui dit si le travail est dangereux.
//
// La barrière se dresse désormais au moment du CHOIX DU MÉTIER (POST /api/profile, catégorie
// marquée par l'admin) et se redresse à la candidature (src/lib/candidature-guard.ts).
// Ouvrir son espace est un acte administratif : on n'y met plus de condition d'âge.

const BECOME_PROVIDER_ERRORS: Record<string, { status: number; message: string }> = {
  unauthenticated: { status: 401, message: "Connectez-vous pour continuer." },
  invalid_payload: { status: 400, message: "Choisissez le type d'activité qui vous correspond." },
  already_provider: { status: 409, message: "Votre espace prestataire est déjà ouvert." },
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const providerType = typeof body?.providerType === "string" ? body.providerType : "";
  if (!PROVIDER_ROLES.includes(providerType as UserRole)) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: BECOME_PROVIDER_ERRORS.invalid_payload.message,
        allowed: PROVIDER_ROLES.map((r) => ({ value: r, label: PROVIDER_ROLE_LABELS[r] ?? r })),
      },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Idempotence partielle : une seconde demande sur un compte déjà prestataire n'est pas une
  // erreur grave, mais elle ne doit pas réécrire la date d'activation d'origine — c'est la
  // date qui compte pour un recours, pas celle du dernier clic.
  if (user.isProvider) {
    return NextResponse.json(
      {
        error: "already_provider",
        message: BECOME_PROVIDER_ERRORS.already_provider.message,
        isProvider: true,
        providerActivatedAt: user.providerActivatedAt,
      },
      { status: 409 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      isProvider: true,
      providerActivatedAt: new Date(),
      // La filière est écrite ICI et pas avant : c'est l'activation qui choisit le métier,
      // et un compte resté client ne doit pas porter une filière qui ne veut rien dire pour lui.
      role: providerType as UserRole,
    },
    select: { id: true, isProvider: true, providerActivatedAt: true, role: true },
  });

  // Tracé dans la chaîne d'historique : ouvrir un espace prestataire est un acte, il se date.
  // `subjectType: "kyc"` parce que l'acte porte sur le COMPTE (l'enum ne connaît que `kyc` et
  // `declaration`, et une déclaration est un objet qui n'existe pas encore ici).
  await recordVerificationHistory({
    subjectType: "kyc",
    subjectId: userId,
    event: `provider:activated:${providerType}`,
  });

  return NextResponse.json(updated, { status: 201 });
}
