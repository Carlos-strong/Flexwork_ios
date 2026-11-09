import { createUser } from "./accounts";
import { prisma } from "./db";

/** Prestataire au profil complet (100 %) avec trois services : en ligne, brouillon, ancien format commandé. */
export async function seedProviderWithServices(label: string) {
  const user = await createUser({ label, role: "expert_digital", kycStatus: "verifie", firstname: "Awa", lastname: "Services" });
  await prisma.user.update({ where: { id: user.id }, data: { avatarPath: "avatars/test.png" } });
  const RUN = Date.now();
  const profile = await prisma.profile.create({ data: {
    userId: user.id, label: "Principal", isDefault: true, mainDomain: "Design graphique", tags: ["Logo", "Affiche", "Flyer"],
    providerKind: "independant", title: "Designer graphique", description: "Designer graphique depuis 8 ans, je crée des identités visuelles.",
    declaredLevel: "senior", declaredExperienceYears: 8, zonePays: "BJ", zoneVille: "Cotonou", zoneRayonKm: 30, availability: "temps_plein", tarifUnite: "jour" } });
  await prisma.professionalDeclaration.create({ data: { profileId: profile.id, declarationType: "experience", declarationTextSnapshot: "x" + RUN, currentHash: "xh" + RUN,
    experiences: { create: { clientType: "COMPANY", clientName: "Agence Wax", role: "DA", startDate: "2019-01" } } } });
  await prisma.professionalDeclaration.create({ data: { profileId: profile.id, declarationType: "qualification", declarationTextSnapshot: "q" + RUN, currentHash: "qh" + RUN,
    diplomas: { create: { qualificationName: "BTS", year: 2016, isStateIssued: true } } } });
  const pk = (base: number) => [
    { tier: "basique" as const, titre: "Essentiel", description: "Une proposition, fichiers PNG.", prix: base, delaiJours: 3, revisions: 1 },
    { tier: "standard" as const, titre: "Confort", description: "Deux propositions, PNG et SVG.", prix: base * 2, delaiJours: 5, revisions: 2 },
    { tier: "premium" as const, titre: "Complet", description: "Trois propositions, charte complète.", prix: base * 3, delaiJours: 7, revisions: 4 },
  ];
  const online = await prisma.gig.create({ data: { providerId: user.id, titre: "Je vais créer un logo professionnel qui fait vendre", description: "Logo. ".repeat(40), domaine: "Design graphique", prix: 25000, delaiJours: 3, tags: ["logo"], status: "publie", videoUrl: "https://youtu.be/dQw4w9WgXcQ", packages: { create: pk(25000) } } });
  const draft = await prisma.gig.create({ data: { providerId: user.id, titre: "Je vais concevoir votre affiche événementielle", description: "Affiche. ".repeat(30), domaine: "Design graphique", prix: 15000, delaiJours: 2, tags: ["affiche"], status: "brouillon", packages: { create: pk(15000) } } });
  const legacy = await prisma.gig.create({ data: { providerId: user.id, titre: "Flyer A5 recto-verso", description: "Flyer.", domaine: "Design graphique", prix: 10000, delaiJours: 2, tags: ["flyer"], status: "publie" } });
  const client = await createUser({ label: label + "cli", kycStatus: "verifie" });
  await prisma.gigOrder.create({ data: { gigId: legacy.id, clientId: client.id, providerId: user.id, montant: 10000, termsSnapshot: {}, status: "completed" } });
  return { user, online, draft, legacy };
}
