import { prisma } from "@/lib/db";

/**
 * Gating par pays/zone pour les prérequis juridiques bloquants du modèle v3
 * (etat-consolide-Flexwork.md §5) : signature électronique des contrats (Phase 4),
 * montage PSP (Phase 5), assurance à la mission (Phase 7). Un flag est désactivé par
 * défaut et ne doit JAMAIS être activé automatiquement par le code applicatif — seule une
 * action manuelle après confirmation du prérequis juridique correspondant peut l'activer.
 */
export async function isFeatureEnabledForZone(key: string, zone: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key_zone: { key, zone } } });
  return flag?.enabled ?? false;
}
