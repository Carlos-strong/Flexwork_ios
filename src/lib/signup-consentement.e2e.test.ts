/**
 * Inscription : ce que le compte exige, et ce qu'il n'exige plus (2026-09-23).
 *
 * Deux champs étaient affichés au formulaire sans être honorés côté serveur :
 *
 *   - le mot de passe, haché et stocké alors que l'auth est 100 % OTP — retiré ;
 *   - le consentement CGU, envoyé puis jeté par le parsing zod — désormais exigé et horodaté.
 *
 * Ce fichier verrouille les deux, sur la vraie base.
 */

import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST as signup } from "@/app/api/auth/signup/route";

const RUN = Date.now();
const emails: string[] = [];

const account = (suffix: string) => {
  const email = `e2e-signup-${RUN}-${suffix}@flexwork.test`;
  emails.push(email);
  return {
    email,
    // Téléphone unique par cas : `tel` est @unique, deux cas ne peuvent pas le partager.
    tel: `+2299${String(RUN).slice(-6)}${suffix}`,
    firstname: "Koffi",
    lastname: "Adjovi",
    country: "BJ",
    city: "Cotonou",
    role: "client",
  };
};

const post = (body: unknown) =>
  signup(
    new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.otpCode.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.otpRequestAttempt.deleteMany({ where: { identifier: { in: emails } } });
});

describe("consentement CGU", () => {
  it("refuse la création d'un compte sans consentement", async () => {
    const res = await post(account("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_payload");
  });

  it("refuse un consentement explicitement refusé", async () => {
    const res = await post({ ...account("2"), cgvAccepted: false });
    expect(res.status).toBe(400);
  });

  it("horodate le consentement à la création — la preuve, pas seulement la case cochée", async () => {
    const data = account("3");
    const before = new Date();
    const res = await post({ ...data, cgvAccepted: true });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    expect(user?.cgvAcceptedAt).toBeInstanceOf(Date);
    expect(user!.cgvAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe("plus de mot de passe", () => {
  it("crée le compte sans en réclamer un", async () => {
    const data = account("4");
    const res = await post({ ...data, cgvAccepted: true });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    expect(user).not.toBeNull();
    expect(user?.passwordHash).toBeNull();
  });

  it("ignore un mot de passe qu'un client obsolète enverrait encore", async () => {
    const data = account("5");
    // Un onglet ouvert avant le déploiement poste encore l'ancien payload : il ne doit ni
    // échouer, ni faire réapparaître un hash que plus rien ne sait utiliser.
    const res = await post({ ...data, password: "motdepasse-tres-long", cgvAccepted: true });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    expect(user?.passwordHash).toBeNull();
  });
});

describe("ce que l'inscription enregistre", () => {
  it("ne garde que l'identité, le contact et la localisation — rien du profil différé", async () => {
    const data = account("6");
    await post({ ...data, cgvAccepted: true });

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { clientProfile: true, profiles: true },
    });
    expect(user?.firstname).toBe("Koffi");
    expect(user?.city).toBe("Cotonou");
    // Le profil est complété plus tard, jamais à l'inscription.
    expect(user?.clientProfile).toBeNull();
    expect(user?.profiles).toEqual([]);
    // Le KYC ne se déclenche qu'au moment où il est requis.
    expect(user?.kycStatus).toBe("en_attente");
  });

  it("laisse le compte repreneur après un abandon de l'OTP", async () => {
    const data = account("7");
    await post({ ...data, cgvAccepted: true });
    // Le compte existe avant toute vérification : l'utilisateur qui ferme l'onglet à
    // l'étape 2 retrouve son compte en demandant un code de connexion.
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    expect(user?.status).toBe("active");
    expect(user?.emailVerified).toBeNull();
    expect(await prisma.otpCode.count({ where: { userId: user!.id, purpose: "signup" } })).toBe(1);
  });
});

// Le formulaire ne comporte plus de sélecteur de rôle (2026-09-23, décision « Option C ») :
// l'usage se déclare APRÈS la création du compte, sur l'écran P4. Ces deux tests verrouillent
// ce qui pourrait silencieusement revenir — un compte qui naît prestataire, ou une inscription
// qui ouvrirait l'espace prestataire sans que personne ne l'ait demandé.
describe("rôle à l'inscription — « Option C »", () => {
  it("ouvre le compte en CLIENT quand le formulaire n'envoie aucun rôle", async () => {
    const { role: _roleRetire, ...data } = account("8");
    const res = await post({ ...data, cgvAccepted: true });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    expect(user?.role).toBe("client");
    expect(user?.isProvider).toBe(false);
    expect(user?.providerActivatedAt).toBeNull();
  });

  it("ne pose JAMAIS le drapeau prestataire, même si un rôle est posté", async () => {
    // Le schéma accepte encore un `role` explicite (l'API restera le chemin des rôles
    // particuliers — `responsable_chantier` est en sourdine dans cette attente). Mais le
    // droit d'exercer ne s'obtient pas en le déclarant : seul /api/profile/become-provider
    // pose `isProvider`. Un onglet resté ouvert sur l'ancien formulaire ne peut donc pas
    // créer un prestataire par surprise.
    const data = account("9");
    const res = await post({ ...data, role: "artisan", cgvAccepted: true });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    expect(user?.role).toBe("artisan");
    expect(user?.isProvider).toBe(false);
    expect(user?.providerActivatedAt).toBeNull();
  });
});
