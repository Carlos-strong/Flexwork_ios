import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Réinitialisation de la passphrase de signature protégée par OTP (2026-11-10) :
// le premier certificat se crée librement ; REMPLACER un certificat actif exige le code
// envoyé à l'e-mail du compte (src/lib/signature-reset.ts).

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as certificatePost } from "@/app/api/signature/certificate/route";
import { POST as resetOtpPost } from "@/app/api/signature/certificate/reset-otp/route";
import { maskEmail } from "@/lib/signature-reset";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const EMAIL = `sigreset-${RUN}@flexwork.test`;
let userId: string;

function authAs(id: string) {
  mockAuth.mockResolvedValue({ user: { id, email: EMAIL, name: "Testeur", role: "artisan" } });
}
function req(body?: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const certBody = (passphrase: string, otpCode?: string) => ({
  commonName: "Testeur Reset",
  email: EMAIL,
  passphrase,
  ...(otpCode ? { otpCode } : {}),
});
/** Le code part par e-mail : le test fixe sa valeur en base, sous sa forme hachée. */
async function setPendingCode(code: string) {
  const otp = await prisma.otpCode.findFirstOrThrow({
    where: { userId, purpose: "signature_reset", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  await prisma.otpCode.update({
    where: { id: otp.id },
    data: { codeHash: crypto.createHash("sha256").update(code).digest("hex") },
  });
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: EMAIL, tel: `+229${RUN}7`, role: "artisan", status: "active", kycStatus: "verifie" },
  });
  userId = u.id;
  authAs(userId);
});

afterAll(async () => {
  await prisma.otpRequestAttempt.deleteMany({ where: { identifier: EMAIL } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("certificat de signature — réinitialisation par OTP", () => {
  it("le code de réinitialisation est refusé sans certificat actif (rien à remplacer)", async () => {
    const res = await resetOtpPost(req());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_active_certificate");
  });

  it("le premier certificat se crée sans code", async () => {
    const res = await certificatePost(req(certBody("premiere-phrase")));
    expect(res.status).toBe(201);
  });

  it("remplacer le certificat actif sans code : 403 otp_required, l'ancien reste actif", async () => {
    const res = await certificatePost(req(certBody("nouvelle-phrase")));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("otp_required");
    expect(await prisma.digitalCertificate.count({ where: { userId, status: "ACTIVE" } })).toBe(1);
  });

  it("le code est envoyé à l'e-mail du compte, adresse masquée dans la réponse", async () => {
    const res = await resetOtpPost(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.destination).toBe(maskEmail(EMAIL));
    expect(body.destination).not.toBe(EMAIL);
  });

  it("mauvais code : 403, aucun certificat remplacé", async () => {
    await setPendingCode("123456");
    const before = await prisma.digitalCertificate.findFirstOrThrow({ where: { userId, status: "ACTIVE" } });
    const res = await certificatePost(req(certBody("nouvelle-phrase", "654321")));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("otp_invalid_code");
    const after = await prisma.digitalCertificate.findFirstOrThrow({ where: { userId, status: "ACTIVE" } });
    expect(after.id).toBe(before.id);
  });

  it("bon code : nouveau certificat, l'ancien est révoqué ; le code ne sert qu'une fois", async () => {
    const before = await prisma.digitalCertificate.findFirstOrThrow({ where: { userId, status: "ACTIVE" } });
    const res = await certificatePost(req(certBody("nouvelle-phrase", "123456")));
    expect(res.status).toBe(201);
    const active = await prisma.digitalCertificate.findMany({ where: { userId, status: "ACTIVE" } });
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(before.id);
    expect((await prisma.digitalCertificate.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("REVOKED");

    const replay = await certificatePost(req(certBody("encore-une-phrase", "123456")));
    expect(replay.status).toBe(403);
  });
});

describe("maskEmail", () => {
  it("garde les 2 premiers caractères et le domaine", () => {
    expect(maskEmail("prestataire@gmail.com")).toBe("pr*********@gmail.com");
    expect(maskEmail("ab@x.fr")).toBe("ab***@x.fr");
  });
});
