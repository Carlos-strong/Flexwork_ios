import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "À propos — FlexWork" };

const PROFILS = [
  { nom: "Client", desc: "Publie une mission, compare les candidatures et paie en toute sécurité via le séquestre." },
  { nom: "Expert Digital", desc: "Développement web/mobile, design, data, cybersécurité, marketing digital — en présentiel ou à distance." },
  { nom: "Expert BTP / Autres", desc: "Conseil, études et suivi de chantier pour les métiers techniques du bâtiment et autres." },
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

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-10">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 lg:p-8">
          <h2 className="text-xl lg:text-2xl font-bold text-[#0f172a] mb-3">Notre position : un intermédiaire neutre</h2>
          <p className="text-[15px] text-[#475569] leading-relaxed">
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
                <span className="mt-1.5 h-2 w-2 rounded-full bg-[#008751] shrink-0" />
                <span className="text-[15px] text-[#475569]"><strong className="text-[#0f172a]">{t}</strong> — {d}</span>
              </li>
            ))}
          </ul>
          <blockquote className="mt-6 border-l-4 border-[#008751] bg-[#008751]/5 rounded-r-lg p-4 text-[15px] font-medium text-[#0f172a]">
            « Nous savons qui est en face de vous, et votre argent est protégé jusqu&apos;à ce que le travail soit fait. »
          </blockquote>
        </div>

        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[#0f172a] mb-5">Cinq profils, un seul marché</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {PROFILS.map((p) => (
              <div key={p.nom} className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
                <h3 className="font-bold text-[#0f172a] mb-1">{p.nom}</h3>
                <p className="text-sm text-[#64748B] leading-relaxed">{p.desc}</p>
              </div>
            ))}
            <div className="bg-[#008751] border border-[#008751] rounded-2xl p-5 text-white">
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
