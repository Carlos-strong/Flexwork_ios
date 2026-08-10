import { prisma } from "@/lib/db";
import type { RiskLevel } from "@prisma/client";

// US-401/701 — le palier de risque et l'obligation d'assurance sont dérivés côté serveur
// depuis `DomainRiskLevel` au moment de la publication, jamais saisis par le client.
// Palier LOW par défaut si le domaine n'est pas encore classé — ne jamais bloquer
// silencieusement une publication sur un domaine manquant en base (modele-skillafrica-v3
// n'impose pas d'exhaustivité de la table au lancement).
export async function resolveMissionRisk(
  domaine: string,
  country: string
): Promise<{ riskLevel: RiskLevel; insuranceRequired: boolean }> {
  const entry = await prisma.domainRiskLevel.findUnique({
    where: { domain_country: { domain: domaine, country } },
  });

  if (!entry) {
    return { riskLevel: "low", insuranceRequired: false };
  }

  return { riskLevel: entry.riskLevel, insuranceRequired: entry.insuranceRequired };
}
