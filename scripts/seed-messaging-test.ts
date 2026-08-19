/**
 * Seed de test — crée un écosystème complet pour tester la messagerie et les appels.
 *
 * Crée :
 *  - 1 client (Aïcha D.)
 *  - 4 prestataires (un par type : expert_digital, expert_btp_autres, artisan, manoeuvre)
 *  - 4 missions (une par prestataire, publiée par le client)
 *  - 4 propositions (une par prestataire)
 *  - Messages de test entre client et chaque prestataire
 *
 * Usage : npx tsx scripts/seed-messaging-test.ts
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

// Mots de passe hashés avec bcryptjs (tous = "Test123456!")
const PASSWORD_HASH = "$2a$10$dummyhashwillbereplaced";

const USERS = [
  { email: "aicha@flexwork.test",   tel: "+22997100001", role: "client" as const,            firstname: "Aïcha",    lastname: "Dossou",    country: "BJ", city: "Cotonou" },
  { email: "expert-digital@flexwork.test", tel: "+22997100002", role: "expert_digital" as const,     firstname: "Kwame",    lastname: "Olympio",   country: "BJ", city: "Cotonou" },
  { email: "expert-btp@flexwork.test",     tel: "+22997100003", role: "expert_btp_autres" as const,  firstname: "Moussa",   lastname: "Traoré",    country: "BJ", city: "Parakou" },
  { email: "artisan@flexwork.test",        tel: "+22997100004", role: "artisan" as const,            firstname: "Fatou",    lastname: "Sène",      country: "SN", city: "Dakar" },
  { email: "manoeuvre@flexwork.test",      tel: "+22997100005", role: "manoeuvre" as const,          firstname: "Ibrahim",  lastname: "Touré",     country: "BJ", city: "Cotonou" },
];

const MISSIONS = [
  { titre: "Refonte logo + charte graphique", domaine: "Design UI/UX", budget: 150000, delaiJours: 7,  providerIdx: 1 },
  { titre: "Construction mur de clôture 20m", domaine: "Maçonnerie",   budget: 450000, delaiJours: 21, providerIdx: 2 },
  { titre: "Pose carrelage salon 50m²",       domaine: "Carrelage",    budget: 120000, delaiJours: 5,  providerIdx: 3 },
  { titre: "Aide manutention chantier",       domaine: "Manutention",  budget: 25000,  delaiJours: 3,  providerIdx: 4 },
];

const MESSAGES = [
  // Client ↔ Expert Digital
  { missionIdx: 0, senderRole: "prestataire", text: "Bonjour Aïcha ! J'ai bien reçu votre brief pour le logo. Je commence les recherches dès aujourd'hui." },
  { missionIdx: 0, senderRole: "client",       text: "Super Kwame ! J'ai hâte de voir les premières pistes. On peut faire un point visio demain ?" },
  { missionIdx: 0, senderRole: "prestataire", text: "Parfait, 15h ça vous va ? Je vous envoie le lien." },
  // Client ↔ Expert BTP
  { missionIdx: 1, senderRole: "client",       text: "Bonjour M. Traoré, le terrain est déjà dégagé. Quand pouvez-vous passer pour le devis final ?" },
  { missionIdx: 1, senderRole: "prestataire", text: "Je passe demain matin 8h avec mon équipe pour les mesures. On fera le devis sur place." },
  // Client ↔ Artisan
  { missionIdx: 2, senderRole: "prestataire", text: "Bonjour ! J'ai besoin de connaître la référence exacte du carrelage avant de confirmer le planning." },
  { missionIdx: 2, senderRole: "client",       text: "C'est du 30x30 grès cérame beige. Je vous envoie la photo." },
  // Client ↔ Manœuvre
  { missionIdx: 3, senderRole: "client",       text: "Bonjour Ibrahim, disponible lundi pour le déchargement ? Début 7h." },
  { missionIdx: 3, senderRole: "prestataire", text: "Oui je serai là à 6h45. Combien de tonnes à décharger ?" },
  { missionIdx: 3, senderRole: "client",       text: "Environ 3 tonnes de sacs de ciment. Prévois la journée." },
];

async function main() {
  console.log("🌱 Seed messagerie test — démarrage...\n");

  // 1. Créer les utilisateurs
  const userIds: string[] = [];
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        tel: u.tel,
        role: u.role,
        firstname: u.firstname,
        lastname: u.lastname,
        country: u.country,
        city: u.city,
        status: "active",
        // Un hash bidon assez long pour satisfaire la validation de longueur
        passwordHash: crypto.randomBytes(32).toString("hex"),
      },
      update: { status: "active", role: u.role },
    });
    userIds.push(user.id);
    console.log(`  ✅ ${u.role.padEnd(20)} | ${u.firstname} ${u.lastname} | ${u.email}`);
  }

  const [clientId, expertDigitalId, expertBtpId, artisanId, manoeuvreId] = userIds;

  // 2. Créer les missions
  const missionIds: string[] = [];
  for (const m of MISSIONS) {
    const mission = await prisma.mission.upsert({
      where: { id: `test-msg-${m.providerIdx}` },
      create: {
        id: `test-msg-${m.providerIdx}`,
        clientId,
        titre: m.titre,
        description: `Mission de test pour ${m.domaine}`,
        domaine: m.domaine,
        mode: m.providerIdx === 1 ? "distance" : "presentiel",
        budget: m.budget,
        currency: "XOF",
        delaiJours: m.delaiJours,
        status: "en_cours",
        professionalType: ["", "EXPERT_DIGITAL", "EXPERT_BTP", "ARTISAN", "MANOEUVRE"][m.providerIdx],
      },
      update: { status: "en_cours" },
    });
    missionIds.push(mission.id);
    console.log(`  📋 Mission: ${m.titre} (${m.budget.toLocaleString()} FCFA)`);
  }

  // 3. Créer les propositions
  const providerIds = [expertDigitalId, expertBtpId, artisanId, manoeuvreId];
  for (let i = 0; i < 4; i++) {
    await prisma.missionProposal.upsert({
      where: { missionId_providerId: { missionId: missionIds[i], providerId: providerIds[i] } },
      create: {
        missionId: missionIds[i],
        providerId: providerIds[i],
        montant: MISSIONS[i].budget,
        message: `Proposition pour ${MISSIONS[i].titre}`,
        status: "acceptee",
      },
      update: { status: "acceptee" },
    });
    console.log(`  🤝 Proposition acceptée: ${USERS[i+1].firstname} → Mission ${i+1}`);
  }

  // 4. Créer les messages de test
  let msgCount = 0;
  for (const msg of MESSAGES) {
    const missionId = missionIds[msg.missionIdx];
    const senderId = msg.senderRole === "client" ? clientId : providerIds[msg.missionIdx];

    await prisma.message.create({
      data: {
        missionId,
        senderId,
        content: msg.text,
      },
    });
    msgCount++;
  }
  console.log(`\n  💬 ${msgCount} messages créés`);

  console.log("\n✅ Seed terminé !");
  console.log("\n📧 Comptes test (tous avec OTP bypass en dev) :");
  for (const u of USERS) {
    console.log(`   ${u.email} (${u.role})`);
  }
  console.log("\n🚀 Pour tester :");
  console.log("   1. npm run dev");
  console.log("   2. Connecte-toi avec un email ci-dessus");
  console.log("   3. Le code OTP est loggé dans le terminal serveur");
  console.log("   4. Va dans Messages → Appel audio/visio");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
