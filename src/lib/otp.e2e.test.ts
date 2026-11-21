import crypto from "crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// L'envoi d'email est simulé : on contrôle s'il réussit, et on lit le code envoyé.
const mail = vi.hoisted(() => ({
  delivered: true,
  sent: [] as { to: string; subject: string }[],
}));
vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn(async (p: { to: string; subject: string }) => {
    mail.sent.push(p);
    return { delivered: mail.delivered };
  }),
}));

import { prisma } from "@/lib/db";
import { normalizeIdentifier, requestOtp, verifyOtp } from "@/lib/otp";
import { otpErrorView, otpScreenError, resendMessage } from "@/lib/otp-messages";
import { POST as requestOtpRoute } from "@/app/api/auth/login/request-otp/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";

// Validation des codes OTP et gestion des erreurs de connexion (2026-11-09).
const RUN = crypto.randomBytes(4).toString("hex");
const userIds: string[] = [];
const emails: string[] = [];
let n = 0;

async function makeUser(status: "active" | "suspended" = "active") {
  const email = `otp-${RUN}-${++n}@test.local`;
  const u = await prisma.user.create({
    data: { email, tel: `+2290${RUN.slice(0, 4).replace(/\D/g, "1")}${String(n).padStart(4, "0")}`, status },
  });
  userIds.push(u.id);
  emails.push(email);
  return u;
}

const hash = (c: string) => crypto.createHash("sha256").update(c).digest("hex");
async function seedCode(userId: string, code: string, opts: { purpose?: "login" | "signup"; expiresInMs?: number; attempts?: number; createdAt?: Date } = {}) {
  return prisma.otpCode.create({
    data: {
      userId,
      identifier: "x",
      channel: "email",
      purpose: opts.purpose ?? "login",
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 5 * 60_000)),
      attempts: opts.attempts ?? 0,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

let ipSeq = 0;
function post(handler: (r: Request) => Promise<Response>, body: unknown) {
  // IP distincte par appel : la limite par IP ne doit pas interférer avec les autres cas.
  const ip = `10.${RUN.charCodeAt(0) % 250}.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  return handler(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mail.delivered = true;
  mail.sent.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `otp-${RUN}-` } } });
  await prisma.otpRequestAttempt.deleteMany({ where: { identifier: { contains: `otp-${RUN}-` } } });
});

describe("vérification d'un code (verifyOtp)", () => {
  it("accepte le bon code une seule fois", async () => {
    const u = await makeUser();
    await seedCode(u.id, "123456");
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "123456" })).toEqual({ ok: true });
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "123456" })).toEqual({ ok: false, reason: "no_pending_otp" });
  });

  it("refuse un code faux, puis bloque le code après 5 essais — même le bon", async () => {
    const u = await makeUser();
    await seedCode(u.id, "123456");
    for (let i = 0; i < 5; i++) {
      expect(await verifyOtp({ userId: u.id, purpose: "login", code: "000000" })).toEqual({ ok: false, reason: "invalid_code" });
    }
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "123456" })).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("le bon code au 5ᵉ essai passe encore", async () => {
    const u = await makeUser();
    await seedCode(u.id, "123456", { attempts: 4 });
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "123456" })).toEqual({ ok: true });
  });

  it("des essais SIMULTANÉS ne dépassent jamais 5 (pas de course sur le compteur)", async () => {
    const u = await makeUser();
    const otp = await seedCode(u.id, "123456");
    const guesses = Array.from({ length: 20 }, (_, i) => String(200000 + i));
    const results = await Promise.all(guesses.map((code) => verifyOtp({ userId: u.id, purpose: "login", code })));
    expect(results.filter((r) => !r.ok && r.reason === "invalid_code")).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === "too_many_attempts")).toHaveLength(15);
    expect((await prisma.otpCode.findUniqueOrThrow({ where: { id: otp.id } })).attempts).toBe(5);
  });

  it("deux soumissions simultanées du bon code n'en valident qu'une", async () => {
    const u = await makeUser();
    await seedCode(u.id, "123456");
    const results = await Promise.all([1, 2, 3].map(() => verifyOtp({ userId: u.id, purpose: "login", code: "123456" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuse un code expiré", async () => {
    const u = await makeUser();
    await seedCode(u.id, "123456", { expiresInMs: -1000 });
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "123456" })).toEqual({ ok: false, reason: "expired" });
  });

  it("seul le DERNIER code émis compte : l'ancien est invalide", async () => {
    const u = await makeUser();
    await seedCode(u.id, "111111", { createdAt: new Date(Date.now() - 60_000) });
    await seedCode(u.id, "222222");
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "111111" })).toEqual({ ok: false, reason: "invalid_code" });
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "222222" })).toEqual({ ok: true });
  });

  it("un code d'inscription ne connecte pas en « connexion », et inversement", async () => {
    const u = await makeUser();
    await seedCode(u.id, "123456", { purpose: "signup" });
    expect(await verifyOtp({ userId: u.id, purpose: "login", code: "123456" })).toEqual({ ok: false, reason: "no_pending_otp" });
    expect(await verifyOtp({ userId: u.id, purpose: "signup", code: "123456" })).toEqual({ ok: true });
  });

  it("un code d'un autre compte ne sert à rien", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await seedCode(a.id, "123456");
    expect(await verifyOtp({ userId: b.id, purpose: "login", code: "123456" })).toEqual({ ok: false, reason: "no_pending_otp" });
  });
});

describe("émission d'un code (requestOtp)", () => {
  it("envoie un code à six chiffres, haché en base, valable 5 minutes", async () => {
    const u = await makeUser();
    await requestOtp({ userId: u.id, identifier: u.email, channel: "email", purpose: "login" });
    const code = mail.sent.at(-1)!.subject.match(/(\d{6})$/)![1];
    const row = await prisma.otpCode.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.codeHash).toBe(hash(code));
    expect(row.codeHash).not.toContain(code);
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(4.9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });

  it("en production, un email non délivré est une ERREUR (plus d'attente d'un code jamais parti)", async () => {
    const u = await makeUser();
    mail.delivered = false;
    vi.stubEnv("NODE_ENV", "production");
    await expect(requestOtp({ userId: u.id, identifier: u.email, channel: "email", purpose: "login" })).rejects.toThrow();
  });
});

describe("identifiant canonique", () => {
  it("adresse en minuscules sans espaces ; numéro sans espaces", () => {
    expect(normalizeIdentifier("  Awa.Diallo@Mail.COM ")).toBe("awa.diallo@mail.com");
    expect(normalizeIdentifier(" +229 97 00 11 22 ")).toBe("+22997001122");
  });
});

describe("POST /api/auth/login/request-otp", () => {
  it("retrouve le compte quelle que soit la casse de l'adresse saisie", async () => {
    const u = await makeUser();
    const res = await post(requestOtpRoute, { identifier: `  ${u.email.toUpperCase()} ` });
    expect(res.status).toBe(200);
    expect(mail.sent.at(-1)!.to).toBe(u.email);
  });

  it("identifiant inconnu : 404 account_not_found, aucun code créé", async () => {
    const res = await post(requestOtpRoute, { identifier: `otp-${RUN}-inconnu@test.local` });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("account_not_found");
    expect(mail.sent).toHaveLength(0);
  });

  it("compte suspendu : 403 account_inactive, aucun code envoyé", async () => {
    const u = await makeUser("suspended");
    const res = await post(requestOtpRoute, { identifier: u.email });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("account_inactive");
    expect(await prisma.otpCode.count({ where: { userId: u.id } })).toBe(0);
  });

  it("corps invalide ou usage inconnu : 400", async () => {
    for (const body of ["pas du json", { identifier: "ab" }, { identifier: "a@b.co", purpose: "reset" }]) {
      const res = await post(requestOtpRoute, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("6ᵉ demande en 15 minutes : 429, y compris en changeant la casse", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) {
      expect((await post(requestOtpRoute, { identifier: i % 2 ? u.email.toUpperCase() : u.email })).status).toBe(200);
    }
    const res = await post(requestOtpRoute, { identifier: u.email.toUpperCase() });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("too_many_requests");
  });

  it("renvoi en inscription : le code est créé pour l'usage « signup »", async () => {
    const u = await makeUser();
    expect((await post(requestOtpRoute, { identifier: u.email, purpose: "signup" })).status).toBe(200);
    expect((await prisma.otpCode.findFirstOrThrow({ where: { userId: u.id } })).purpose).toBe("signup");
  });

  it("email non délivré (production) : 500 otp_send_failed", async () => {
    const u = await makeUser();
    mail.delivered = false;
    vi.stubEnv("NODE_ENV", "production");
    const res = await post(requestOtpRoute, { identifier: u.email });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("otp_send_failed");
  });
});

describe("POST /api/auth/signup", () => {
  const payload = (email: string, tel: string) => ({ email, tel, cgvAccepted: true, firstname: "Awa" });

  it("enregistre l'adresse en minuscules et le numéro sans espaces", async () => {
    const email = `OTP-${RUN}-Signup1@Test.Local`;
    const res = await post(signupRoute, payload(` ${email} `, `+229 61 ${RUN.slice(0, 2).replace(/\D/g, "3")} 00 01`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(email.toLowerCase());
    expect(body.otpSent).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: body.userId } });
    userIds.push(u.id);
    expect(u.email).toBe(email.toLowerCase());
    expect(u.tel).not.toMatch(/\s/);
  });

  it("email du code non délivré : le compte est créé quand même, otpSent=false (l'écran propose le renvoi)", async () => {
    mail.delivered = false;
    vi.stubEnv("NODE_ENV", "production");
    const res = await post(signupRoute, payload(`otp-${RUN}-signup2@test.local`, `+22962${RUN.slice(0, 2).replace(/\D/g, "4")}0002`));
    expect(res.status).toBe(200);
    const body = await res.json();
    userIds.push(body.userId);
    expect(body.otpSent).toBe(false);
  });

  it("adresse déjà prise, même en majuscules : 409 account_already_exists", async () => {
    const u = await makeUser();
    const res = await post(signupRoute, payload(u.email.toUpperCase(), "+22963000099"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("account_already_exists");
  });
});

describe("messages de l'écran /verify-otp", () => {
  it("traduit chaque refus en message précis, avec l'action qui débloque", () => {
    expect(otpScreenError({ error: "CredentialsSignin", code: "expired" })).toBe("expired");
    expect(otpScreenError({ error: "CredentialsSignin", code: "too_many_attempts" })).toBe("too_many_attempts");
    expect(otpScreenError({ error: "CredentialsSignin", code: "account_inactive" })).toBe("account_inactive");
    // Code inconnu d'Auth.js (« credentials » par défaut) : on reste sur « code incorrect ».
    expect(otpScreenError({ error: "CredentialsSignin", code: "credentials" })).toBe("invalid_code");
    // Toute autre erreur Auth.js est une panne serveur.
    expect(otpScreenError({ error: "Configuration" })).toBe("server");
    expect(otpScreenError(undefined)).toBe("server");

    expect(otpErrorView("expired", "login").resendNow).toBe(true);
    expect(otpErrorView("too_many_attempts", "login").resendNow).toBe(true);
    expect(otpErrorView("invalid_code", "login")).toMatchObject({ resendNow: false, offerSignup: false });
    expect(otpErrorView("account_not_found", "login").offerSignup).toBe(true);
    expect(otpErrorView("account_not_found", "signup").offerSignup).toBe(false);
    expect(resendMessage({ ok: false, error: "network" }).ok).toBe(false);
    expect(resendMessage({ ok: true }).ok).toBe(true);
  });
});
