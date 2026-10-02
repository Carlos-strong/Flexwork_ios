import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { clientProfileSchema } from "@/lib/validation";
import { computeClientProfileCompletion } from "@/lib/client-profile-completion";

// Profil client — pendant de POST /api/profile (prestataire). Comme lui : purement
// déclaratif, jamais bloqué par le KYC, et ne conditionne aucun droit
// (modele-skillafrica-v3-Flexwork.md §9).
//
// Deux particularités :
//
//  - Le formulaire couvre deux tables. Les préférences métier vont dans ClientProfile, mais
//    l'adresse et la localisation appartiennent à User (elles servent aussi au prestataire).
//    Les deux écritures passent par une transaction : un profil à moitié enregistré
//    afficherait un pourcentage de complétion faux.
//
//  - La complétion est calculée ici et renvoyée avec le profil. L'UI ne la recalcule jamais,
//    sinon deux barèmes divergeraient (voir src/lib/client-profile-completion.ts).

const USER_FIELDS = ["country", "city", "locality", "address"] as const;

async function loadWithCompletion(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstname: true,
      lastname: true,
      email: true,
      tel: true,
      country: true,
      city: true,
      locality: true,
      address: true,
      avatarPath: true,
      clientProfile: true,
    },
  });
  if (!user) return null;

  const { clientProfile, ...userFields } = user;
  return {
    profile: clientProfile,
    user: userFields,
    completion: computeClientProfileCompletion({
      ...userFields,
      profession: clientProfile?.profession,
      clientType: clientProfile?.clientType,
      company: clientProfile?.company,
      sector: clientProfile?.sector,
      languages: clientProfile?.languages,
    }),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const data = await loadWithCompletion(userId);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Pas de 404 quand le profil n'existe pas encore : un client qui n'a rien rempli est un
  // cas normal, pas une erreur. On renvoie `profile: null` et une complétion calculée sur
  // les seuls champs de User — c'est ce qui permet d'afficher 38 % dès l'inscription.
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = clientProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { country, city, locality, address, ...profileData } = parsed.data;
  const userData = { country, city, locality, address };
  // Un champ absent du payload n'est pas un champ vidé : on n'écrit que ce qui a été
  // explicitement envoyé, pour qu'un formulaire partiel n'efface pas le reste.
  const userPatch = Object.fromEntries(
    USER_FIELDS.filter((key) => userData[key] !== undefined).map((key) => [key, userData[key]]),
  );

  await prisma.$transaction([
    prisma.clientProfile.upsert({
      where: { userId },
      create: { userId, ...profileData },
      update: profileData,
    }),
    prisma.user.update({ where: { id: userId }, data: userPatch }),
  ]);

  return NextResponse.json(await loadWithCompletion(userId));
}
