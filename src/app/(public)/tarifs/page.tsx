import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "Tarifs — FlexWork" };

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

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-8">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0f172a] text-white text-left">
                <th className="px-5 py-3 font-semibold">Élément</th>
                <th className="px-5 py-3 font-semibold hidden sm:table-cell">Détail</th>
                <th className="px-5 py-3 font-semibold text-right">Prix</th>
              </tr>
            </thead>
            <tbody>
              {LIGNES.map((l, i) => (
                <tr key={l.item} className={i % 2 ? "bg-[#F8FAF9]" : "bg-white"}>
                  <td className="px-5 py-3 font-medium text-[#0f172a]">{l.item}</td>
                  <td className="px-5 py-3 text-[#64748B] hidden sm:table-cell">{l.detail}</td>
                  <td className="px-5 py-3 text-right font-semibold text-[#008751]">{l.prix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-[#008751]/5 border border-[#008751]/20 rounded-2xl p-6">
          <h2 className="font-bold text-[#0f172a] mb-2">Pourquoi cette grille ?</h2>
          <p className="text-sm text-[#475569] leading-relaxed">
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
