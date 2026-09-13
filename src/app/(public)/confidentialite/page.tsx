import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "Confidentialité — FlexWork" };

export default function ConfidentialitePage() {
  return (
    <>
      <PageHero
        badge="Confidentialité"
        title="Vos données, à finalités limitées"
        subtitle="Ce que nous collectons, pourquoi, combien de temps nous le conservons, et vos droits. Document à jour de la politique de protection des données personnelles."
      />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-6">
        {[
          {
            t: "Données d'identification (KYC)",
            d: "Pièce d'identité recto/verso, selfie, numéro de téléphone. Finalité : vérifier l'identité pour permettre publication, candidature et recours entre les parties. Conservation : le temps nécessaire à la vérification et à la traçabilité, dans un espace de stockage privé et chiffré.",
          },
          {
            t: "Données de profil",
            d: "Nom, filière, domaine, tarifs, zone d'intervention, déclarations d'assurance et de qualifications. Finalité : présenter vos prestations aux clients. Ces informations sont affichées telles que déclarées, jamais modifiées par la plateforme.",
          },
          {
            t: "Données de paiement",
            d: "Opérations de séquestre et instructions au prestataire de paiement agréé. Finalité : garantir le paiement. La plateforme ne stocke jamais les fonds ni les données bancaires.",
          },
          {
            t: "Pointage de présence (optionnel)",
            d: "Sur les missions qui le prévoient, un horodatage d'arrivée/départ peut être activé d'un commun accord par les deux parties. Finalité strictement limitée : preuve de présence. Conservation courte (durée de la mission + délai de contestation), consentement révocable, aucun usage secondaire — jamais de suivi continu de localisation.",
          },
          {
            t: "Vos droits",
            d: "Accès, rectification, suppression et opposition. Vous pouvez exercer ces droits en écrivant à notre support. Le refus de certaines données (ex. pointage) est sans conséquence sur le reste du service.",
          },
          {
            t: "Cadre légal",
            d: "Le traitement des données personnelles respecte la loi béninoise n° 2009-09 sur la protection des données à caractère personnel et la réglementation de l'Autorité de Protection des Données Personnelles (APDP).",
          },
        ].map((s) => (
          <div key={s.t} className="bg-white border border-[#E2E8F0] rounded-2xl p-6">
            <h2 className="font-bold text-[#0f172a] mb-2">{s.t}</h2>
            <p className="text-sm text-[#64748B] leading-relaxed">{s.d}</p>
          </div>
        ))}

        <p className="text-xs text-[#94A3B8]">
          Note : cette page décrit le modèle de traitement retenu. La version contractuelle finale de la politique de
          confidentialité doit être validée par un avocat avant mise en production (prérequis juridique).
        </p>
      </section>
    </>
  );
}
