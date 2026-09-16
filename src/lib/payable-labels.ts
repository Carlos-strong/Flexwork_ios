import { prisma } from "@/lib/db";

// Libellé lisible d'une créance (Payable). Un payable pointe sa source par identifiant — jalon,
// relevé de présence, retenue, médiation… — et deux écrans au moins doivent le dire en clair : le
// compte du séquestre des parties et la console financière admin. Une seule écriture, deux
// lectures groupées quel que soit le nombre de lignes.

export type LabelablePayable = { sourceType: string; sourceId: string };

const DATE_FR = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });

export async function buildPayableLabeler(payables: LabelablePayable[]) {
  const jalonIds = [...new Set(payables.filter((p) => p.sourceType === "jalon").map((p) => p.sourceId))];
  const attendanceIds = [...new Set(payables.filter((p) => p.sourceType === "attendance").map((p) => p.sourceId))];

  const [jalons, releves] = await Promise.all([
    jalonIds.length
      ? prisma.jalon.findMany({ where: { id: { in: jalonIds } }, select: { id: true, ordre: true, titre: true } })
      : [],
    attendanceIds.length
      ? prisma.attendance.findMany({ where: { id: { in: attendanceIds } }, select: { id: true, periodStart: true } })
      : [],
  ]);
  const jalonById = new Map(jalons.map((j) => [j.id, j]));
  const releveById = new Map(releves.map((r) => [r.id, r]));

  return (p: LabelablePayable, missionTitle: string): string => {
    switch (p.sourceType) {
      case "jalon": {
        const j = jalonById.get(p.sourceId);
        return j ? `Jalon ${j.ordre} — ${j.titre}` : "Jalon";
      }
      case "attendance": {
        const r = releveById.get(p.sourceId);
        return r ? `Relevé du ${DATE_FR(r.periodStart)}` : "Relevé de présence";
      }
      case "retention":
        return "Retenue de garantie";
      case "mediation":
        return "Résolution de médiation";
      case "gig_order":
        return "Commande Gig";
      case "mission":
        return missionTitle;
      default:
        return "Versement";
    }
  };
}
