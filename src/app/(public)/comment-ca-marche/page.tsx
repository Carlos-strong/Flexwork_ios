import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "Comment ça marche — FlexWork" };

const ETAPES_CLIENT = [
  { n: "1", t: "Publiez une mission", d: "Décrivez votre besoin, fixez le budget et le délai. Votre identité est vérifiée (KYC) avant publication." },
  { n: "2", t: "Recevez des candidatures", d: "Des prestataires qualifiés candidate à prix fixe ou par devis détaillé. Comparez les offres librement." },
  { n: "3", t: "Contrat + séquestre", d: "Choisissez un prestataire, signez le contrat généré automatiquement, puis financez le séquestre via Mobile Money." },
  { n: "4", t: "Travaux & libération", d: "Le prestataire livre. Validez le résultat : les fonds sont libérés. Pas de réaction ? L'acceptation tacite libère après le délai contractuel." },
];

const ETAPES_PRESTATAIRE = [
  { n: "1", t: "Complétez votre profil", d: "Filière, domaine, tarifs, zone d'intervention — et vos déclarations d'assurance et de qualifications (affichées honnêtement comme non vérifiées)." },
  { n: "2", t: "Candidatez", d: "Répondez aux missions publiées, en prix fixe ou par devis BTP détaillé (jalons, délai, main d'œuvre)." },
  { n: "3", t: "Signez & commencez", d: "Une fois sélectionné, signez le contrat : les fonds sont sécurisés chez le PSP agréé, vous pouvez commencer." },
  { n: "4", t: "Livrez & soyez payé", d: "Soumettez vos livrables, faites valider, et recevez le paiement libéré par le séquestre." },
];

export default function CommentCaMarchePage() {
  return (
    <>
      <PageHero
        badge="Comment ça marche"
        title="De la mission au paiement, en quatre étapes"
        subtitle="Un cycle unique et transparent, partagé par les deux parties — pas de surprise, pas de double flux."
      />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-12">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[#0f172a] mb-6">Côté client</h2>
          <div className="space-y-4">
            {ETAPES_CLIENT.map((e) => (
              <div key={e.n} className="flex gap-4 bg-white border border-[#E2E8F0] rounded-2xl p-5">
                <span className="h-10 w-10 shrink-0 rounded-full bg-[#008751] text-white grid place-items-center font-extrabold">{e.n}</span>
                <div>
                  <h3 className="font-bold text-[#0f172a]">{e.t}</h3>
                  <p className="text-sm text-[#64748B] mt-1 leading-relaxed">{e.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[#0f172a] mb-6">Côté prestataire</h2>
          <div className="space-y-4">
            {ETAPES_PRESTATAIRE.map((e) => (
              <div key={e.n} className="flex gap-4 bg-white border border-[#E2E8F0] rounded-2xl p-5">
                <span className="h-10 w-10 shrink-0 rounded-full bg-[#0f172a] text-white grid place-items-center font-extrabold">{e.n}</span>
                <div>
                  <h3 className="font-bold text-[#0f172a]">{e.t}</h3>
                  <p className="text-sm text-[#64748B] mt-1 leading-relaxed">{e.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#008751]/5 border border-[#008751]/20 rounded-2xl p-6">
          <h2 className="font-bold text-[#0f172a] mb-2">En cas de désaccord ?</h2>
          <p className="text-sm text-[#475569] leading-relaxed">
            Le client peut contester dans le délai contractuel : les fonds sont gelés et une <strong>médiation facultative</strong> est
            proposée. Si aucun accord n&apos;est trouvé, les parties saisissent la juridiction compétente — la plateforme ne
            tranche pas.
          </p>
        </div>
      </section>
    </>
  );
}
