/**
 * Séparation des pouvoirs : le registre et les gardes d'API doivent dire la même chose.
 *
 * `src/lib/admin-roles.ts` décide de ce que chaque rôle VOIT (sa sidebar) et de ce qu'il peut
 * FAIRE (les boutons affichés). Les gardes `requireAdminRole` / `requireAnyAdminRole` décident de
 * ce que le serveur ACCEPTE. Si les deux divergent, on obtient soit un bouton qui échoue en 403,
 * soit — bien pire — un pouvoir que l'interface cache mais que l'API accorde.
 *
 * Ce test lit le SOURCE de chaque route et compare sa garde, méthode par méthode, à ce que le
 * registre déclare. Il échoue aussi sur toute route d'administration gardée par le seul
 * `requireAdmin()`, qui ouvre un geste à n'importe quel rôle.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { AdminRole } from "@prisma/client";
import {
  ADMIN_MODULES,
  ADMIN_ROLES,
  activeModuleForRole,
  canActInModule,
  canOpenPath,
  modulesForRole,
  spacesForRole,
} from "@/lib/admin-roles";

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "src/app");

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Rôles acceptés par la garde d'une méthode, lus dans le source. `"*"` = `requireAdmin()` seul. */
function guardOf(route: string, method: Method): AdminRole[] | "*" | null {
  // Une route qui commence par « / » est relative à src/app/api (routes reprises de
  // flexwork_job hors de /api/admin : /api/categories, /api/services).
  const dir = route.startsWith("/") ? path.join(APP, "api", route) : path.join(APP, "api/admin", route);
  const source = readFileSync(path.join(dir, "route.ts"), "utf8");
  const start = source.search(new RegExp(`export async function ${method}\\b`));
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/export async function /);
  const body = next < 0 ? rest : rest.slice(0, next);

  const single = body.match(/requireAdminRole\("([a-z]+)"\)/);
  if (single) return [single[1] as AdminRole];
  const many = body.match(/requireAnyAdminRole\(\[([^\]]*)\]\)/);
  if (many) return [...many[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1] as AdminRole);
  if (/requireFrontendEditor\(\)/.test(body)) return ["frontend"];
  if (/requireFrontendReader\(\)/.test(body)) return ["frontend", "superviseur"];
  if (/requireAdmin\(\)/.test(body)) return "*";
  return null;
}

const sorted = (roles: readonly AdminRole[]) => [...roles].sort();

function moduleById(id: string) {
  const entry = ADMIN_MODULES.find((m) => m.id === id);
  if (!entry) throw new Error(`rubrique inconnue : ${id}`);
  return entry;
}

/** Rôles qui peuvent AGIR dans la rubrique (sous-rubrique comprise). */
function actors(moduleId: string, subId?: string): AdminRole[] {
  return ADMIN_ROLES.filter((r) => canActInModule(moduleId, r, subId));
}

/** Rôles qui VOIENT la rubrique. */
function readers(moduleId: string): AdminRole[] {
  return [...moduleById(moduleId).roles];
}

/**
 * Pour chaque rubrique : les routes qu'elle lit (garde = ses lecteurs, ou un sous-ensemble
 * déclaré) et celles où elle agit (garde = exactement ses acteurs).
 */
const CONTRACT: {
  module: string;
  sub?: string;
  reads?: { route: string; method: Method; roles?: AdminRole[] }[];
  acts?: { route: string; method: Method }[];
}[] = [
  { module: "utilisateurs", reads: [{ route: "users", method: "GET" }], acts: [{ route: "users/[id]/status", method: "POST" }] },
  {
    module: "kyc",
    reads: [
      { route: "kyc/queue", method: "GET" },
      { route: "kyc/history", method: "GET" },
    ],
    acts: [
      { route: "kyc/[userId]/decision", method: "POST" },
      { route: "kyc/[userId]/documents/[docId]/decision", method: "POST" },
      { route: "kyc/[userId]/documents/[docId]/revoke", method: "POST" },
      { route: "users/[id]", method: "DELETE" },
    ],
  },
  {
    module: "validation",
    reads: [
      { route: "garants/queue", method: "GET" },
      { route: "kyc/garant-accounts", method: "GET" },
    ],
    acts: [
      { route: "garants/[id]/decision", method: "POST" },
      { route: "kyc/[userId]/garant-requirement", method: "POST" },
    ],
  },
  {
    module: "missions",
    reads: [
      { route: "missions/kanban", method: "GET" },
      // Sous-rubrique « Anti-collusion » : superviseur seul.
      { route: "fraud/collusion", method: "GET", roles: ["superviseur"] },
    ],
  },
  { module: "litiges", reads: [{ route: "mediations/queue", method: "GET" }], acts: [{ route: "mediations/[id]/propose", method: "POST" }] },
  {
    module: "contrats",
    reads: [{ route: "contracts", method: "GET" }],
    acts: [
      { route: "contracts/[contractId]/refund", method: "POST" },
      { route: "contracts/[contractId]/retention/settle", method: "POST" },
    ],
  },
  {
    module: "paiements",
    reads: [
      { route: "finance", method: "GET" },
      { route: "finance/payables", method: "GET" },
      { route: "finance/psp-journal", method: "GET" },
    ],
    acts: [
      { route: "finance/residual-sweep", method: "POST" },
      { route: "finance/payables/[payableId]/reinstruct", method: "POST" },
    ],
  },
  {
    module: "signalements",
    reads: [
      { route: "reports", method: "GET" },
      { route: "declarations", method: "GET" },
    ],
    acts: [
      { route: "reports/[id]/decision", method: "POST" },
      { route: "declarations/[id]/remove", method: "POST" },
    ],
  },
  { module: "queues", reads: [{ route: "queues", method: "GET" }] },
  { module: "finance", reads: [{ route: "finance", method: "GET" }] },
  {
    module: "localisation",
    // Les paliers de risque ont quitté cette rubrique le 2026-09-24 : ils sont portés par le
    // MÉTIER (`Metier.riskLevel`) et se règlent donc dans « Taxonomie », dont les écritures
    // `/api/categories` sont déjà gardées et vérifiées ci-dessous. La route
    // `/api/admin/domain-risk` n'existe plus — la laisser ici ne testerait plus rien.
    reads: [{ route: "country-age-requirements", method: "GET" }],
    acts: [{ route: "country-age-requirements", method: "POST" }],
  },
  { module: "parametres", sub: "parametres-filieres", reads: [{ route: "feature-flags", method: "GET" }], acts: [{ route: "feature-flags", method: "POST" }] },
  // Lecture publique, comme dans flexwork_job (le catalogue sert aux formulaires publics) :
  // seules les écritures sont gardées.
  //
  // `POST`/`PUT` /api/categories portent aussi le PALIER DE RISQUE du métier depuis le
  // 2026-09-24 : c'est bien le rôle `frontend` qui le fixe, et la garde vérifiée ici est celle
  // qui protège cette décision.
  {
    module: "taxonomie",
    acts: [
      { route: "/categories", method: "POST" },
      { route: "/categories", method: "PUT" },
      { route: "/categories", method: "DELETE" },
      { route: "/services", method: "POST" },
      { route: "/services", method: "PUT" },
      { route: "/services", method: "DELETE" },
    ],
  },
  { module: "roles", reads: [{ route: "roles", method: "GET" }] },
  { module: "audit", reads: [{ route: "audit", method: "GET" }] },
  { module: "reporting", reads: [{ route: "reporting/[dataset]", method: "GET" }] },
];

describe("registre ↔ gardes d'API", () => {
  for (const c of CONTRACT) {
    const subReaders = c.sub ? ADMIN_ROLES.filter((r) => canOpenPath(r, moduleById(c.module).children!.find((s) => s.id === c.sub)!.href)) : null;

    for (const r of c.reads ?? []) {
      it(`${c.module} — ${r.method} /api/admin/${r.route} est lisible par exactement ses lecteurs`, () => {
        const guard = guardOf(r.route, r.method);
        expect(guard, `aucune garde trouvée`).not.toBeNull();
        expect(guard, `garde générique requireAdmin() : ouverte à tous les rôles`).not.toBe("*");
        const expected = r.roles ?? subReaders ?? readers(c.module);
        expect(sorted(guard as AdminRole[])).toEqual(sorted(expected));
      });
    }

    for (const a of c.acts ?? []) {
      it(`${c.module} — ${a.method} /api/admin/${a.route} n'est ouvert qu'aux rôles qui y agissent`, () => {
        const guard = guardOf(a.route, a.method);
        expect(guard, `aucune garde trouvée`).not.toBeNull();
        expect(guard, `garde générique requireAdmin() : ouverte à tous les rôles`).not.toBe("*");
        expect(sorted(guard as AdminRole[])).toEqual(sorted(actors(c.module, c.sub)));
      });
    }
  }
});

describe("aucune route d'administration n'est ouverte à tous les rôles", () => {
  // Liste EXPLICITE et motivée des exceptions. Toute nouvelle route gardée par `requireAdmin()`
  // seul fait échouer ce test : il faut soit lui donner un rôle, soit la justifier ici.
  const ALLOWED_GENERIC: Record<string, string> = {
    // Chaque rôle lit SON tableau de bord ; le filtrage par rôle se fait dans la route.
    "dashboard:GET": "filtre les compteurs par rôle à l'intérieur de la route",
  };

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return routeFiles(full);
      return name === "route.ts" ? [full] : [];
    });
  }

  const files = routeFiles(path.join(APP, "api/admin"));

  it.each(files.map((f) => path.relative(path.join(APP, "api/admin"), path.dirname(f))))("/api/admin/%s", (route) => {
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"] as Method[]) {
      const guard = guardOf(route, method);
      if (guard === "*") {
        expect(ALLOWED_GENERIC[`${route}:${method}`], `${method} /api/admin/${route} n'exige aucun rôle précis`).toBeDefined();
      }
    }
  });
});

describe("chaque rubrique mène à un écran qui existe", () => {
  const routes = ADMIN_MODULES.flatMap((m) => [m.href, ...(m.children ?? []).map((c) => c.href).filter((h) => !h.startsWith("#"))]);

  it.each([...new Set(routes)])("%s", (href) => {
    expect(existsSync(path.join(APP, href.slice(1), "page.tsx"))).toBe(true);
  });
});

describe("règles du registre", () => {
  it("reprend les 21 rubriques de flexwork_job, plus « Contenu du site »", () => {
    const job = [
      "/admin", "/admin/utilisateurs", "/admin/kyc", "/admin/validation-utilisateurs", "/admin/missions", "/admin/disputes",
      "/admin/contrats", "/admin/paiements", "/admin/reports", "/admin/uma-recruiter", "/admin/queues",
      "/backoffice", "/backoffice/catalog", "/backoffice/locations", "/backoffice/finance", "/backoffice/settings",
      "/backoffice/roles", "/backoffice/audit", "/backoffice/reports",
    ];
    const kycChildren = ["/admin/kyc/entreprises", "/admin/kyc/freelances"];
    const hrefs = ADMIN_MODULES.flatMap((m) => [m.href, ...(m.children ?? []).map((c) => c.href)]);
    for (const h of [...job, ...kycChildren]) expect(hrefs, h).toContain(h);
    expect(ADMIN_MODULES.map((m) => m.id)).toContain("contenu");
  });

  it("chaque rôle a au moins une rubrique et un accueil qu'il peut ouvrir", () => {
    for (const role of ADMIN_ROLES) {
      expect(modulesForRole(role).length, role).toBeGreaterThan(0);
    }
  });

  it("aucun rôle ne cumule la médiation et la décision KYC", () => {
    for (const role of ADMIN_ROLES) {
      expect(canActInModule("litiges", role) && canActInModule("kyc", role), role).toBe(false);
    }
  });

  it("le superviseur n'agit sur aucun dossier de personne ni sur l'argent", () => {
    for (const id of ["utilisateurs", "kyc", "validation", "litiges", "contrats", "paiements", "signalements", "taxonomie", "contenu"]) {
      expect(canActInModule(id, "superviseur"), id).toBe(false);
    }
  });

  it("chaque geste a au plus un rôle titulaire", () => {
    // Les Dashboards n'offrent aucun geste : ils renvoient vers la rubrique qui le détient.
    const GESTURELESS = new Set(["dashboard", "bo-dashboard"]);
    for (const m of ADMIN_MODULES) {
      if (GESTURELESS.has(m.id)) continue;
      const scopes = m.children?.some((c) => c.roles || c.readOnly) ? m.children.map((c) => c.id) : [undefined];
      for (const sub of scopes) {
        const acting = ADMIN_ROLES.filter((r) => canActInModule(m.id, r, sub));
        expect(acting.length, `${m.id}${sub ? ` › ${sub}` : ""} : ${acting.join(", ")}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("l'éditeur du site ne voit que le Back Office", () => {
    expect(spacesForRole("frontend")).toEqual(["backoffice"]);
  });

  it("refuse une sous-rubrique réservée même quand la rubrique est ouverte", () => {
    expect(canOpenPath("frontend", "/backoffice/settings")).toBe(true);
    expect(canOpenPath("frontend", "/backoffice/settings/filieres")).toBe(false);
    expect(canOpenPath("superviseur", "/backoffice/settings/filieres")).toBe(true);
  });

  it("allume la rubrique la plus spécifique", () => {
    expect(activeModuleForRole("kyc", "/admin/kyc/historique")?.id).toBe("kyc");
    expect(activeModuleForRole("superviseur", "/admin/missions")?.id).toBe("missions");
    expect(activeModuleForRole("superviseur", "/admin")?.id).toBe("dashboard");
  });

  it("n'ouvre rien hors de ses rubriques", () => {
    expect(canOpenPath("kyc", "/admin/paiements")).toBe(false);
    expect(canOpenPath("moderation", "/backoffice/roles")).toBe(false);
    expect(canOpenPath("mediation", "/admin/utilisateurs")).toBe(false);
  });

  it("une rubrique indisponible ne donne aucun geste", () => {
    expect(canActInModule("uma", "superviseur")).toBe(false);
  });
});
