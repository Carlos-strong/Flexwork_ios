import { describe, expect, it } from "vitest";
import { buildContractSections, buildContractParties, contractReference, type ContractSnapshot } from "./contract-clauses";

const base: ContractSnapshot = {
  objet: "Installation électrique",
  description: "Mise en conformité du tableau, luminaires, prises.",
  prix: 250000,
  devise: "XOF",
  declarationAssurance: {
    insurerName: "Assureur BJ",
    policyNumber: "POL-123",
    coverageCeiling: 5000000,
    validUntil: "2026-12-31",
  },
  declarationQualification: "CQP Électricité",
  declarationAge: "Le prestataire déclare être âgé de 32 ans et satisfaire l'âge minimum de 18 ans requis au BJ.",
  clauseDuree: "La mission débute le 30/08/2026 pour une durée prévisionnelle de 15 jours.",
  clauseStatutIndependant: "Le Prestataire exerce sa mission en toute indépendance.",
  clauseProprieteIntellectuelle: "Cession des droits patrimoniaux sur les livrables.",
  clauseConfidentialite: "Engagement de confidentialité de deux ans.",
  clauseResiliation: "Résiliation possible après mise en demeure de quinze jours.",
  clauseResponsabilite: "Obligation de moyens, responsabilité limitée.",
  clauseDroitApplicable: "Le présent contrat est soumis au droit béninois.",
  clausePlateformeNonPartie: "Flexwork n'est pas partie au présent contrat.",
  clauseMediationFacultative: true,
};

describe("buildContractSections — format du modèle de référence", () => {
  // toLocaleString/toLocaleDateString fr-FR en Node insèrent des espaces fines (U+202F).
  const norm = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

  it("reprend les 10 articles du modèle, dans le même ordre et sous les mêmes intitulés", () => {
    const titles = buildContractSections(base).map((s) => s.title);
    expect(titles.slice(0, 10)).toEqual([
      "Article 1 — Objet du contrat",
      "Article 2 — Jalons et livrables",
      "Article 3 — Durée d'exécution",
      "Article 4 — Rémunération et modalités de paiement",
      "Article 5 — Statut du prestataire",
      "Article 6 — Propriété intellectuelle",
      "Article 7 — Confidentialité",
      "Article 8 — Résiliation",
      "Article 9 — Responsabilité",
      "Article 10 — Droit applicable et litiges",
    ]);
  });

  it("ajoute après le modèle les 2 articles propres au projet (12 sections)", () => {
    const titles = buildContractSections(base).map((s) => s.title);
    expect(titles).toHaveLength(12);
    expect(titles[10]).toBe("Article 11 — Déclarations du prestataire");
    expect(titles[11]).toBe("Article 12 — Médiation et statut de la plateforme");
  });

  it("conserve la clause de non-participation de la plateforme (position juridique §6.2)", () => {
    const last = buildContractSections(base)[11];
    expect(last.paragraphs.join(" ")).toContain("n'est pas partie");
  });

  it("reste soumis au droit béninois — le modèle de référence stipule le droit français", () => {
    const art10 = buildContractSections(base).find((s) => s.title.startsWith("Article 10"))!;
    expect(art10.paragraphs.join(" ")).toContain("béninois");
    expect(art10.paragraphs.join(" ")).not.toContain("français");
  });

  it("Article 2 — tableau des jalons au format du modèle (# / LIVRABLE / UNITÉ / PRIX / DÉLAI)", () => {
    const sections = buildContractSections({
      ...base,
      jalons: [
        { titre: "Installation", montant: 150000 },
        { titre: "Mise en service", montant: 100000 },
      ],
    });
    const art2 = sections.find((s) => s.title.startsWith("Article 2"))!;
    expect(art2.table).toBeDefined();
    expect(art2.table!.columns).toEqual(["#", "LIVRABLE / JALON", "UNITÉ", "PRIX", "DÉLAI"]);
    expect(art2.table!.rows[0][0]).toBe("01");
    expect(art2.table!.rows[0][1]).toBe("Installation");
    expect(art2.table!.rows[0][2]).toBe("Forfait");
    expect(norm(art2.table!.rows[0][3])).toBe("150 000 XOF");
    expect(art2.table!.rows[1][0]).toBe("02");
    expect(art2.table!.totalLabel).toBe("MONTANT TOTAL DU CONTRAT");
    expect(norm(art2.table!.totalValue)).toBe("250 000 XOF");
    expect(norm(art2.paragraphs.join(" "))).toContain("Le régime de rémunération applicable est : Prix fixe.");
  });

  it("Article 2 — sans jalon : ligne unique, le tableau reste au même format", () => {
    const art2 = buildContractSections(base).find((s) => s.title.startsWith("Article 2"))!;
    expect(art2.table!.rows).toHaveLength(1);
    expect(art2.table!.rows[0][1]).toBe("Installation électrique");
    expect(norm(art2.table!.totalValue)).toBe("250 000 XOF");
  });

  it("Article 4 — modalités de paiement en 4 points + acceptation tacite 7 jours", () => {
    const art4 = buildContractSections(base).find((s) => s.title.startsWith("Article 4"))!;
    const joined = norm(art4.paragraphs.join(" "));
    expect(joined).toContain("250 000 XOF");
    expect(joined).toContain("conformément au tableau de l'Article 2");
    expect(joined).toContain("sept (7) jours");
    expect(joined).toContain("acceptation tacite");
    expect(joined).toContain("séquestre");
  });

  it("Article 11 — déclaration d'âge A13 conservée", () => {
    const art11 = buildContractSections(base).find((s) => s.title.startsWith("Article 11"))!;
    expect(art11.paragraphs.join(" ")).toContain("âge minimum de 18 ans");
  });

  it("Article 11 — formate l'assurance déclarée (assureur, police, plafond, validité)", () => {
    const art11 = buildContractSections(base).find((s) => s.title.startsWith("Article 11"))!;
    const insurance = norm(art11.paragraphs.find((p) => p.startsWith("Assurance"))!);
    expect(insurance).toContain("Assureur BJ");
    expect(insurance).toContain("POL-123");
    expect(insurance).toContain("5 000 000 XOF");
    expect(insurance).toContain("2026");
  });

  it("Article 11 — mention 'non vérifiée' pour la qualification", () => {
    const art11 = buildContractSections(base).find((s) => s.title.startsWith("Article 11"))!;
    expect(art11.paragraphs.join(" ")).toContain("non vérifiée par Flexwork");
  });

  it("Article 11 — repli 'Aucune assurance déclarée' quand la déclaration est absente", () => {
    const sections = buildContractSections({ ...base, declarationAssurance: undefined });
    const art11 = sections.find((s) => s.title.startsWith("Article 11"))!;
    expect(art11.paragraphs.join(" ")).toContain("Aucune assurance déclarée");
  });
});

describe("contractReference", () => {
  it("reprend la forme courte du modèle (8 caractères en majuscules)", () => {
    expect(contractReference("cmt7z5dff000gg876ggd6ph8c")).toBe("CMT7Z5DF");
  });
});

describe("buildContractParties", () => {
  const parties = buildContractParties({
    reference: "CMT7Z5DF",
    client: { name: "Rivoli Hazael", email: "client@gmail.com", tel: "+22996158656", city: "Cotonou", country: "BJ" },
    provider: { name: "Canon Roger", email: "p@x.bj", tel: "+22990000000", country: "BJ", role: "artisan" },
  });

  it("produit les deux blocs du modèle", () => {
    expect(parties.client.heading).toBe("LE CLIENT");
    expect(parties.provider.heading).toBe("ET LE PRESTATAIRE");
    expect(parties.client.name).toBe("Rivoli Hazael");
  });

  it("affiche le statut réel du prestataire (filière), pas un statut fiscal non collecté", () => {
    const statut = parties.provider.lines.find((l) => l.label === "Statut")!.value;
    expect(statut).toContain("Artisan");
  });

  it("n'expose ni SIRET ni forme juridique — non collectés dans ce schéma", () => {
    const labels = [...parties.client.lines, ...parties.provider.lines].map((l) => l.label).join(" ");
    expect(labels).not.toContain("SIRET");
    expect(labels).not.toContain("Forme juridique");
  });

  it("rappelle la référence dans le préambule, comme le modèle", () => {
    expect(parties.preamble).toContain("« les Parties »");
    expect(parties.preamble).toContain("CMT7Z5DF");
  });

  it("retombe sur un libellé lisible quand l'adresse est absente", () => {
    const p = buildContractParties({ reference: "X", client: {}, provider: {} });
    expect(p.client.lines.find((l) => l.label === "Adresse")!.value).toBe("Adresse non renseignée");
  });
});

describe("Article 4 — retenue de garantie (mode J4)", () => {
  const avecJalons: ContractSnapshot = {
    ...base,
    jalons: [
      { titre: "Gros œuvre", montant: 150000 },
      { titre: "Finitions", montant: 100000 },
    ],
  };
  const article4 = (snapshot: ContractSnapshot) =>
    buildContractSections(snapshot).find((s) => s.title.startsWith("Article 4"))!;

  it("n'en parle pas sans retenue — le contrat par défaut est inchangé", () => {
    expect(article4(avecJalons).paragraphs.some((p) => p.includes("Retenue de garantie"))).toBe(false);
    // Ni pour un snapshot antérieur au mode J4, qui ne porte pas le champ du tout.
    expect(article4(base).paragraphs.some((p) => p.includes("Retenue de garantie"))).toBe(false);
  });

  it("énonce le taux ET le montant total retenu quand le contrat en porte une", () => {
    const paragraphs = article4({ ...avecJalons, retentionRate: 0.05 }).paragraphs;
    const clause = paragraphs.find((p) => p.includes("Retenue de garantie"));
    expect(clause, "la clause doit figurer au contrat signé").toBeTruthy();
    expect(clause).toContain("5 %");
    // Espaces normalisées avant comparaison : `toLocaleString("fr-FR")` sépare les milliers par
    // une espace insécable étroite (U+202F), qu'un littéral tapé au clavier ne contient pas.
    const normalise = clause!.replace(/\s/g, " ");
    // 7 500 + 5 000 — le montant que le Prestataire ne percevra PAS à l'échéance des jalons.
    expect(normalise).toContain("12 500 XOF");
  });

  it("reste muet sur un contrat sans jalon, où la retenue n'a aucune échéance de versement", () => {
    const paragraphs = article4({ ...base, jalons: null, retentionRate: 0.05 }).paragraphs;
    expect(paragraphs.some((p) => p.includes("Retenue de garantie"))).toBe(false);
  });
});
