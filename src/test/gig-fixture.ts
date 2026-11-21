// Corps de création d'un Gig conforme aux règles du 2026-11-08 (src/lib/gig-rules.ts) pour les
// tests : titre « Je vais… », trois formules à prix progressifs, mots-clés, vidéo (visuel exigé
// pour publier). `prix` / `delaiJours` deviennent la formule BASIQUE — celle qu'une commande
// sans formule précisée achète : les montants attendus par les tests existants ne changent pas.
export function gigBody(opts: {
  titre?: string;
  prix: number;
  delaiJours: number;
  domaine?: string;
  tags?: string[];
  status?: "brouillon" | "publie";
}) {
  const sujet = opts.titre ?? "réaliser votre prestation";
  return {
    titre: sujet.toLowerCase().startsWith("je vais ") ? sujet : `Je vais ${sujet}`,
    description: "Prestation complète : cadrage du besoin, réalisation, livraison des fichiers et accompagnement. ".repeat(2),
    domaine: opts.domaine ?? "expert_digital",
    tags: opts.tags ?? ["test"],
    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    status: opts.status,
    packages: [
      { tier: "basique", titre: "Essentiel", description: "La prestation de base.", prix: opts.prix, delaiJours: opts.delaiJours, revisions: 1 },
      { tier: "standard", titre: "Confort", description: "La prestation avec options.", prix: opts.prix * 2, delaiJours: opts.delaiJours + 2, revisions: 3 },
      { tier: "premium", titre: "Complet", description: "La prestation complète et suivie.", prix: opts.prix * 3, delaiJours: opts.delaiJours + 5, revisions: 5 },
    ],
  };
}
