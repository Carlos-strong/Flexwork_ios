import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "FAQ — FlexWork" };

const FAQ = [
  {
    q: "Mes fonds sont-ils en sécurité ?",
    a: "Oui. Le montant de la mission est placé sous séquestre chez un prestataire de paiement agréé (Mobile Money). FlexWork ne détient jamais les fonds et ne les libère que selon les conditions du contrat signé entre vous et le prestataire.",
  },
  {
    q: "L'identité est-elle vraiment vérifiée ?",
    a: "Oui. Chaque utilisateur doit faire vérifier son identité (pièce d'identité recto/verso + selfie) avant de publier une mission ou de candidater. C'est la seule vérification effective de la plateforme.",
  },
  {
    q: "Les compétences et assurances sont-elles vérifiées ?",
    a: "Non, et nous l'affichons clairement. Les qualifications, l'expérience et l'assurance sont déclarées par le prestataire et marquées « non vérifiées par FlexWork ». Sur les missions à risque élevé, une assurance effective est toutefois exigée sans tolérance.",
  },
  {
    q: "Que se passe-t-il si le client ne réagit pas après la livraison ?",
    a: "Le contrat prévoit une acceptation tacite : après le délai contractuel (7 jours par défaut) sans contestation, les fonds sont libérés au prestataire. Cette clause protège le prestataire d'un client passif.",
  },
  {
    q: "Et en cas de litige ?",
    a: "Le client peut contester dans le délai : les fonds sont gelés et une médiation facultative est proposée. Si aucun accord n'est trouvé, les parties peuvent saisir la juridiction compétente.",
  },
  {
    q: "Y a-t-il un âge minimum ?",
    a: "Oui, 18 ans minimum pour les filières chantier (artisan, manœuvre, expert BTP), contrôlé par la plateforme à partir de la pièce d'identité — pas d'une simple déclaration.",
  },
  {
    q: "Quels moyens de paiement sont acceptés ?",
    a: "Le Mobile Money, via un prestataire de paiement agréé : MTN MoMo, Moov Money, Orange Money et FedaPay. Toutes les transactions sont en FCFA (XOF).",
  },
  {
    q: "Combien coûte le service ?",
    a: "La création de compte et la candidature sont gratuites. FlexWork ne prélève aucune commission sur les certifications qu'elle rend obligatoires. Les frais applicables aux missions sont indiqués sur la page Tarifs.",
  },
];

export default function FaqPage() {
  return (
    <>
      <PageHero
        badge="FAQ"
        title="Questions fréquentes"
        subtitle="Les réponses claires aux questions que tout le monde se pose — sans jargon."
      />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-4">
        {FAQ.map((item) => (
          <details key={item.q} className="group bg-white border border-[#E2E8F0] rounded-2xl open:ring-1 open:ring-[#008751]/20">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4 p-5 font-semibold text-[#0f172a]">
              {item.q}
              <span className="text-[#008751] transition group-open:rotate-45">＋</span>
            </summary>
            <p className="px-5 pb-5 text-sm text-[#64748B] leading-relaxed">{item.a}</p>
          </details>
        ))}
      </section>
    </>
  );
}
