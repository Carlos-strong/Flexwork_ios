import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "Confiance & sécurité — FlexWork" };

const PILIERS = [
  {
    t: "Identité vérifiée",
    d: "Chaque compte passe un contrôle d'identité réel : pièce d'identité recto/verso + selfie. Sans identification, pas de publication ni de candidature possible.",
  },
  {
    t: "Fonds jamais détenus par la plateforme",
    d: "Le paiement est placé sous séquestre chez un prestataire de paiement agréé (Mobile Money). La plateforme transmet des instructions, elle ne détient jamais votre argent et n'apparaît jamais comme bénéficiaire.",
  },
  {
    t: "Déclarations affichées honnêtement",
    d: "Assurance et qualifications sont déclarées par le prestataire et affichées comme non vérifiées par FlexWork. Nous ne fabriquons pas de fausse confiance.",
  },
  {
    t: "Risque élevé : assurance obligatoire",
    d: "Sur les missions à risque physique élevé (électricité, travail en hauteur, gros œuvre, engins), une assurance effective est exigée — sans tolérance.",
  },
  {
    t: "Âge minimum légal",
    d: "Les filières chantier exigent 18 ans minimum, contrôlé par la plateforme à partir de la pièce d'identité (pas d'une simple déclaration).",
  },
  {
    t: "Traçabilité inviolable",
    d: "Déclarations, contrats et actions d'administration sont chaînés par empreinte numérique et journalisés — toute modification rétroactive serait détectable.",
  },
];

export default function ConfiancePage() {
  return (
    <>
      <PageHero
        badge="Confiance & sécurité"
        title="Nous savons qui est en face de vous — et votre argent est protégé"
        subtitle="La confiance ne se décrète pas : elle se construit sur des mécanismes concrets. Voici exactement ce que FlexWork fait, et ce qu'elle ne fait pas."
      />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
        <div className="grid sm:grid-cols-2 gap-4">
          {PILIERS.map((p) => (
            <div key={p.t} className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="h-2 w-2 rounded-full bg-[#008751]" />
                <h3 className="font-bold text-[#0f172a]">{p.t}</h3>
              </div>
              <p className="text-sm text-[#64748B] leading-relaxed">{p.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 bg-[#0A1931] text-white rounded-2xl p-6 lg:p-8">
          <h2 className="text-lg font-bold mb-3">Ce que FlexWork ne fait pas</h2>
          <ul className="space-y-2 text-sm text-white/80">
            <li>• Elle ne certifie pas les compétences — les qualifications restent des déclarations du prestataire.</li>
            <li>• Elle ne garantit pas le résultat d&apos;une mission.</li>
            <li>• Elle ne tranche pas les litiges — elle propose une médiation facultative.</li>
            <li>• Elle ne détient jamais les fonds.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
