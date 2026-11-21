import { frontendPageMetadata } from "@/lib/frontend-config";
import { PageHero } from "@/components/public/PageHero";

export function generateMetadata() {
  return frontendPageMetadata("/tarifs", "Tarifs — FlexWork");
}

const LIGNES = [
  { item: "Création de compte", detail: "Client et prestataire", prix: "Gratuit" },
  { item: "Candidature / devis", detail: "Répondre à une mission", prix: "Gratuit" },
  { item: "Séquestre Mobile Money", detail: "Fonds détenus par le PSP agréé, libérés selon le contrat", prix: "Selon le PSP" },
  { item: "Certifications obligatoires", detail: "Aucune commission sur une certification que FlexWork rend obligatoire (règle d'équité)", prix: "0 %" },
  { item: "Assurance à la mission (risque élevé)", detail: "Couverture ponctuelle souscrite au moment de la réservation pour électricité, hauteur, gros œuvre, engins", prix: "≈ 2 % du montant" },
  { item: "Commission sur les missions", detail: "Modèle de rémunération en cours d'arbitrage — la plateforme ne détient pas les fonds", prix: "À définir" },
];

export default function TarifsPage() {
  return (
    <>
      <PageHero
        badge="Tarifs"
        title="Une grille simple et transparente"
        subtitle="Ce que coûte réellement l'utilisation de FlexWork. Aucun frais caché, aucune commission sur ce que nous rendons obligatoire."
      />

      <section className="page-shell [&>*]:max-w-3xl py-12 lg:py-16 space-y-8">
        <div className="bg-white border border-[#E7E2F0] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#191224] text-white text-left">
                  <th className="px-5 py-3 font-semibold">Élément</th>
                  <th className="px-5 py-3 font-semibold hidden sm:table-cell">Détail</th>
                  <th className="px-5 py-3 font-semibold text-right">Prix</th>
                </tr>
              </thead>
              <tbody>
                {LIGNES.map((l, i) => (
                  <tr key={l.item} className={i % 2 ? "bg-[#F6F5FA]" : "bg-white"}>
                    <td className="px-5 py-3 font-medium text-[#191224]">{l.item}</td>
                    <td className="px-5 py-3 text-[#6B6478] hidden sm:table-cell">{l.detail}</td>
                    <td className="px-5 py-3 text-right font-semibold text-[#047857]">{l.prix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-[#4C1D95]/5 border border-[#4C1D95]/20 rounded-2xl p-6">
          <h2 className="font-bold text-[#191224] mb-2">Pourquoi cette grille ?</h2>
          <p className="text-sm text-[#4A4258] leading-relaxed">
            Une règle d&apos;équité guide nos tarifs : <strong>nous ne prélevons jamais de commission sur ce que nous rendons
            obligatoire</strong>. Le séquestre et l&apos;assurance à la mission protègent les deux parties, la plateforme ne
            monétise pas la protection qu&apos;elle impose. Les frais définitifs applicables aux missions seront publiés ici
            après arbitrage.
          </p>
        </div>
      </section>
    </>
  );
}
