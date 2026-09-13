import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "Conditions générales — FlexWork" };

const SECTIONS = [
  {
    t: "1. Nature du service",
    d: "FlexWork est une plateforme de mise en relation entre clients et prestataires. Elle ne réalise aucun travaux, ne garantit aucun résultat et n'est partie à aucun contrat de prestation conclu entre un client et un prestataire.",
  },
  {
    t: "2. Comptes et identité",
    d: "La création d'un compte est gratuite. Chaque compte est lié à un numéro de téléphone et une adresse e-mail uniques. La publication d'une mission (client) et la candidature (prestataire) sont conditionnées à la vérification de l'identité (KYC). Un seul compte par personne ; tout compte multiple ou frauduleux peut être suspendu.",
  },
  {
    t: "3. Déclarations des prestataires",
    d: "Assurance, qualifications, expérience et niveau sont déclarés par le prestataire. FlexWork ne les vérifie pas et les affiche comme non vérifiées. Le prestataire garantit l'exactitude de ses déclarations ; toute fausse déclaration engage sa responsabilité et peut entraîner la suspension du compte.",
  },
  {
    t: "4. Paiement séquestre",
    d: "Les fonds sont détenus par un prestataire de paiement agréé (Mobile Money) selon les conditions du contrat de prestation. La libération intervient sur validation du client, ou par acceptation tacite après le délai contractuel, ou par accord de médiation.",
  },
  {
    t: "5. Non-garantie du résultat",
    d: "FlexWork ne garantit pas l'exécution ni la qualité des travaux. La responsabilité de l'exécution incombe au prestataire ; celle de la description du besoin et de l'accès au site incombe au client.",
  },
  {
    t: "6. Litiges et médiation",
    d: "En cas de désaccord, une médiation facultative peut être proposée par la plateforme. Elle ne lie pas les parties et ne remplace pas la juridiction compétente. La plateforme n'a pas autorité pour trancher.",
  },
  {
    t: "7. Responsabilité de la plateforme",
    d: "FlexWork s'engage sur le fonctionnement du service et la fidélité de l'affichage des déclarations. Sa responsabilité est limitée dans les conditions prévues par la loi, et ne couvre pas les dommages résultant de l'exécution d'une mission.",
  },
  {
    t: "8. Résiliation et suspension",
    d: "Vous pouvez cesser d'utiliser le service à tout moment. FlexWork peut suspendre un compte en cas de violation des présentes conditions, de fraude avérée ou de comportement dangereux pour la communauté.",
  },
  {
    t: "9. Droit applicable",
    d: "Les présentes conditions sont régies par le droit béninois. En cas de litige non résolu par la médiation, les juridictions compétentes du Bénin sont seules compétentes.",
  },
];

export default function CguPage() {
  return (
    <>
      <PageHero
        badge="Conditions générales"
        title="Conditions générales d'utilisation"
        subtitle="Le cadre contractuel de la mise en relation. Ce document décrit le modèle retenu ; la version finale engageante doit être validée par un avocat."
      />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-5">
        {SECTIONS.map((s) => (
          <div key={s.t} className="bg-white border border-[#E2E8F0] rounded-2xl p-6">
            <h2 className="font-bold text-[#0f172a] mb-2">{s.t}</h2>
            <p className="text-sm text-[#64748B] leading-relaxed">{s.d}</p>
          </div>
        ))}
        <p className="text-xs text-[#94A3B8]">
          Version de référence : modèle v3.1 (intermédiaire pur). Document à valider juridiquement avant mise en
          production (prérequis n° 1 et 3 de l&apos;état consolidé).
        </p>
      </section>
    </>
  );
}
