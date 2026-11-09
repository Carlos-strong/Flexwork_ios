import { expect, type Page } from "@playwright/test";

// Missions et candidatures créées par les VRAIES routes (POST /api/missions, POST .../proposals),
// sous la session de la page : les mêmes garde-fous (KYC, plafonds, secteur) s'appliquent qu'à
// l'écran. Les écrans de publication et de candidature ont leurs propres tests vitest (F, G).

let seq = 0;

export async function publishMission(
  page: Page,
  opts: { titre?: string; budget?: number; domaine?: string; professionalType?: string } = {}
): Promise<{ id: string; titre: string; status: string }> {
  seq += 1;
  const titre = opts.titre ?? `Refonte du site vitrine — pw ${Date.now()}-${seq}`;
  const res = await page.request.post("/api/missions", {
    data: {
      titre,
      description: "Refonte complète du site vitrine : maquettes, intégration responsive et mise en ligne.",
      domaine: opts.domaine ?? "design",
      mode: "distance",
      budgetType: "FIXED",
      budget: opts.budget ?? 150_000,
      currency: "XOF",
      delaiJours: 20,
      professionalType: opts.professionalType ?? "EXPERT_DIGITAL",
      status: "publiee",
    },
  });
  expect(res.ok(), `publication refusée : ${await res.text()}`).toBe(true);
  const body = await res.json();
  return { id: body.id ?? body.mission?.id, titre, status: body.status ?? body.mission?.status };
}

export async function applyTo(page: Page, missionId: string, montant = 140_000): Promise<string> {
  const res = await page.request.post(`/api/missions/${missionId}/proposals`, {
    data: { montant, message: "Disponible immédiatement, portfolio sur demande.", financingModeKey: "F2" },
  });
  expect(res.ok(), `candidature refusée : ${await res.text()}`).toBe(true);
  return (await res.json()).id;
}
