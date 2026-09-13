// Construction d'un contrat de prestation à partir du termsSnapshot.
//
// FORMAT : aligné (2026-08-31) sur le modèle de référence « Contrat de prestation —
// Électricien(ne) d'équipement / Chantier » — même en-tête (référence + bloc Parties), même
// ordre et mêmes intitulés pour les Articles 1 à 10, même tableau de jalons
// (# / LIVRABLE / UNITÉ / PRIX / DÉLAI + MONTANT TOTAL), même bloc de signatures.
//
// DEUX ÉCARTS ASSUMÉS avec le modèle de référence, qui sont des adaptations et non des
// oublis — les recopier serait faux ici :
//   1. Le modèle stipule le droit FRANÇAIS et un SIRET. Cette plateforme opère au Bénin et
//      en Afrique de l'Ouest (XOF, BJ/CI/SN/TG) : le contrat reste soumis au droit béninois,
//      et le bloc Parties affiche les données réellement collectées (identité, adresse,
//      contact) — ni SIRET ni forme juridique, qui n'existent pas dans ce schéma.
//   2. Le modèle n'a pas de clause de non-participation de la plateforme. Ici c'est une
//      position juridique fondatrice (§6.2), verrouillée par contract-signature-workflow.test.ts :
//      elle est conservée, en Article 12, après les 10 articles du modèle.
// Les Articles 11 (déclarations A9/A13) et 12 sont donc des AJOUTS après le modèle, choisis
// pour que la numérotation 1-10 et ses renvois croisés restent identiques à la référence.
//
// Fonction PURE, partagée par le rendu de la page contrat (client) et l'export documentaire
// HTML/PDF (serveur) : une seule source de vérité, aucune divergence entre l'écran et le
// document signé.

import { totalRetentionAmount } from "@/lib/jalons";

export type ContractSnapshot = {
  objet?: string | null;
  description?: string | null;
  prix?: number | null;
  devise?: string | null;
  delaiJours?: number | null;
  declarationAssurance?: unknown;
  declarationQualification?: string | null;
  declarationAge?: string | null;
  clauseDuree?: string | null;
  clauseStatutIndependant?: string | null;
  clauseProprieteIntellectuelle?: string | null;
  clauseConfidentialite?: string | null;
  clauseResiliation?: string | null;
  clauseResponsabilite?: string | null;
  clauseDroitApplicable?: string | null;
  clausePlateformeNonPartie?: string | null;
  clauseMediationFacultative?: boolean;
  jalons?: { titre: string; montant: number }[] | null;
  // Taux de la retenue de garantie figé au contrat (mode J4) — absent/0 sur tous les autres
  // contrats, y compris ceux générés avant le 2026-09-11 : l'Article 4 n'en parle alors pas.
  retentionRate?: number | null;
  devis?: unknown;
  // Régime affiché sous le tableau de l'Article 2 (« Prix fixe », « Taux », « Sur devis »).
  regimeRemuneration?: string | null;
  // Bloc Parties de l'en-tête. name/city/country/role sont optionnels : les contrats
  // générés avant l'ajout de ce bloc (2026-08-31) ne les portent pas dans leur snapshot figé,
  // et l'appelant retombe alors sur l'identité jointe par l'API.
  client?: { id?: string; email?: string; tel?: string; name?: string | null; city?: string | null; country?: string | null } | null;
  provider?: { id?: string; email?: string; tel?: string; name?: string | null; city?: string | null; country?: string | null; role?: string | null } | null;
};

// Bloc « LE CLIENT » / « ET LE PRESTATAIRE » de l'en-tête, repris du modèle de référence.
export type ContractPartyBlock = {
  heading: string;
  name: string;
  lines: { label: string; value: string }[];
};

// Tableau des jalons de l'Article 2 (# / LIVRABLE / UNITÉ / PRIX / DÉLAI + total).
export type ContractTable = {
  columns: string[];
  rows: string[][];
  totalLabel: string;
  totalValue: string;
};

export type ContractSection = { title: string; paragraphs: string[]; table?: ContractTable };

function insuranceText(raw: unknown, devise: string): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "Aucune assurance déclarée par ce prestataire.";
  const a = raw as { insurerName?: string; policyNumber?: string; coverageCeiling?: number; validUntil?: string };
  const parts = [`Assurance RC Pro déclarée : ${a.insurerName ?? "assureur non précisé"}`, `police ${a.policyNumber ?? "non précisée"}`];
  if (a.coverageCeiling) parts.push(`plafond ${a.coverageCeiling.toLocaleString("fr-FR")} ${devise}`);
  if (a.validUntil) parts.push(`valide au ${new Date(a.validUntil).toLocaleDateString("fr-FR")}`);
  return `${parts.join(", ")}.`;
}

// Référence courte du contrat, affichée en en-tête et rappelée dans le préambule —
// même forme que le modèle de référence (« Référence CMT7Z5DF »).
export function contractReference(contractId: string): string {
  return contractId.slice(0, 8).toUpperCase();
}

// Statut du prestataire affiché dans le bloc Parties. Le modèle de référence affiche
// « Travailleur indépendant (micro-entreprise) » ; ici la filière métier est une donnée
// réelle du compte (UserRole), on l'affiche donc plutôt qu'un statut fiscal non collecté.
const ROLE_STATUT: Record<string, string> = {
  artisan: "Artisan — travailleur indépendant",
  manoeuvre: "Manœuvre — travailleur indépendant",
  expert_btp_autres: "Expert BTP / Autres — travailleur indépendant",
  expert_digital: "Expert digital — travailleur indépendant",
};

function addressOf(city?: string | null, country?: string | null): string {
  const v = [city, country].filter(Boolean).join(", ");
  return v || "Adresse non renseignée";
}

export function buildContractParties(input: {
  reference: string;
  client: { name?: string | null; email?: string | null; tel?: string | null; city?: string | null; country?: string | null };
  provider: { name?: string | null; email?: string | null; tel?: string | null; city?: string | null; country?: string | null; role?: string | null };
}): { client: ContractPartyBlock; provider: ContractPartyBlock; preamble: string } {
  return {
    client: {
      heading: "LE CLIENT",
      name: input.client.name?.trim() || "Client",
      lines: [
        { label: "Adresse", value: addressOf(input.client.city, input.client.country) },
        { label: "Téléphone", value: input.client.tel || "Non renseigné" },
        { label: "E-mail", value: input.client.email || "Non renseigné" },
      ],
    },
    provider: {
      heading: "ET LE PRESTATAIRE",
      name: input.provider.name?.trim() || "Prestataire",
      lines: [
        { label: "Statut", value: ROLE_STATUT[input.provider.role ?? ""] ?? "Travailleur indépendant" },
        { label: "Adresse", value: addressOf(input.provider.city, input.provider.country) },
        { label: "Téléphone", value: input.provider.tel || "Non renseigné" },
        { label: "E-mail", value: input.provider.email || "Non renseigné" },
      ],
    },
    preamble:
      `Ci-après désignés ensemble « les Parties », il a été convenu et arrêté ce qui suit, ` +
      `dans le cadre de la mission référencée ${input.reference} initiée sur la plateforme.`,
  };
}

export function buildContractSections(t: ContractSnapshot): ContractSection[] {
  const devise = t.devise ?? "XOF";
  const money = (n: number) => `${n.toLocaleString("fr-FR")} ${devise}`;
  // Normalisé ici : un snapshot antérieur au mode J4 n'a pas le champ du tout.
  const retentionRate = typeof t.retentionRate === "number" ? t.retentionRate : 0;
  const total = t.prix ?? 0;
  const sections: ContractSection[] = [];

  // ---- Article 1 — Objet du contrat ----
  sections.push({
    title: "Article 1 — Objet du contrat",
    paragraphs: [
      `Le présent contrat a pour objet de définir les conditions dans lesquelles le Prestataire réalise, à titre indépendant, la mission suivante pour le compte du Client : « ${t.objet ?? ""} ». ${t.description ?? ""}`,
      "Le Prestataire s'engage à exécuter cette mission avec diligence, dans le respect des règles de l'art et des délais fixés à l'Article 3, en toute indépendance quant à l'organisation de son travail.",
    ],
  });

  // ---- Article 2 — Jalons et livrables ----
  if (t.jalons && t.jalons.length > 0) {
    sections.push({
      title: "Article 2 — Jalons et livrables",
      paragraphs: [
        "La mission est décomposée en jalons, chacun correspondant à un livrable distinct, à un prix forfaitaire et à un délai d'exécution propres. Un jalon est considéré comme achevé lorsque le livrable correspondant a été transmis au Client et validé par celui-ci.",
        `Le régime de rémunération applicable est : ${t.regimeRemuneration ?? "Prix fixe"}.`,
        "Toute modification du périmètre d'un jalon fait l'objet d'un avenant écrit entre les Parties, y compris via l'espace de négociation de la plateforme.",
      ],
      table: {
        columns: ["#", "LIVRABLE / JALON", "UNITÉ", "PRIX", "DÉLAI"],
        // « Forfait » / « À définir » : le schéma ne porte ni unité ni délai par jalon —
        // mêmes valeurs par défaut que le modèle de référence, plutôt qu'une colonne vide.
        rows: t.jalons.map((j, i) => [
          String(i + 1).padStart(2, "0"),
          j.titre,
          "Forfait",
          money(j.montant),
          "À définir",
        ]),
        totalLabel: "MONTANT TOTAL DU CONTRAT",
        totalValue: money(total),
      },
    });
  } else {
    sections.push({
      title: "Article 2 — Jalons et livrables",
      paragraphs: [
        "La mission n'est pas décomposée en jalons : elle donne lieu à un livrable unique, dont la validation déclenche le paiement intégral dans les conditions de l'Article 4.",
        `Le régime de rémunération applicable est : ${t.regimeRemuneration ?? "Prix fixe"}.`,
      ],
      table: {
        columns: ["#", "LIVRABLE / JALON", "UNITÉ", "PRIX", "DÉLAI"],
        rows: [["01", t.objet ?? "Livrable unique", "Forfait", money(total), "À définir"]],
        totalLabel: "MONTANT TOTAL DU CONTRAT",
        totalValue: money(total),
      },
    });
  }

  // ---- Article 3 — Durée d'exécution ----
  sections.push({
    title: "Article 3 — Durée d'exécution",
    paragraphs: [t.clauseDuree ?? "Durée non spécifiée."],
  });

  // ---- Article 4 — Rémunération et modalités de paiement ----
  sections.push({
    title: "Article 4 — Rémunération et modalités de paiement",
    paragraphs: [
      `En contrepartie de la réalisation de la mission, le Client versera au Prestataire la somme totale de ${money(total)}, répartie par jalon conformément au tableau de l'Article 2.`,
      "Le paiement de chaque jalon est déclenché selon les modalités suivantes :",
      "1. Le Prestataire transmet le livrable correspondant au jalon via l'espace de travail du projet ;",
      "2. Le Client dispose d'un délai de sept (7) jours calendaires pour valider le livrable ou formuler des demandes de modification motivées ;",
      "3. À défaut de contestation dans ce délai, le jalon est réputé accepté et son paiement est déclenché automatiquement (acceptation tacite) ;",
      "4. Les fonds sont versés au Prestataire selon les modalités de paiement de la plateforme, déduction faite des frais de service applicables.",
      "Les fonds sont placés sous séquestre auprès d'un prestataire de paiement agréé : la plateforme instruit la libération, elle ne détient jamais les fonds.",
      // Retenue de garantie (mode J4) — ce paragraphe n'est PAS cosmétique : il énonce la seule
      // raison pour laquelle le Prestataire percevra, à chaque jalon, moins que le montant
      // inscrit au tableau de l'Article 2. Sans lui, le contrat signé promettrait un montant
      // que la plateforme ne verse pas à cette échéance.
      ...(retentionRate > 0 && t.jalons && t.jalons.length > 0
        ? [
            `Retenue de garantie : une retenue de ${Math.round(retentionRate * 100)} % est appliquée au paiement de chaque jalon, soit un montant total de ${money(totalRetentionAmount(t.jalons, retentionRate))}. Cette retenue demeure sous séquestre et est versée au Prestataire en une seule fois après validation du dernier jalon de la mission. Elle ne constitue ni une réduction du prix convenu, ni des frais de service.`,
          ]
        : []),
    ],
  });

  // ---- Articles 5 à 10 : identiques au modèle de référence ----
  sections.push({ title: "Article 5 — Statut du prestataire", paragraphs: [t.clauseStatutIndependant ?? ""] });
  sections.push({ title: "Article 6 — Propriété intellectuelle", paragraphs: [t.clauseProprieteIntellectuelle ?? ""] });
  sections.push({ title: "Article 7 — Confidentialité", paragraphs: [t.clauseConfidentialite ?? ""] });
  sections.push({ title: "Article 8 — Résiliation", paragraphs: [t.clauseResiliation ?? ""] });
  sections.push({ title: "Article 9 — Responsabilité", paragraphs: [t.clauseResponsabilite ?? ""] });
  sections.push({ title: "Article 10 — Droit applicable et litiges", paragraphs: [t.clauseDroitApplicable ?? ""] });

  // ---- Article 11 — AJOUT hors modèle : déclarations A9 (assurance) / A13 (âge) ----
  sections.push({
    title: "Article 11 — Déclarations du prestataire",
    paragraphs: [
      `Assurance : ${insuranceText(t.declarationAssurance, devise)}`,
      `Qualification : ${t.declarationQualification ?? "Aucune qualification déclarée"} — non vérifiée par Flexwork.`,
      "Le Prestataire garantit l'exactitude et l'authenticité de ses déclarations ; toute fausse déclaration engage sa responsabilité.",
      ...(t.declarationAge ? [t.declarationAge] : []),
    ],
  });

  // ---- Article 12 — AJOUT hors modèle : médiation + plateforme non partie ----
  sections.push({
    title: "Article 12 — Médiation et statut de la plateforme",
    paragraphs: [
      t.clauseMediationFacultative
        ? "En cas de contestation, une médiation facultative peut être proposée par la plateforme. Sa proposition n'est pas opposable aux parties, qui peuvent saisir la juridiction compétente."
        : "",
      t.clausePlateformeNonPartie ?? "Flexwork n'est pas partie au présent contrat.",
    ].filter(Boolean),
  });

  return sections;
}
