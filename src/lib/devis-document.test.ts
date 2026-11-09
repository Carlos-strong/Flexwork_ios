import { describe, expect, it } from "vitest";
import { buildDevisDocument, dateExpiration, devisReference, type DevisDocumentInput } from "@/lib/devis-document";
import type { DevisData } from "@/lib/devis";

const DEVIS: DevisData = {
  lineItems: [
    { description: "Maquettage des pages", quantity: 1, unit: "forfait", unitPrice: 300000, total: 300000, echeance: "S2" },
    { description: "  ", quantity: 2, unit: "jour", unitPrice: 100000, total: 200000 },
  ],
  laborCost: 0,
  totalHT: 500000,
  tva: 0,
  totalTTC: 500000,
  tvaRate: 0,
  delay: "14 jours (2 semaines)",
  notes: "Références similaires disponibles.",
};

// `toLocaleString("fr-FR")` sépare les milliers par une espace FINE INSÉCABLE (U+202F), pas
// par une espace ordinaire. Comparer à un littéral tapé au clavier échoue alors sur une
// différence invisible à la lecture du diff. On normalise donc les espaces avant d'assertir —
// ce que fait aussi `sanitize` côté PDF, Helvetica ne portant pas ce caractère.
function money(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

function input(over: Partial<DevisDocumentInput> = {}): DevisDocumentInput {
  return {
    proposalId: "cmtygrv7c000q9wya0cpsgeo6",
    missionTitre: "Refonte site vitrine",
    missionDescription: "Refonte complète.",
    devise: "XOF",
    devis: DEVIS,
    definitif: true,
    valideLe: new Date("2026-09-12T10:00:00Z"),
    round: 2,
    roundsMax: 3,
    validiteJours: 30,
    client: { name: "Rivoli Hazael", adresse: "Cotonou, BJ", tel: "+22996158656", email: "client@x.bj", roleLabel: "Client" },
    provider: { name: "Canon Roger", adresse: "Cotonou, BJ", tel: "+22921368741", email: "p@x.bj", roleLabel: "Expert digital" },
    ...over,
  };
}

describe("devisReference", () => {
  it("reprend la forme courte du contrat : 8 caractères en majuscules", () => {
    expect(devisReference("cmtygrv7c000q9wya0cpsgeo6")).toBe("CMTYGRV7");
  });
});

describe("dateExpiration", () => {
  it("ajoute les jours de validité à la date de validation", () => {
    expect(dateExpiration(new Date("2026-09-12T10:00:00Z"), 30).toISOString().slice(0, 10)).toBe("2026-10-12");
  });
});

describe("buildDevisDocument — lignes", () => {
  it("numérote sur deux chiffres et reprend chaque poste", () => {
    const doc = buildDevisDocument(input());
    expect(doc.lines.map((l) => l.numero)).toEqual(["01", "02"]);
    expect(doc.lines[0].description).toBe("Maquettage des pages");
    expect(money(doc.lines[0].montant)).toBe("300 000 XOF");
    expect(doc.lines[0].echeance).toBe("S2");
  });

  it("nomme un poste laissé vide plutôt que d'afficher une case blanche", () => {
    // Une ligne sans description reste une ligne facturée : la taire sur la pièce
    // justificative laisserait un montant sans objet.
    expect(buildDevisDocument(input()).lines[1].description).toBe("Poste 2");
  });

  it("remplace une échéance absente par un tiret, jamais par du vide", () => {
    expect(buildDevisDocument(input()).lines[1].echeance).toBe("—");
  });
});

describe("buildDevisDocument — totaux", () => {
  it("n'affiche la main d'œuvre que si elle est chiffrée", () => {
    const sans = buildDevisDocument(input());
    expect(sans.totals.map((t) => t.label)).not.toContain("Main d'œuvre");

    const avec = buildDevisDocument(input({ devis: { ...DEVIS, laborCost: 50000, totalHT: 550000, totalTTC: 550000 } }));
    expect(avec.totals[0].label).toBe("Main d'œuvre");
    expect(money(avec.totals[0].value)).toBe("50 000 XOF");
  });

  it("met en avant le seul total qui engage : le TTC", () => {
    const doc = buildDevisDocument(input());
    const ttc = doc.totals.find((t) => t.label === "Total TTC");
    expect(money(ttc!.value)).toBe("500 000 XOF");
    expect(ttc!.emphasis).toBe(true);
    expect(doc.totals.filter((t) => t.emphasis)).toHaveLength(1);
  });

  it("reprend le taux de TVA réel dans le libellé", () => {
    const doc = buildDevisDocument(input({ devis: { ...DEVIS, tvaRate: 18, tva: 90000, totalTTC: 590000 } }));
    expect(doc.totals.find((t) => t.label.startsWith("TVA"))?.label).toBe("TVA (18 %)");
  });
});

describe("buildDevisDocument — état du document", () => {
  it("un devis validé s'intitule « Devis définitif » et date la validation", () => {
    const doc = buildDevisDocument(input());
    expect(doc.titre).toBe("Devis définitif");
    expect(doc.mention).toContain("validé par le client le 12 septembre 2026");
    expect(doc.mention).toContain("round 2 sur 3");
    expect(doc.conditions.map((c) => c.label)).toContain("Validité du prix");
  });

  it("un devis validé SANS date connue reste définitif et tait simplement la date", () => {
    // Propositions antérieures à l'ajout de `devisValideAt` : l'état vient du statut, jamais
    // de la présence d'une date — sinon la pièce affirmerait l'inverse de la réalité.
    const doc = buildDevisDocument(input({ valideLe: null }));
    expect(doc.titre).toBe("Devis définitif");
    expect(doc.mention).toContain("validé par le client,");
    expect(doc.conditions.map((c) => c.label)).not.toContain("Validité du prix");
  });

  it("un devis non validé annonce qu'il n'engage personne", () => {
    const doc = buildDevisDocument(input({ definitif: false, valideLe: null }));
    expect(doc.titre).toBe("Devis en négociation");
    expect(doc.mention).toContain("n'engage aucune des parties");
    expect(doc.mentionsLegales.at(-1)).toContain("Il ne fixe aucun prix");
  });

  it("la mention finale d'un devis définitif distingue le prix arrêté de l'engagement contractuel", () => {
    expect(buildDevisDocument(input()).mentionsLegales.at(-1)).toContain("ne vaut pas contrat");
  });
});

describe("buildDevisDocument — parties", () => {
  it("porte l'identité et les coordonnées des deux parties", () => {
    const doc = buildDevisDocument(input());
    expect(doc.client.name).toBe("Rivoli Hazael");
    expect(doc.provider.name).toBe("Canon Roger");
    expect(doc.client.lines.map((l) => l.label)).toEqual(["Qualité", "Adresse", "Téléphone", "E-mail"]);
    expect(doc.provider.lines.find((l) => l.label === "E-mail")?.value).toBe("p@x.bj");
  });
});
