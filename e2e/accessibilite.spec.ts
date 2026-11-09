import { expect, test, type Page } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";
import { prisma } from "./support/db";

// V-04 — Navigation clavier et lecteur d'écran sur l'inscription et la publication
// (PLAN_TESTS_GLOBAL.md). Trois exigences :
// - chaque champ, bouton et groupe de choix porte un nom lisible par un lecteur d'écran ;
// - chaque élément atteint par Tab montre un indicateur de focus (WCAG 2.4.7) et reste à l'écran ;
// - le parcours se termine au clavier seul (inscription), ou s'enchaîne au clavier (publication).

const uniq = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 10);

/** Désactive les transitions : l'indicateur de focus se lit tout de suite, pas à mi-chemin. */
async function sansTransitions(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
}

/**
 * Éléments sans nom accessible dans la racine : champs sans étiquette (le placeholder ne compte
 * pas), boutons sans texte ni aria-label, boutons bascule (aria-pressed) hors d'un groupe nommé —
 * « Urgente, bouton bascule » ne dit pas de quoi il s'agit.
 */
async function sansNom(page: Page, racine: string): Promise<string[]> {
  return page.locator(racine).first().evaluate((root) => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const nomPar = (ids: string | null) =>
      (ids ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join("").trim();
    const nom = (e: Element) => {
      const aria = e.getAttribute("aria-label")?.trim() || nomPar(e.getAttribute("aria-labelledby"));
      if (aria) return aria;
      const labels = (e as HTMLInputElement).labels;
      if (labels && [...labels].some((l) => l.textContent?.trim())) return "label";
      if (e.matches("button, a")) {
        const imgs = [...e.querySelectorAll("img[alt]")].map((i) => i.getAttribute("alt")).join("");
        return (e.textContent?.trim() || imgs || e.getAttribute("title") || "").trim();
      }
      return e.getAttribute("title")?.trim() ?? "";
    };
    const decrire = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.getAttribute("name") ? `[name=${e.getAttribute("name")}]` : ""} « ${(e.textContent ?? "").trim().slice(0, 30)} »`;

    const fautes: string[] = [];
    for (const e of root.querySelectorAll("input:not([type=hidden]), select, textarea, button, a[href]")) {
      if (!visible(e)) continue;
      if (!nom(e)) fautes.push(`sans nom : ${decrire(e)}`);
    }
    for (const e of root.querySelectorAll("[aria-pressed]")) {
      if (!visible(e)) continue;
      const groupe = e.closest("[role=group], [role=radiogroup], fieldset");
      const nomGroupe = groupe && (groupe.matches("fieldset") ? groupe.querySelector("legend")?.textContent?.trim() : nom(groupe));
      if (!nomGroupe) fautes.push(`bascule hors d'un groupe nommé : ${decrire(e)}`);
    }
    return fautes;
  });
}

type Focus = { desc: string; id: string; type: string; tag: string; text: string; dansRacine: boolean; indicateur: boolean; aLEcran: boolean };

/**
 * Parcourt la racine au clavier, de `depart` jusqu'à la sortie de la racine. L'indicateur de focus
 * est constaté en comparant le style de l'élément et de ses deux ancêtres (un champ téléphone
 * montre son focus sur son cadre, `focus-within`) avec leur style sans focus.
 */
async function parcourirAuClavier(page: Page, racine: string, depart: string, surFocus?: (f: Focus) => Promise<void>): Promise<Focus[]> {
  await page.evaluate((racine) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const sig = (e: Element) => {
      const parts: string[] = [];
      for (let n: Element | null = e, i = 0; n && i < 3; n = n.parentElement, i++) {
        const s = getComputedStyle(n);
        parts.push(`${s.outlineStyle}/${s.outlineWidth}/${s.outlineColor}|${s.boxShadow}|${s.borderColor}`);
      }
      return parts.join(" ; ");
    };
    const base = new Map<Element, string>();
    for (const e of document.querySelector(racine)!.querySelectorAll("*")) base.set(e, sig(e));
    (window as unknown as Record<string, unknown>).__pwFocus = { base, sig };
  }, racine);
  await page.locator(depart).first().focus();

  const vus: Focus[] = [];
  for (let i = 0; i < 80; i++) {
    const f = await page.evaluate((racine): Focus => {
      const { base, sig } = (window as unknown as { __pwFocus: { base: Map<Element, string>; sig: (e: Element) => string } }).__pwFocus;
      const e = document.activeElement!;
      const r = e.getBoundingClientRect();
      const avant = base.get(e);
      return {
        desc: `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""} « ${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)} »`,
        id: e.id,
        type: (e as HTMLInputElement).type ?? "",
        tag: e.tagName.toLowerCase(),
        text: (e.textContent ?? "").trim(),
        dansRacine: !!document.querySelector(racine)?.contains(e) && e !== document.body,
        // Élément apparu après la mesure de référence : pas de comparaison possible, on le
        // tient pour conforme plutôt que d'inventer une référence. Champ date : son dernier arrêt
        // de tabulation est le bouton calendrier, dans le shadow DOM du navigateur — le champ ne
        // répond plus à `:focus`, et l'anneau, dessiné par Chrome, échappe aux styles de la page.
        indicateur: avant === undefined || sig(e) !== avant || (e.matches("input[type=date]") && !e.matches(":focus")),
        aLEcran: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      };
    }, racine);
    if (!f.dansRacine) break;
    vus.push(f);
    if (surFocus) await surFocus(f);
    await page.keyboard.press("Tab");
  }
  return vus;
}

function verifierFocus(vus: Focus[], etape: string) {
  expect(vus.length, `${etape} : rien n'est atteignable au clavier`).toBeGreaterThan(0);
  expect.soft(vus.filter((f) => !f.indicateur).map((f) => f.desc), `${etape} : focus invisible`).toEqual([]);
  expect.soft(vus.filter((f) => !f.aLEcran).map((f) => f.desc), `${etape} : focus hors écran`).toEqual([]);
}

test.describe("V-04 — clavier et lecteur d'écran", () => {
  test("inscription : champs nommés, focus visible, envoi au clavier seul", async ({ page }) => {
    const n = uniq();
    const email = `pw-clavier-${n}@e2e.flexwork.test`;
    await page.goto("/signup");
    await sansTransitions(page);

    // Écran d'accueil : on atteint « Créer un compte » par Tab, on l'active par Entrée.
    let trouve = false;
    for (let i = 0; i < 40 && !trouve; i++) {
      await page.keyboard.press("Tab");
      trouve = await page.evaluate(() => document.activeElement?.textContent?.trim() === "Créer un compte");
    }
    expect(trouve, "« Créer un compte » inatteignable au clavier").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("#firstname")).toBeVisible();

    expect.soft(await sansNom(page, "form")).toEqual([]);

    // Saisie au clavier pendant le parcours : chaque champ est rempli quand Tab l'atteint.
    const valeurs: Record<string, string> = {
      firstname: "Koffi",
      lastname: "Clavier",
      city: "Cotonou",
      phone: `9${n}`.slice(0, 8),
      email,
    };
    let envoi: Focus | undefined;
    const vus = await parcourirAuClavier(page, "form", "#firstname", async (f) => {
      if (valeurs[f.id]) await page.keyboard.type(valeurs[f.id]);
      if (f.type === "checkbox") await page.keyboard.press("Space");
      if (f.type === "submit") envoi = f;
    });
    verifierFocus(vus, "inscription");
    for (const id of Object.keys(valeurs)) expect(vus.map((f) => f.id), `#${id} hors du parcours clavier`).toContain(id);
    expect(envoi, "bouton d'envoi inatteignable au clavier").toBeDefined();

    await page.locator("form button[type=submit]").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/verify-otp/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ firstname: "Koffi", lastname: "Clavier" });
    expect(user.cgvAcceptedAt).not.toBeNull();

    // Saisie du code : six cases nommées « Chiffre n sur 6 » (src/app/verify-otp/page.tsx).
    expect.soft(await sansNom(page, "body")).toEqual([]);
  });

  test("publication : chaque étape nommée et parcourable, « Continuer » au clavier", async ({ page }) => {
    const client = await createUser({ label: "cliclavier" });
    await login(page, client);
    await page.goto("/missions/new");
    await sansTransitions(page);
    await expect(page.getByText("Étape 1 sur 4")).toBeVisible();

    // Racine : le bloc du tunnel, de la progression jusqu'aux boutons d'action.
    await page.evaluate(() => {
      const etape = [...document.querySelectorAll("span")].find((s) => /^Étape \d sur 4$/.test(s.textContent ?? ""))!;
      let n: Element | null = etape;
      while (n && ![...n.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Continuer")) n = n.parentElement;
      n!.setAttribute("data-pw-tunnel", "");
    });
    const racine = "[data-pw-tunnel]";
    const continuer = page.getByRole("button", { name: "Continuer" });

    // Étape 1 — les listes se choisissent comme à l'écran ; ce qui est vérifié ici, c'est ce que
    // le clavier et le lecteur d'écran en perçoivent.
    // Le libellé d'une option commence par l'icône de la catégorie : choix par valeur.
    const choisir = async (select: string, libelle: string) => {
      await expect(page.locator(select)).toBeEnabled();
      const option = page.locator(`${select} option`, { hasText: libelle });
      await page.locator(select).selectOption((await option.getAttribute("value"))!);
    };
    await choisir("#categorieId", "Administration et Gestion");
    await choisir("#metierId", "Comptabilité");
    const competences = page.locator(`${racine} button[aria-pressed]`).filter({ hasNotText: /Normale|Urgente/ });
    await expect(competences.first()).toBeVisible();
    await competences.first().focus();
    await page.keyboard.press("Space");
    await expect(competences.first()).toHaveAttribute("aria-pressed", "true");
    await page.locator("#titre").fill("Tenue de la comptabilité trimestrielle — clavier");
    await page.locator("#description").fill("Saisie des pièces, rapprochements bancaires et préparation des déclarations du trimestre.");

    const etapes: { nom: string; remplir?: () => Promise<void> }[] = [
      { nom: "Décrire" },
      {
        nom: "Lieu et dates",
        remplir: async () => {
          await page.getByRole("button", { name: /^À distance/ }).focus();
          await page.keyboard.press("Enter");
          await page.locator("#delaiJours").fill("15");
        },
      },
      {
        nom: "Rémunération",
        remplir: async () => {
          await page.getByRole("button", { name: /^Prix fixe/ }).focus();
          await page.keyboard.press("Enter");
          await page.locator("#amount").fill("250000");
        },
      },
      { nom: "Récapitulatif" },
    ];

    for (const [i, etape] of etapes.entries()) {
      await test.step(etape.nom, async () => {
        await expect(page.getByText(`Étape ${i + 1} sur 4`)).toBeVisible();
        if (etape.remplir) await etape.remplir();
        expect.soft(await sansNom(page, racine), `${etape.nom} : éléments sans nom`).toEqual([]);
        verifierFocus(await parcourirAuClavier(page, racine, `${racine} button`), etape.nom);
        if (i < etapes.length - 1) {
          await continuer.focus();
          await expect(continuer).toBeEnabled();
          await page.keyboard.press("Enter");
        }
      });
    }

    await page.getByRole("button", { name: "Publier la mission" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/missions\/new/, { timeout: 30_000 });
    const mission = await prisma.mission.findFirstOrThrow({ where: { clientId: client.id }, orderBy: { createdAt: "desc" } });
    expect(mission).toMatchObject({ titre: "Tenue de la comptabilité trimestrielle — clavier", status: "publiee" });
  });
});
