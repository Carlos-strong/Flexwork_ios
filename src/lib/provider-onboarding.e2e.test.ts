/**
 * Onboarding prestataire + KYC financier (2026-09-23).
 *
 * Ce que ces tests verrouillent, et pourquoi chacun compte :
 *
 *   1. l'activation de l'espace prestataire (décision « Option C ») — sans elle, un client qui
 *      veut proposer ses services devait ouvrir un SECOND compte, avec une seconde
 *      vérification d'identité ;
 *   2. la sauvegarde ONGLET PAR ONGLET du profil — enregistrer sa localisation ne doit pas
 *      effacer sa biographie, sinon cinq onglets valent moins qu'une page unique ;
 *   3. le barème de complétion, servi par l'API (jamais recalculé côté écran) ;
 *   4. le dossier Mobile Money — la plateforme savait exécuter une mission de bout en bout
 *      sans avoir nulle part où envoyer l'argent ;
 *   5. les deux décisions admin, seuls écrivains de `badgeAccorde/refuse` et de
 *      `PayoutAccount.status` : sans elles, les deux demandes restaient ouvertes à jamais.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { POST as becomeProvider } from "@/app/api/profile/become-provider/route";
import { GET as completion } from "@/app/api/profile/completion/route";
import { POST as saveProfile } from "@/app/api/profile/route";
import { GET as payoutGet, POST as payoutPost } from "@/app/api/kyc/payout/route";
import { POST as badgeDecision } from "@/app/api/admin/kyc/badges/[userId]/decision/route";
import { GET as badgeQueue } from "@/app/api/admin/kyc/badges/route";
import { POST as payoutDecision } from "@/app/api/admin/kyc/payouts/[userId]/decision/route";

const RUN = Date.now();
let clientId = "";
let adminId = "";
let superviseurId = "";
let prestataireId = "";
let profileId = "";
// Compte sans profil, pour vérifier ce qui se passe à la CRÉATION — les autres tests partent
// d'un profil déjà existant.
let fkUserId = "";
// Comptes créés pour la barrière d'âge : sans date de naissance, ou mineurs.
const ageUserIds: string[] = [];

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const json = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const params = (userId: string) => ({ params: Promise.resolve({ userId }) });

async function makeUser(suffix: string, role = "client") {
  return prisma.user.create({
    data: {
      email: `e2e-onboard-${suffix}-${RUN}@flexwork.test`,
      tel: `+2299${String(RUN).slice(-6)}${suffix.charCodeAt(0)}`,
      role: role as never,
      country: "BJ",
      dateNaissance: new Date("1990-01-01"),
    },
  });
}

beforeAll(async () => {
  const [client, admin, superviseur, prestataire] = await Promise.all([
    makeUser("cli"),
    prisma.user.create({
      data: {
        email: `e2e-onboard-admin-${RUN}@flexwork.test`,
        tel: `+2298${String(RUN).slice(-7)}`,
        role: "client",
        isAdmin: true,
        adminRole: "kyc",
        kycStatus: "verifie",
      },
    }),
    // Le second pouvoir, pour vérifier que « le superviseur lit tout » vaut aussi pour les
    // files ajoutées ici (§13) — sans lui, un 403 se serait affiché « file vide ».
    prisma.user.create({
      data: {
        email: `e2e-onboard-sup-${RUN}@flexwork.test`,
        tel: `+2297${String(RUN).slice(-7)}`,
        role: "client",
        isAdmin: true,
        adminRole: "superviseur",
        kycStatus: "verifie",
      },
    }),
    makeUser("pre", "artisan"),
  ]);
  clientId = client.id;
  adminId = admin.id;
  superviseurId = superviseur.id;
  prestataireId = prestataire.id;

  const profile = await prisma.profile.create({
    data: { userId: prestataireId, label: "Principal", isDefault: true, mainDomain: "Électricien" },
  });
  profileId = profile.id;
});

afterAll(async () => {
  const ids = [clientId, adminId, superviseurId, prestataireId, fkUserId, ...ageUserIds];
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.verificationHistoryEntry.deleteMany({ where: { subjectId: { in: [...ids, profileId] } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [adminId, superviseurId] } } });
  await prisma.payoutAccount.deleteMany({ where: { userId: { in: ids } } });
  await prisma.kycDocument.deleteMany({ where: { userId: { in: ids } } });
  await prisma.declaredDiploma.deleteMany({ where: { declaration: { profileId } } });
  await prisma.declaredExperience.deleteMany({ where: { declaration: { profileId } } });
  await prisma.professionalDeclaration.deleteMany({ where: { profileId } });
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("activation de l'espace prestataire (Option C)", () => {
  it("refuse un type d'activité hors des quatre filières, et n'ouvre rien", async () => {
    as(clientId);
    const res = await becomeProvider(json("http://localhost/api/profile/become-provider", { providerType: "client" }));
    expect(res.status).toBe(400);
    const user = await prisma.user.findUnique({ where: { id: clientId } });
    expect(user?.isProvider).toBe(false);
    expect(user?.providerActivatedAt).toBeNull();
  });

  it("refuse un appel non authentifié", async () => {
    as(null);
    const res = await becomeProvider(json("http://localhost/api/profile/become-provider", { providerType: "artisan" }));
    expect(res.status).toBe(401);
  });

  it("ouvre l'espace, écrit la filière ET date l'activation", async () => {
    as(clientId);
    const res = await becomeProvider(
      json("http://localhost/api/profile/become-provider", { providerType: "artisan" }),
    );
    expect(res.status).toBe(201);
    // Le compte était CLIENT : c'est l'activation qui choisit la filière, pas l'inscription.
    const user = await prisma.user.findUnique({ where: { id: clientId } });
    expect(user?.isProvider).toBe(true);
    expect(user?.role).toBe("artisan");
    expect(user?.providerActivatedAt).toBeInstanceOf(Date);
  });

  it("date l'activation dans l'historique de vérification", async () => {
    const entry = await prisma.verificationHistoryEntry.findFirst({
      where: { subjectId: clientId, event: "provider:activated:artisan" },
    });
    expect(entry).not.toBeNull();
  });

  it("refuse une seconde activation SANS réécrire la date d'origine", async () => {
    const before = await prisma.user.findUnique({ where: { id: clientId }, select: { providerActivatedAt: true } });
    as(clientId);
    const res = await becomeProvider(
      json("http://localhost/api/profile/become-provider", { providerType: "manoeuvre" }),
    );
    expect(res.status).toBe(409);
    const after = await prisma.user.findUnique({ where: { id: clientId }, select: { role: true, providerActivatedAt: true } });
    // La filière et la date d'origine sont intactes : c'est la date du PREMIER acte qui compte
    // pour un recours, pas celle du dernier clic.
    expect(after?.role).toBe("artisan");
    expect(after?.providerActivatedAt?.getTime()).toBe(before?.providerActivatedAt?.getTime());
  });
});

describe("barrière d'âge : portée par la CATÉGORIE du métier, plus par la filière (2026-09-24)", () => {
  // ── Pourquoi ce déplacement ─────────────────────────────────────────────────────────────
  //
  // Le contrôle s'évaluait sur la FILIÈRE du compte. Deux défauts, tous deux constatés en
  // rejouant l'inscription d'un prestataire :
  //
  //   1. La filière dit COMMENT on exerce, pas QUEL travail on fait. Depuis que « Prestataire
  //      indépendant » a remplacé « Expert digital », elle ne délimite plus rien : un
  //      électricien pouvait s'y déclarer et n'être jamais soumis au contrôle d'âge.
  //   2. Activer « Artisan » était refusé quand la plateforme ne connaissait AUCUN âge — un cas
  //      très fréquent, puisque la date de naissance n'est saisissable par personne côté
  //      utilisateur : elle est relevée sur la pièce d'identité par l'équipe KYC. Le refus
  //      était donc à la fois faux (« votre âge est insuffisant » alors qu'il est inconnu) et
  //      sans issue.
  //
  // La barrière se dresse désormais au moment où le métier est choisi : la catégorie est l'axe
  // du travail, et c'est elle que l'administrateur marque dans la taxonomie. Les catégories
  // ci-dessous sont créées par le test, jamais une catégorie réelle du catalogue : cocher une
  // vraie catégorie modifierait la règle de production pour tout le monde.
  let categorieMarqueeId = "";
  let categorieLibreId = "";
  let metierMarqueId = "";
  let metierLibreId = "";

  beforeAll(async () => {
    const marquee = await prisma.categorie.create({
      data: { libelle: `e2e-cat-age-${RUN}`, requiresAgeCheck: true },
    });
    const libre = await prisma.categorie.create({
      data: { libelle: `e2e-cat-libre-${RUN}`, requiresAgeCheck: false },
    });
    categorieMarqueeId = marquee.id;
    categorieLibreId = libre.id;
    metierMarqueId = (
      await prisma.metier.create({ data: { categorieId: marquee.id, libelle: `e2e-metier-age-${RUN}` } })
    ).id;
    metierLibreId = (
      await prisma.metier.create({ data: { categorieId: libre.id, libelle: `e2e-metier-libre-${RUN}` } })
    ).id;
  });

  afterAll(async () => {
    // Le métier part avant la catégorie (FK) ; `Profile.metierId` est en ON DELETE SET NULL, donc
    // un profil encore présent ne bloque rien.
    await prisma.metier.deleteMany({ where: { categorieId: { in: [categorieMarqueeId, categorieLibreId] } } });
    await prisma.categorie.deleteMany({ where: { id: { in: [categorieMarqueeId, categorieLibreId] } } });
  });

  const nouveauSansDate = async (suffix: string) => {
    const u = await prisma.user.create({
      data: {
        email: `e2e-onboard-${suffix}-${RUN}@flexwork.test`,
        // Le DERNIER caractère du suffixe, pas le premier : « age1 » et « age2 » commencent tous
        // deux par « a », et le téléphone est unique en base — quatre comptes se seraient heurtés
        // au même numéro.
        tel: `+2294${String(RUN).slice(-6)}${suffix.charCodeAt(suffix.length - 1)}`,
        role: "client",
        country: "BJ",
      },
    });
    ageUserIds.push(u.id);
    return u;
  };

  it("ouvre « Artisan » SANS date de naissance : l'activation ne demande plus d'âge", async () => {
    // C'était le défaut le plus coûteux : la filière chantier la plus courante était fermée à
    // quiconque n'avait pas encore fait vérifier son identité. Ouvrir son espace est un acte
    // administratif — la barrière se dresse au choix du métier, pas ici.
    const u = await nouveauSansDate("age1");
    as(u.id);
    const res = await becomeProvider(json("http://localhost/api/profile/become-provider", { providerType: "artisan" }));
    expect(res.status).toBe(201);
    const enBase = await prisma.user.findUnique({ where: { id: u.id } });
    expect(enBase?.isProvider).toBe(true);
    // Et rien n'est accordé au passage : l'activation n'écrit aucune date de naissance.
    expect(enBase?.dateNaissance).toBeNull();
  });

  it("refuse de déclarer un métier d'une catégorie MARQUÉE sans date de naissance, en demandant la VÉRIFICATION", async () => {
    const u = await nouveauSansDate("age2");
    as(u.id);
    const res = await saveProfile(json("http://localhost/api/profile", { metierId: metierMarqueId }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "kyc_required_for_age" });
    // Le refus ne doit rien laisser derrière lui : ni le métier, ni le profil qu'il aurait créé.
    expect(await prisma.profile.findFirst({ where: { userId: u.id } })).toBeNull();
  });

  it("distingue « identité déjà vérifiée, date manquante » — le renvoyer vérifier serait une boucle", async () => {
    // Cas atteint en rejouant le parcours : le dossier est validé, donc `kycStatus = verifie`,
    // mais la date n'a jamais été relevée. L'écran KYC n'a plus rien à demander : renvoyer vers
    // lui est un mensonge, et il n'existe aucun endroit où saisir la date.
    const u = await nouveauSansDate("age5");
    await prisma.user.update({ where: { id: u.id }, data: { kycStatus: "verifie" } });
    as(u.id);
    const res = await saveProfile(json("http://localhost/api/profile", { metierId: metierMarqueId }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "birth_date_missing" });
  });

  it("refuse un MINEUR en nommant l'âge, cette fois", async () => {
    const u = await nouveauSansDate("age6");
    await prisma.user.update({ where: { id: u.id }, data: { dateNaissance: new Date("2015-01-01") } });
    as(u.id);
    const res = await saveProfile(json("http://localhost/api/profile", { metierId: metierMarqueId }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "profile_below_minimum_age" });
  });

  it("accepte un majeur sur la catégorie marquée", async () => {
    const u = await nouveauSansDate("age7");
    await prisma.user.update({ where: { id: u.id }, data: { dateNaissance: new Date("1995-04-12") } });
    as(u.id);
    const res = await saveProfile(json("http://localhost/api/profile", { metierId: metierMarqueId }));
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findFirst({ where: { userId: u.id } });
    expect(profile?.metierId).toBe(metierMarqueId);
  });

  it("laisse déclarer un métier d'une catégorie NON marquée sans aucun âge connu", async () => {
    // Le corollaire du déplacement : c'est le travail qui déclenche le contrôle. Un métier d'une
    // catégorie que l'admin n'a pas marquée ne demande rien, quelle que soit la filière — et
    // « Prestataire indépendant » n'est plus une façon d'échapper au contrôle sur une catégorie
    // qui, elle, est marquée (cas couvert deux tests plus haut).
    const u = await nouveauSansDate("age4");
    as(u.id);
    const res = await saveProfile(json("http://localhost/api/profile", { metierId: metierLibreId }));
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findFirst({ where: { userId: u.id } });
    expect(profile?.metierId).toBe(metierLibreId);
  });

  it("n'évalue rien quand aucun métier n'est envoyé (onglet Localisation)", async () => {
    // Sans métier, aucune catégorie : il n'y a rien à classifier. Une biographie ne doit pas
    // dépendre de l'âge qu'un autre onglet établirait.
    const u = await nouveauSansDate("age3");
    as(u.id);
    const res = await saveProfile(json("http://localhost/api/profile", { mainDomain: "Plombier" }));
    expect(res.status).toBe(200);
  });
});

describe("profil : sauvegarde onglet par onglet", () => {
  it("crée le profil quand le métier est fourni", async () => {
    as(prestataireId);
    const res = await saveProfile(
      json("http://localhost/api/profile", { mainDomain: "Électricien", title: "Électricien certifié" }),
    );
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.title).toBe("Électricien certifié");
  });

  it("n'écrase PAS les autres onglets : une clé absente laisse la colonne intacte", async () => {
    as(prestataireId);
    // Le formulaire de l'onglet Localisation ne connaît pas la biographie.
    const res = await saveProfile(
      json("http://localhost/api/profile", { zonePays: "BJ", zoneVille: "Cotonou", zoneRayonKm: 20, availability: "temps_plein" }),
    );
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.title).toBe("Électricien certifié");
    expect(profile?.mainDomain).toBe("Électricien");
    expect(profile?.zoneVille).toBe("Cotonou");
    expect(profile?.availability).toBe("temps_plein");
  });

  it("enregistre les champs neufs des onglets 1, 2, 4 et 5", async () => {
    as(prestataireId);
    const res = await saveProfile(
      json("http://localhost/api/profile", {
        mainDomain: "Électricien",
        providerKind: "artisan",
        workModes: ["presentiel", "hybride"],
        coverageZones: ["Porto-Novo"],
        currency: "XOF",
        // Onglet Domaines : les compétences sont désormais la SEULE liste du profil. Les
        // « services proposés », retirés le 2026-09-23, en étaient une seconde sous un autre
        // nom — deux façons de déclarer la même chose, donc deux façons de diverger.
        tags: ["Câblage", "Tableau électrique", "Prises"],
      }),
    );
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.providerKind).toBe("artisan");
    expect(profile?.tags).toEqual(["Câblage", "Tableau électrique", "Prises"]);
    expect(profile?.workModes).toEqual(["presentiel", "hybride"]);
    expect(profile?.coverageZones).toEqual(["Porto-Novo"]);
  });

  it("n'accepte plus les champs retirés : les envoyer ne les écrit pas", async () => {
    as(prestataireId);
    const res = await saveProfile(
      json("http://localhost/api/profile", {
        mainDomain: "Électricien",
        // Un client qui enverrait encore l'ancien modèle ne doit pas pouvoir le ressusciter.
        subSpecialty: "Installation électrique",
        offeredServices: ["Installation électrique résidentielle"],
      }),
    );
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.subSpecialty).toBeNull();
    expect(profile?.offeredServices).toEqual([]);
  });
});

// ── Le métier du catalogue (2026-09-23) ─────────────────────────────────
//
// `mainDomain` porte le libellé du métier, comme `Mission.domaine`. Un libellé ne dit pas de
// quelle catégorie il vient : la cascade du formulaire se rouvrait vide, et le profil ne
// pouvait plus être reclassé proprement. Ces tests verrouillent les trois règles qui font que
// la clé étrangère tient lieu de source : elle est ÉCRITE, elle COMMANDE le libellé, et un
// métier qui n'existe pas est un refus — jamais un enregistrement à moitié fait.
describe("profil : métier du catalogue (clé étrangère)", () => {
  let metier: { id: string; libelle: string } | null = null;

  beforeAll(async () => {
    metier = await prisma.metier.findFirst({
      select: { id: true, libelle: true },
      orderBy: { id: "asc" },
    });
  });

  it("enregistre la CLÉ et dérive le libellé du catalogue, pas celui de l'écran", async () => {
    as(prestataireId);
    const res = await saveProfile(
      json("http://localhost/api/profile", {
        metierId: metier!.id,
        // Volontairement faux : c'est le catalogue qui fait foi. Sans cette dérivation, un
        // écran (ou un appel direct) pouvait inscrire un métier de fantaisie que le
        // rapprochement n'aurait jamais pu atteindre.
        mainDomain: "Métier inventé par l'écran",
      }),
    );
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.metierId).toBe(metier!.id);
    expect(profile?.mainDomain).toBe(metier!.libelle);
  });

  it("refuse un métier inconnu, et n'écrit rien", async () => {
    as(prestataireId);
    const res = await saveProfile(
      json("http://localhost/api/profile", {
        metierId: "metier-qui-nexiste-pas",
        mainDomain: "Métier inventé",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "metier_not_found" });
    // Un refus ne doit rien laisser derrière lui : ni la clé refusée, ni le libellé qui
    // l'accompagnait.
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.metierId).toBe(metier!.id);
    expect(profile?.mainDomain).toBe(metier!.libelle);
  });

  it("laisse le métier intact quand un AUTRE onglet s'enregistre", async () => {
    as(prestataireId);
    // Le formulaire de l'onglet Localisation ne connaît pas le métier : son corps JSON ne
    // porte aucune de ces deux clés, et l'absence doit laisser les colonnes telles quelles.
    const res = await saveProfile(json("http://localhost/api/profile", { zoneVille: "Abomey-Calavi" }));
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.metierId).toBe(metier!.id);
    expect(profile?.mainDomain).toBe(metier!.libelle);
    expect(profile?.zoneVille).toBe("Abomey-Calavi");
  });

  it("crée le profil sur la seule clé du métier, sans libellé envoyé", async () => {
    fkUserId = (await makeUser("fk", "artisan")).id;
    as(fkUserId);
    // Le sélecteur de la cascade envoie les deux, mais l'exigence doit porter sur le libellé
    // EFFECTIF : la clé suffit à le produire.
    const res = await saveProfile(json("http://localhost/api/profile", { metierId: metier!.id }));
    expect(res.status).toBe(200);
    const created = await prisma.profile.findFirst({ where: { userId: fkUserId } });
    expect(created?.mainDomain).toBe(metier!.libelle);
    expect(created?.metierId).toBe(metier!.id);
  });

  it("ne devine AUCUN métier pour un profil qui n'en a jamais choisi", async () => {
    // Les profils antérieurs au 2026-09-23 n'ont que leur libellé. Aucun backfill ne peut
    // retrouver d'où il venait — l'inventer serait pire que l'absence, puisque la cascade
    // rouvrirait sur une catégorie fausse.
    const legacy = await makeUser("legacy", "artisan");
    as(legacy.id);
    const res = await saveProfile(json("http://localhost/api/profile", { mainDomain: "Plombier" }));
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findFirst({ where: { userId: legacy.id } });
    expect(profile?.mainDomain).toBe("Plombier");
    expect(profile?.metierId).toBeNull();
    await prisma.profile.deleteMany({ where: { userId: legacy.id } });
    await prisma.user.delete({ where: { id: legacy.id } });
  });
});

describe("complétion du profil prestataire", () => {
  it("refuse un appel non authentifié", async () => {
    as(null);
    expect((await completion()).status).toBe(401);
  });

  it("renvoie 0 % sans profil, sans tomber en erreur", async () => {
    as(clientId);
    const body = await (await completion()).json();
    expect(body.percent).toBe(0);
    expect(body.hasProfile).toBe(false);
    expect(body.total).toBe(5);
  });

  it("compte les sections complètes, et seulement celles-là", async () => {
    as(prestataireId);
    const body = await (await completion()).json();
    // Domaines (métier + 3 compétences) et Localisation sont en place ;
    // Présentation n'a ni type, ni photo, ni bio de 40 caractères.
    const byKey = Object.fromEntries(body.sections.map((s: { key: string; done: boolean }) => [s.key, s.done]));
    expect(byKey.domaines).toBe(true);
    expect(byKey.localisation).toBe(true);
    expect(byKey.presentation).toBe(false);
    // 30 + 15 = 45 : la somme des poids des sections complètes, pas un ratio de critères.
    expect(body.percent).toBe(45);
    expect(body.missing).toContain("Photo de profil");
  });

  it("s'ouvre dès qu'un diplôme et une expérience sont déclarés", async () => {
    const declaration = await prisma.professionalDeclaration.create({
      data: {
        profileId,
        declarationType: "qualification",
        declarationTextSnapshot: "test",
        currentHash: `e2e-onboard-${RUN}`,
      },
    });
    await prisma.declaredDiploma.create({
      data: { declarationId: declaration.id, qualificationName: "CAP Électricien", isStateIssued: true },
    });
    const xp = await prisma.declaredExperience.create({
      data: { declarationId: declaration.id, role: "Électricien", clientType: "COMPANY" },
    });
    expect(xp.id).toBeTruthy();
    await prisma.profile.update({ where: { id: profileId }, data: { declaredExperienceYears: 8 } });

    as(prestataireId);
    const body = await (await completion()).json();
    const experience = body.sections.find((s: { key: string }) => s.key === "experience");
    expect(experience.done).toBe(true);
    expect(body.percent).toBe(65);
  });
});

describe("KYC financier — compte de versement Mobile Money", () => {
  it("renvoie un état vide mais complet quand rien n'est renseigné", async () => {
    as(prestataireId);
    const body = await (await payoutGet()).json();
    expect(body.status).toBe("non_renseigne");
    expect(body.ready).toBe(false);
    expect(body.identityReady).toBe(false);
    expect(body.addressProof).toBeNull();
  });

  it("exige un justificatif de domicile appartenant au demandeur", async () => {
    as(prestataireId);
    const res = await payoutPost(
      json("http://localhost/api/kyc/payout", {
        operator: "mtn",
        number: "+229 96 12 34 56",
        holder: "Koffi Adjovi",
        addressProofDocId: "doc-inexistant",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("address_proof_required");
  });

  it("refuse un numéro manifestement invalide", async () => {
    as(prestataireId);
    const res = await payoutPost(
      json("http://localhost/api/kyc/payout", {
        operator: "mtn",
        number: "12",
        holder: "Koffi Adjovi",
        addressProofDocId: "peu-importe",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("refuse un opérateur hors catalogue", async () => {
    as(prestataireId);
    const res = await payoutPost(
      json("http://localhost/api/kyc/payout", {
        operator: "wave",
        number: "+22996123456",
        holder: "Koffi Adjovi",
        addressProofDocId: "peu-importe",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("n'accepte pas un dossier financier sur une identité incomplète", async () => {
    const proof = await prisma.kycDocument.create({
      data: { userId: prestataireId, type: "justificatif_domicile", filePath: "kyc-docs/test.pdf" },
    });
    as(prestataireId);
    const res = await payoutPost(
      json("http://localhost/api/kyc/payout", {
        operator: "mtn",
        number: "+22996123456",
        holder: "Koffi Adjovi",
        addressProofDocId: proof.id,
      }),
    );
    // Le dossier financier RÉFÉRENCE l'identité, il ne la remplace pas.
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("identity_required");
  });

  it("enregistre le dossier quand l'identité est complète, et le met en instruction", async () => {
    await prisma.kycDocument.createMany({
      data: (
        ["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"] as const
      ).map((type) => ({ userId: prestataireId, type, filePath: `kyc-docs/${type}.jpg` })),
    });
    const proof = await prisma.kycDocument.findFirst({
      where: { userId: prestataireId, type: "justificatif_domicile" },
    });
    as(prestataireId);
    const res = await payoutPost(
      json("http://localhost/api/kyc/payout", {
        operator: "celtiis",
        number: "+229 96 12 34 56",
        holder: "Koffi Adjovi",
        addressProofDocId: proof!.id,
      }),
    );
    expect(res.status).toBe(201);
    const account = await prisma.payoutAccount.findUnique({ where: { userId: prestataireId } });
    expect(account?.status).toBe("en_attente");
    expect(account?.operator).toBe("celtiis");
    // Le numéro est stocké tel que saisi : le reformater risquerait de casser un préfixe local.
    expect(account?.number).toBe("+229 96 12 34 56");

    const body = await (await payoutGet()).json();
    expect(body.identityReady).toBe(true);
    expect(body.ready).toBe(false);
  });

  it("le justificatif de domicile ne fait PAS retomber l'état d'identité du compte", async () => {
    // Le dossier financier a son propre statut : un justificatif en attente ne doit pas
    // invalider une identité déjà vérifiée.
    const user = await prisma.user.findUnique({ where: { id: prestataireId }, select: { kycStatus: true } });
    expect(user?.kycStatus).not.toBe("verifie"); // aucun document n'a été validé ici
    const { deriveKycStatus } = await import("@/lib/kyc-status");
    const docs = await prisma.kycDocument.findMany({ where: { userId: prestataireId } });
    // 5 documents déposés, 4 d'identité : la dérivation ne regarde que ces quatre-là.
    expect(docs).toHaveLength(5);
    expect(deriveKycStatus(docs)).toBe("en_attente");
  });
});

describe("décisions admin", () => {
  it("n'expose pas les files à un utilisateur ordinaire", async () => {
    as(prestataireId);
    expect((await badgeQueue()).status).toBe(403);
  });

  it("ouvre la LECTURE des files au superviseur — une file illisible n'est pas une file vide", async () => {
    as(superviseurId);
    const res = await badgeQueue();
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).items)).toBe(true);
  });

  it("refuse au superviseur le GESTE d'accorder un badge (lire n'est pas agir)", async () => {
    as(superviseurId);
    const res = await badgeDecision(json("http://localhost/x", { decision: "accorde" }), params(prestataireId));
    expect(res.status).toBe(403);
  });

  it("refuse d'instruire un badge sans demande en attente", async () => {
    as(adminId);
    const res = await badgeDecision(json("http://localhost/x", { decision: "accorde" }), params(prestataireId));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_pending_request");
  });

  it("exige un motif pour refuser, et l'écrit", async () => {
    await prisma.profile.update({
      where: { id: profileId },
      data: { badgeStatus: "en_attente", badgeRequestedAt: new Date() },
    });
    as(adminId);
    const sansMotif = await badgeDecision(json("http://localhost/x", { decision: "refuse" }), params(prestataireId));
    expect(sansMotif.status).toBe(400);

    const res = await badgeDecision(
      json("http://localhost/x", { decision: "refuse", refusalReason: "Diplôme illisible" }),
      params(prestataireId),
    );
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.badgeStatus).toBe("refuse");
    expect(profile?.badgeDecidedAt).toBeInstanceOf(Date);
    expect(profile?.badgeRefusalReason).toBe("Diplôme illisible");
  });

  it("accorde le badge et le date", async () => {
    await prisma.profile.update({
      where: { id: profileId },
      data: { badgeStatus: "en_attente", badgeRequestedAt: new Date(), badgeRefusalReason: null },
    });
    as(adminId);
    const res = await badgeDecision(json("http://localhost/x", { decision: "accorde" }), params(prestataireId));
    expect(res.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.badgeStatus).toBe("accorde");
    // Un accord efface le motif de refus précédent : le garder laisserait un profil « accordé »
    // avec un motif de refus affiché à côté.
    expect(profile?.badgeRefusalReason).toBeNull();
  });

  it("un accord est tracé dans l'audit admin", async () => {
    const log = await prisma.adminAuditLog.findFirst({
      where: { adminId, action: "badge_decision", targetId: profileId },
    });
    expect(log).not.toBeNull();
    expect(log?.justification.length).toBeGreaterThan(0);
  });

  it("vérifie un compte de versement, puis refuse une seconde instruction", async () => {
    as(adminId);
    const res = await payoutDecision(json("http://localhost/x", { decision: "verifie" }), params(prestataireId));
    expect(res.status).toBe(200);
    const account = await prisma.payoutAccount.findUnique({ where: { userId: prestataireId } });
    expect(account?.status).toBe("verifie");
    expect(account?.reviewedById).toBe(adminId);

    const again = await payoutDecision(json("http://localhost/x", { decision: "verifie" }), params(prestataireId));
    expect(again.status).toBe(409);
  });

  it("une modification du compte de versement repasse le dossier en instruction", async () => {
    const proof = await prisma.kycDocument.findFirst({
      where: { userId: prestataireId, type: "justificatif_domicile" },
    });
    as(prestataireId);
    const res = await payoutPost(
      json("http://localhost/api/kyc/payout", {
        operator: "mtn",
        number: "+22997000000",
        holder: "Koffi Adjovi",
        addressProofDocId: proof!.id,
      }),
    );
    expect(res.status).toBe(201);
    // Une validation portait sur un numéro précis : elle ne vaut pas pour le suivant.
    const account = await prisma.payoutAccount.findUnique({ where: { userId: prestataireId } });
    expect(account?.status).toBe("en_attente");
    expect(account?.reviewedById).toBeNull();
  });
});
