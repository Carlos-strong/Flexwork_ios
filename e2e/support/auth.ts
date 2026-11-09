import crypto from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { prisma } from "./db";
import type { TestUser } from "./accounts";

// Connexion par code (src/auth.ts) sans passer par la boîte mail : le code est écrit en base sous
// sa forme hachée, exactement comme `requestOtp` le ferait, puis saisi sur /verify-otp. Le parcours
// réel avec l'e-mail reçu est couvert à part (e2e/auth.spec.ts, B-03).
export async function seedOtp(user: TestUser, purpose: "login" | "signup" = "login"): Promise<string> {
  const code = String(100000 + crypto.randomInt(900000));
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      identifier: user.email,
      channel: "email",
      purpose,
      codeHash: crypto.createHash("sha256").update(code).digest("hex"),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  return code;
}

export async function typeOtp(page: Page, code: string) {
  // Six cases, avancée automatique et envoi à la sixième (src/app/verify-otp/page.tsx).
  await page.getByLabel("Chiffre 1 sur 6").click();
  await page.keyboard.type(code, { delay: 30 });
}

export async function login(page: Page, user: TestUser) {
  const code = await seedOtp(user);
  await page.goto(`/verify-otp?identifier=${encodeURIComponent(user.email)}&purpose=login`);
  await typeOtp(page, code);
  await expect(page).not.toHaveURL(/verify-otp/, { timeout: 30_000 });
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}
