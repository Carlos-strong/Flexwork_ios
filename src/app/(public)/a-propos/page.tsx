import { frontendPageMetadata } from "@/lib/frontend-config";
import { PageHero } from "@/components/public/PageHero";

export function generateMetadata() {
  return frontendPageMetadata("/a-propos", "À propos — FlexWork");
}

const PROFILS = [
  { nom: "Client", desc: "Publie une mission, compare les candidatures et paie en toute sécurité via le séquestre." },
  { nom: "Prestataire indépendant", desc: "Vous travaillez à votre compte : développement, design, data, cybersécurité, marketing, conseil — à distance ou en hybride." },
  { nom: "Entreprise", desc: "Vous engagez une structure : études, suivi de chantier, expertise technique et corps d'état, avec une équipe." },
  { nom: "Artisan", desc: "Plomberie, électricité, maçonnerie, menuiserie, carrelage — les métiers du chantier." },
  { nom: "Manœuvre", desc: "Aide manutention, déchargement, préparation de chantier — avec certification HSE." },
];

export default function AProposPage() {
  return (
    <>
      <PageHero
        badge="À propos"
        title="La place de marché des talents vérifiés en Afrique de l'Ouest"
        subtitle="FlexWork met en relation des clients et des prestataires au Bénin et en Afrique de l'Ouest. Nous vérifions l'identité, nous sécurisons le paiement — et nous affichons honnêtement ce que nous ne vérifions pas."
      />

      <section className="page-shell py-12 lg:py-16 space-y-10">
        <div className="bg-white border border-[#E7E2F0] rounded-2xl p-6 lg:p-8">
          <h2 className="text-xl lg:text-2xl font-bold text-[#191224] mb-3">Notre position : un intermédiaire neutre</h2>
          <p className="text-[15px] text-[#4A4258] leading-relaxed">
            FlexWork ne réalise aucun travaux, ne garantit aucun résultat et n&apos;est partie à aucun contrat de
            prestation. Notre rôle est de <strong>mettre en relation</strong>, puis de sécuriser ce qui l&apos;est à notre niveau :
          </p>
          <ul className="mt-4 space-y-3">
            {[
              ["Identité vérifiée", "Chaque utilisateur passe un contrôle d'identité (KYC : pièce recto/verso, selfie)."],
              ["Paiement séquestre", "Les fonds sont détenus par un prestataire de paiement agréé, jamais par la plateforme, et libérés selon les conditions du contrat."],
              ["Déclarations honnêtes", "Assurance et qualifications sont déclarées par le prestataire et affichées comme non vérifiées — jamais présentées comme certifiées."],
              ["Médiation facilitée", "En cas de désaccord, la plateforme propose une médiation facultative ; elle ne tranche pas le litige."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-[#4C1D95] shrink-0" />
                <span className="text-[15px] text-[#4A4258]"><strong className="text-[#191224]">{t}</strong> — {d}</span>
              </li>
            ))}
          </ul>
          <blockquote className="mt-6 border-l-4 border-[#4C1D95] bg-[#4C1D95]/5 rounded-r-lg p-4 text-[15px] font-medium text-[#191224]">
            « Nous savons qui est en face de vous, et votre argent est protégé jusqu&apos;à ce que le travail soit fait. »
          </blockquote>
        </div>

        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[#191224] mb-5">Cinq profils, un seul marché</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {PROFILS.map((p) => (
              <div key={p.nom} className="bg-white border border-[#E7E2F0] rounded-2xl p-5">
                <h3 className="font-bold text-[#191224] mb-1">{p.nom}</h3>
                <p className="text-sm text-[#6B6478] leading-relaxed">{p.desc}</p>
              </div>
            ))}
            <div className="bg-[#4C1D95] border border-[#4C1D95] rounded-2xl p-5 text-white">
              <h3 className="font-bold mb-1">Et vous ?</h3>
              <p className="text-sm text-white/90 leading-relaxed">
                Créez un compte gratuitement et rejoignez la place de marché — côté client ou côté prestataire.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
