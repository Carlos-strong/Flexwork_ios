"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import type { DevisDocument } from "@/lib/devis-document";

// Vue du DEVIS DÉFINITIF — pendant de /missions/[id]/contract pour le contrat, et destination
// du bouton « Voir » d'un devis validé ou clôturé dans la rubrique Devis & Contrats.
//
// La page ne compose RIEN : elle affiche le document servi par
// GET .../proposals/[proposalId]/devis/document?format=json, c'est-à-dire le même objet que
// celui rendu en PDF et en HTML (src/lib/devis-document.ts). Un écran qui rebâtirait son
// propre tableau finirait par afficher autre chose que la pièce téléchargée — précisément
// l'écart que buildContractSections avait supprimé côté contrat.
//
// L'écran de négociation (/missions/[id]/devis) reste séparé : il sert à CHIFFRER, celui-ci à
// CONSTATER. Confondre les deux, c'est laisser un champ de saisie sur une pièce justificative.
export default function DevisDocumentPage() {
  const params = useParams();
  const missionId = params.id as string;
  const proposalId = params.proposalId as string;

  const [doc, setDoc] = useState<DevisDocument | null>(null);
  const [definitif, setDefinitif] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdfUrl = `/api/missions/${missionId}/proposals/${proposalId}/devis/document?format=pdf`;

  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}/proposals/${proposalId}/devis/document?format=json`)
      .then((r) => {
        if (r.status === 404) throw new Error("introuvable");
        if (!r.ok) throw new Error("echec");
        return r.json();
      })
      .then((d) => {
        setDoc(d.document);
        setDefinitif(!!d.definitif);
      })
      .catch((e) =>
        setError(
          e.message === "introuvable"
            ? "Ce devis n'existe pas, ou vous n'êtes pas partie à cette candidature."
            : "Impossible de charger le devis."
        )
      );
  }, [missionId, proposalId]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center px-4">
        <p className="text-[13px] text-[#6B6478] text-center">{error}</p>
      </div>
    );
  }
  if (!doc) {
    return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement…</div>;
  }

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-doc [--fw:860px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#6B6478] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#191224]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#191224] font-medium">Devis</span>
        </div>

        <div className="bg-white border border-[#E7E2F0] rounded-xl overflow-hidden">
          {/* En-tête : identité du document + export, même disposition que l'écran du contrat. */}
          <div className="px-4 lg:px-6 py-4 border-b border-[#E7E2F0] flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <FileText className="w-4 h-4 text-[#4C1D95] shrink-0" />
                <h1 className="text-[16px] font-bold">{doc.titre}</h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${
                    definitif
                      ? "bg-[#E7F7EF] text-[#047857] border-[#BBF7D0]"
                      : "bg-[#FFF6E3] text-[#92400E] border-[#FCD34D]"
                  }`}
                >
                  {definitif ? "Prix arrêté" : "En négociation"}
                </span>
              </div>
              <p className="text-[12px] text-[#6B6478] mt-1">
                Référence {doc.reference} • {doc.missionTitre}
              </p>
            </div>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578]"
              style={{ textDecoration: "none" }}
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </a>
          </div>

          <div className="px-4 lg:px-6 py-5 space-y-6">
            <p className="text-[12.5px] leading-relaxed bg-[#F6F5FA] border border-[#E7E2F0] rounded-lg px-3 py-2.5">{doc.mention}</p>

            {/* Parties */}
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { heading: "Le client", party: doc.client },
                { heading: "Le prestataire", party: doc.provider },
              ].map(({ heading, party }) => (
                <div key={heading} className="border border-[#E7E2F0] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-[#F6F5FA] border-b border-[#E7E2F0]">
                    <div className="text-[10.5px] uppercase tracking-wide font-bold text-[#6B6478]">{heading}</div>
                    <div className="text-[13px] font-semibold">{party.name}</div>
                  </div>
                  <dl className="divide-y divide-[#EFEAF8]">
                    {party.lines.map((l) => (
                      <div key={l.label} className="px-3 py-1.5 flex gap-3 text-[12px]">
                        <dt className="text-[#6B6478] w-[86px] shrink-0">{l.label}</dt>
                        <dd className="m-0 min-w-0 break-words">{l.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>

            {/* Détail chiffré */}
            <div>
              <h2 className="text-[13px] font-semibold mb-2">Détail du chiffrage</h2>
              <div className="overflow-x-auto border border-[#E7E2F0] rounded-lg">
                <table className="w-full text-[12.5px] min-w-[620px]">
                  <thead>
                    <tr className="bg-[#F6F5FA] text-[#6B6478] text-[11px] uppercase tracking-wide">
                      <th className="text-left font-bold px-3 py-2">#</th>
                      <th className="text-left font-bold px-3 py-2">Poste</th>
                      <th className="text-right font-bold px-3 py-2">Qté</th>
                      <th className="text-left font-bold px-3 py-2">Unité</th>
                      <th className="text-right font-bold px-3 py-2">P.U.</th>
                      <th className="text-right font-bold px-3 py-2">Montant</th>
                      <th className="text-left font-bold px-3 py-2">Échéance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => (
                      <tr key={l.numero} className="border-t border-[#EFEAF8]">
                        <td className="px-3 py-2 text-[#6B6478] font-mono">{l.numero}</td>
                        <td className="px-3 py-2 font-medium">{l.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.quantite}</td>
                        <td className="px-3 py-2 text-[#6B6478]">{l.unite}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#6B6478]">{l.prixUnitaire}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{l.montant}</td>
                        <td className="px-3 py-2 text-[#6B6478]">{l.echeance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totaux + conditions */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border border-[#E7E2F0] rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#F6F5FA] border-b border-[#E7E2F0] text-[10.5px] uppercase tracking-wide font-bold text-[#6B6478]">
                  Récapitulatif
                </div>
                <dl className="divide-y divide-[#EFEAF8]">
                  {doc.totals.map((t) => (
                    <div
                      key={t.label}
                      className={`px-3 py-2 flex items-center justify-between gap-3 text-[12.5px] ${t.emphasis ? "bg-[#F6F5FA] font-bold" : ""}`}
                    >
                      <dt className={t.emphasis ? "" : "text-[#6B6478]"}>{t.label}</dt>
                      <dd className="m-0 tabular-nums">{t.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="border border-[#E7E2F0] rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#F6F5FA] border-b border-[#E7E2F0] text-[10.5px] uppercase tracking-wide font-bold text-[#6B6478]">
                  Conditions
                </div>
                <dl className="divide-y divide-[#EFEAF8]">
                  {doc.conditions.map((c) => (
                    <div key={c.label} className="px-3 py-2 flex gap-3 text-[12.5px]">
                      <dt className="text-[#6B6478] w-[120px] shrink-0">{c.label}</dt>
                      <dd className="m-0 min-w-0">{c.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            {doc.notes && (
              <div>
                <h2 className="text-[13px] font-semibold mb-2">Message du prestataire</h2>
                <p className="text-[12.5px] text-[#4A4258] leading-relaxed whitespace-pre-wrap">{doc.notes}</p>
              </div>
            )}

            <div>
              <h2 className="text-[13px] font-semibold mb-2">Mentions</h2>
              <ul className="space-y-1.5 pl-4 list-disc">
                {doc.mentionsLegales.map((m, i) => (
                  <li key={i} className="text-[12px] text-[#6B6478] leading-relaxed">{m}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[12px] text-[#6B6478] hover:text-[#191224]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
