/**
 * Articles d'un contrat au TEMPS (S2, 2026-09-15).
 *
 * Ce que ce fichier verrouille : un contrat au temps ne parle ni de jalons ni d'acceptation
 * tacite. La plateforme n'applique l'acceptation tacite qu'aux livrables et aux jalons
 * (src/lib/tacit-acceptance.ts) ; la promettre sur des relevés de présence, ce serait signer une
 * règle que rien n'exécute — exactement le défaut que le §19 du cahier des charges demande de ne
 * pas laisser dans un contrat.
 */

import { describe, expect, it } from "vitest";
import { buildContractSections } from "@/lib/contract-clauses";

const TEMPS = {
  objet: "Maçon journalier",
  prix: 150_000,
  devise: "XOF",
  regimeRemuneration: "Taux (horaire/journalier)",
  jalons: null,
  conditionsTemps: { rateUnit: "day" as const, rate: 7_500, maxQuantity: 20, maxAmount: 150_000 },
};

function article(sections: ReturnType<typeof buildContractSections>, numero: number) {
  return sections.find((s) => s.title.startsWith(`Article ${numero} `))!;
}

// `toLocaleString("fr-FR")` sépare les milliers par une espace fine insécable (U+202F), pas une
// espace ordinaire : on compare le texte, pas la typographie.
const norm = (s: string) => s.replace(/\s/g, " ");

describe("contrat au temps — Articles 2 et 4", () => {
  const sections = buildContractSections(TEMPS);

  it("l'Article 2 énonce le tarif, l'unité, la quantité maximale et le plafond", () => {
    const a2 = article(sections, 2);
    expect(a2.title).toBe("Article 2 — Rémunération au temps");
    expect(a2.table?.columns).toEqual(["#", "PRESTATION", "UNITÉ", "TARIF", "QUANTITÉ MAX."]);
    expect(a2.table!.rows[0].map(norm)).toEqual(["01", "Maçon journalier", "jour", "7 500 XOF", "20"]);
    expect(a2.table?.totalLabel).toBe("PLAFOND DU CONTRAT");
    expect(norm(a2.table!.totalValue)).toBe("150 000 XOF");
  });

  it("l'Article 4 séquestre le plafond et paie le temps constaté", () => {
    const texte = norm(article(sections, 4).paragraphs.join(" "));
    expect(texte).toContain("150 000 XOF");
    expect(texte).toContain("relevé de présence");
    expect(texte).toContain("solde du plafond non consommé lui est restitué");
  });

  it("ne promet ni paiement par jalon, ni acceptation tacite", () => {
    const texte = [article(sections, 2), article(sections, 4)].flatMap((s) => s.paragraphs).join(" ");
    expect(texte).not.toMatch(/jalon/i);
    expect(texte).not.toMatch(/tacite/i);
  });

  it("un contrat sans conditions au temps garde ses articles historiques", () => {
    const classique = buildContractSections({ ...TEMPS, conditionsTemps: null });
    expect(article(classique, 2).title).toBe("Article 2 — Jalons et livrables");
    expect(article(classique, 4).paragraphs.join(" ")).toMatch(/acceptation tacite/);
  });
});
