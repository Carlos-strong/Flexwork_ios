import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login, seedOtp, typeOtp } from "./support/auth";
import { prisma } from "./support/db";
import { waitForOtp } from "./support/mailpit";

// B — Inscription, OTP et connexion (PLAN_TESTS_GLOBAL.md).

const uniq = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 10);

test.describe("B — inscription et connexion", () => {
  test("B-03 le code reçu par e-mail active le compte et mène à /bienvenue", async ({ page }) => {
    const n = uniq();
    const email = `pw-signup-${n}@e2e.flexwork.test`;
    await page.goto("/signup");
    await page.getByRole("button", { name: "Créer un compte" }).click();
    await page.locator("#firstname").fill("Koffi");
    await page.locator("#lastname").fill("Inscrit");
    await page.locator("#city").fill("Cotonou");
    await page.locator("#phone").fill(`9${n}`.slice(0, 8));
    await page.locator("#email").fill(email);
    await page.locator("input[name=cgvAccepted]").check();
    const envoi = new Date(Date.now() - 1000);
    await page.locator("form button[type=submit]").click();

    await expect(page).toHaveURL(/verify-otp/);
    const code = await waitForOtp(email, envoi);
    await typeOtp(page, code);
    await expect(page).toHaveURL(/\/bienvenue/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).not.toBeNull();
    expect(user.role).toBe("client");
  });

  test("B-04 un code faux est refusé, l'utilisateur reste sur la saisie du code", async ({ page }) => {
    const user = await createUser({ label: "otpfaux" });
    const vrai = await seedOtp(user);
    const faux = vrai === "111111" ? "222222" : "111111";
    await page.goto(`/verify-otp?identifier=${encodeURIComponent(user.email)}&purpose=login`);
    await typeOtp(page, faux);
    await expect(page.getByText("Code incorrect", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/verify-otp/);
  });

  test("B-05 /bienvenue : « client » mène au tableau de bord client", async ({ page }) => {
    const user = await createUser({ label: "bvclient" });
    await login(page, user);
    await page.goto("/bienvenue");
    await page.getByRole("radio", { name: /Je cherche un prestataire/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/\/client\/dashboard/);
  });

  test("B-05 /bienvenue : « prestataire » mène à la qualification de la filière", async ({ page }) => {
    const user = await createUser({ label: "bvpresta" });
    await login(page, user);
    await page.goto("/bienvenue");
    await page.getByRole("radio", { name: /Je propose mes services/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/\/devenir-prestataire/);
  });

  test("B-06 connexion par OTP puis déconnexion", async ({ page }) => {
    const user = await createUser({ label: "login" });
    const envoi = new Date(Date.now() - 1000);
    await page.goto("/signin");
    await page.locator("input[name=email]").fill(user.email);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/verify-otp/);
    await typeOtp(page, await waitForOtp(user.email, envoi));
    await expect(page).toHaveURL(/\/client\/dashboard/);

    const session = await (await page.request.get("/api/auth/session")).json();
    expect(session?.user?.email).toBe(user.email);

    // Déconnexion : la page protégée renvoie de nouveau vers /signin.
    const csrf = (await (await page.request.get("/api/auth/csrf")).json()).csrfToken;
    await page.request.post("/api/auth/signout", { form: { csrfToken: csrf } });
    await page.goto("/client/dashboard");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("B-07 déconnexion réelle : un cookie de session réécrit après coup ne rouvre rien ; les autres appareils restent connectés", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const user = await createUser({ label: "revoke" });
    const sessionCookie = async (p: typeof page) =>
      (await p.context().cookies()).find((c) => c.name.endsWith("authjs.session-token"));

    // Deux appareils connectés au même compte.
    await login(page, user);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await login(otherPage, user);

    const stolen = await sessionCookie(page);
    expect(stolen).toBeTruthy();

    // Déconnexion par le vrai bouton du tableau de bord.
    await page.goto("/client/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Déconnexion" }).first().click();
    await expect(page).toHaveURL(/localhost:\d+\/$/, { timeout: 30_000 });

    // Le cas réel : une réponse /api/auth/session en vol (ou une copie du cookie) remet
    // l'ancien cookie en place. Il doit être refusé côté serveur.
    await page.context().addCookies([stolen!]);
    const session = await (await page.request.get("/api/auth/session")).json();
    expect(session?.user ?? null).toBeNull();
    await page.goto("/client/dashboard");
    await expect(page).toHaveURL(/\/signin/, { timeout: 30_000 });
    // …et le serveur efface ce cookie mort.
    await expect.poll(async () => (await sessionCookie(page))?.value ?? null).not.toBe(stolen!.value);

    // L'autre appareil n'est pas déconnecté.
    const otherSession = await (await otherPage.request.get("/api/auth/session")).json();
    expect(otherSession?.user?.email).toBe(user.email);
    await other.close();
  });

  test("B-06 un identifiant inconnu est refusé avant toute génération d'OTP", async ({ page }) => {
    await page.goto("/signin");
    await page.locator("input[name=email]").fill(`inconnu-${uniq()}@e2e.flexwork.test`);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("Aucun compte n'est associé à cet identifiant.", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);
  });

  // ── Validation des codes et erreurs de connexion (2026-11-09) ────────────────────────────
  // Chaque refus a son message et son issue ; la saisie refusée est effacée.
  const verifyUrl = (email: string, extra = "") =>
    `/verify-otp?identifier=${encodeURIComponent(email)}&purpose=login${extra}`;
  const typeAndExpectAlert = async (p: import("@playwright/test").Page, code: string, text: string | RegExp) => {
    await typeOtp(p, code);
    await expect(p.getByRole("alert").filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
  };

  test("B-08 code faux : message précis, cases vidées ; le bon code connecte ensuite", async ({ page }) => {
    const user = await createUser({ label: "otpbad" });
    const code = await seedOtp(user);
    await page.goto(verifyUrl(user.email));
    const wrong = code === "999999" ? "999998" : "999999";
    await typeAndExpectAlert(page, wrong, "Code incorrect");
    await expect(page.getByRole("link", { name: "Créer un compte" })).toHaveCount(0);
    for (let i = 1; i <= 6; i++) await expect(page.getByLabel(`Chiffre ${i} sur 6`)).toHaveValue("");
    await typeOtp(page, code);
    await expect(page).toHaveURL(/\/client\/dashboard/, { timeout: 30_000 });
  });

  test("B-09 code expiré : message, renvoi immédiat, et le nouveau code (reçu par email) connecte", async ({ page }) => {
    const user = await createUser({ label: "otpexp" });
    const code = await seedOtp(user);
    await prisma.otpCode.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await page.goto(verifyUrl(user.email));
    await typeAndExpectAlert(page, code, "Ce code a expiré");
    const resend = page.getByRole("button", { name: "Renvoyer par email" });
    await expect(resend).toBeEnabled();
    const envoi = new Date(Date.now() - 1000);
    await resend.click();
    await expect(page.getByRole("status").filter({ hasText: "Un nouveau code a été envoyé." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Ce code a expiré" })).toHaveCount(0);
    await typeOtp(page, await waitForOtp(user.email, envoi));
    await expect(page).toHaveURL(/\/client\/dashboard/, { timeout: 30_000 });
  });

  test("B-10 cinq essais : le code est bloqué, même le bon ; il faut en demander un nouveau", async ({ page }) => {
    const user = await createUser({ label: "otpmax" });
    const code = await seedOtp(user);
    await prisma.otpCode.updateMany({ where: { userId: user.id }, data: { attempts: 5 } });
    await page.goto(verifyUrl(user.email));
    await typeAndExpectAlert(page, code, "Trop d'essais avec ce code");
    await expect(page.getByRole("button", { name: "Renvoyer par email" })).toBeEnabled();
    await expect(page).toHaveURL(/verify-otp/);
  });

  test("B-11 compte suspendu après l'envoi du code : connexion refusée, message clair", async ({ page }) => {
    const user = await createUser({ label: "otpsusp" });
    const code = await seedOtp(user);
    await prisma.user.update({ where: { id: user.id }, data: { status: "suspended" } });
    await page.goto(verifyUrl(user.email));
    await typeAndExpectAlert(page, code, "Ce compte est désactivé");
    await expect(page).toHaveURL(/verify-otp/);
    // Et la demande de code depuis /signin le dit aussi.
    await page.goto("/signin");
    await page.locator("input[name=email]").fill(user.email);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("Ce compte est désactivé. Contactez le support.")).toBeVisible();
  });

  test("B-12 adresse saisie en MAJUSCULES : le compte est retrouvé et la connexion aboutit", async ({ page }) => {
    const user = await createUser({ label: "otpcase" });
    const envoi = new Date(Date.now() - 1000);
    await page.goto("/signin");
    await page.locator("input[name=email]").fill(`  ${user.email.toUpperCase()} `);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/verify-otp/);
    await typeOtp(page, await waitForOtp(user.email, envoi));
    await expect(page).toHaveURL(/\/client\/dashboard/, { timeout: 30_000 });
  });

  test("B-13 lien incomplet ou envoi échoué : l'écran le dit au lieu d'attendre un code", async ({ page }) => {
    await page.goto("/verify-otp?purpose=login");
    await expect(page.getByRole("alert").filter({ hasText: "Lien incomplet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Valider le code/ })).toBeDisabled();

    const user = await createUser({ label: "otpnosent" });
    await page.goto(`/verify-otp?identifier=${encodeURIComponent(user.email)}&purpose=signup&sent=0`);
    await expect(page.getByRole("status").filter({ hasText: "Le code n'a pas pu être envoyé" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Renvoyer par email" })).toBeEnabled();
  });

  test("B-14 serveur injoignable : message réseau, le bouton ne reste pas bloqué", async ({ page }) => {
    const user = await createUser({ label: "otpnet" });
    const code = await seedOtp(user);
    await page.goto(verifyUrl(user.email));
    await page.route("**/api/auth/callback/otp**", (route) => route.abort("internetdisconnected"));
    await typeAndExpectAlert(page, code, "Connexion au serveur impossible");
    await expect(page.getByRole("button", { name: /Valider le code/ })).toBeEnabled();
    // Le code saisi est conservé (rien à retaper) ; réseau rétabli, « Valider » connecte.
    for (let i = 0; i < 6; i++) await expect(page.getByLabel(`Chiffre ${i + 1} sur 6`)).toHaveValue(code[i]);
    await page.unroute("**/api/auth/callback/otp**");
    await page.getByRole("button", { name: /Valider le code/ }).click();
    await expect(page).toHaveURL(/\/client\/dashboard/, { timeout: 30_000 });

    // Même chose sur /signin.
    await page.context().clearCookies();
    await page.goto("/signin");
    await page.route("**/api/auth/login/request-otp", (route) => route.abort("internetdisconnected"));
    await page.locator("input[name=email]").fill(user.email);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("Connexion au serveur impossible")).toBeVisible();
  });
});
