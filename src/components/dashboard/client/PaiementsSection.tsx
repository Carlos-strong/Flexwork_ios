"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDedupe } from "@/lib/fetch-dedupe";

// Rubrique « Paiements » du client (2026-09-15) — remplace un écran vide qui promettait que les
// paiements « apparaîtront ici » sans que rien ne les y fasse apparaître.
//
// Une ligne par contrat, et une seule question mise en avant : y a-t-il quelque chose à faire ?
// Un complément de financement est le seul geste que ces chiffres peuvent réclamer au client ;
// tout le reste est informatif.

type Item = {
  missionId: string;
  titre: string;
  missionStatus: string;
  currency: string;
  isTimeContract: boolean;
  financialState: string;
  contractual: number;
  funded: number;
  released: number;
  refunded: number;
  held: number;
  owedToProvider: number;
  missing: number;
  fundingPending: boolean;
};

type Payload = {
  items: Item[];
  totals: { funded: number; released: number; refunded: number; held: number; missing: number };
};

const STATE_LABEL: Record<string, { label: string; cls: string }> = {
  non_finance: { label: "À financer", cls: "bg-zinc-100 text-zinc-600" },
  financement_en_attente: { label: "Financement en attente", cls: "bg-amber-50 text-amber-700" },
  sequestre: { label: "Sous séquestre", cls: "bg-[#f0faf5] text-[#008751]" },
  partiellement_libere: { label: "Partiellement versé", cls: "bg-blue-50 text-blue-700" },
  totalement_libere: { label: "Totalement versé", cls: "bg-[#f0faf5] text-[#008751]" },
  cloture: { label: "Clôturé", cls: "bg-zinc-900 text-white" },
};

const fcfa = (n: number, currency = "XOF") => `${Math.round(n).toLocaleString("fr-FR")} ${currency}`;

export default function ClientPaiementsSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchDedupe("/api/dashboard/client-payments")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="bg-white rounded-[20px] border border-gray-100 p-8 text-center text-[13px] text-zinc-500">
        Les paiements n&apos;ont pas pu être chargés. Rechargez la page.
      </div>
    );
  }

  if (!data) {
    return <div className="bg-white rounded-[20px] border border-gray-100 p-8 text-center text-[13px] text-zinc-400">Chargement…</div>;
  }

  if (data.items.length === 0) {
    return (
      <div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center">
        <p className="text-[14px] text-zinc-600 font-medium">Aucun paiement pour l&apos;instant</p>
        <p className="text-[12px] text-zinc-400 mt-1">
          Dès qu&apos;un contrat est signé, son séquestre et ses versements apparaissent ici.
        </p>
      </div>
    );
  }

  const { totals } = data;
  const aCompleter = data.items.filter((i) => i.missing > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Financé", value: totals.funded, hint: "versé au séquestre" },
          { label: "Versé aux prestataires", value: totals.released, hint: "après validation" },
          { label: "Encore au séquestre", value: totals.held, hint: "ni versé, ni rendu" },
          { label: "Remboursé", value: totals.refunded, hint: "revenu vers vous" },
        ].map((t) => (
          <div key={t.label} className="bg-white rounded-[16px] border border-gray-100 p-4">
            <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold">{t.label}</div>
            <div className="text-[18px] font-bold text-[#0A1931] mt-1 tabular-nums">{fcfa(t.value)}</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">{t.hint}</div>
          </div>
        ))}
      </div>

      {aCompleter.length > 0 && (
        <div className="rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          <strong>Financement complémentaire requis : {fcfa(totals.missing)}.</strong>{" "}
          Des travaux validés attendent leur versement sur {aCompleter.length} mission{aCompleter.length > 1 ? "s" : ""}.
        </div>
      )}

      <div className="bg-white rounded-[20px] border border-gray-100 divide-y divide-gray-100 overflow-hidden">
        {data.items.map((i) => {
          const st = STATE_LABEL[i.financialState] ?? STATE_LABEL.non_finance;
          const part = i.contractual > 0 ? Math.min(100, (i.released / i.contractual) * 100) : 0;
          return (
            <Link
              key={i.missionId}
              href={`/missions/${i.missionId}/escrow`}
              className="block px-4 md:px-5 py-3.5 hover:bg-zinc-50 transition-colors"
              style={{ textDecoration: "none" }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[#0A1931] truncate">{i.titre}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    {i.isTimeContract && <span className="text-[11px] text-zinc-400">Au temps</span>}
                    {i.missing > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                        Complément requis : {fcfa(i.missing, i.currency)}
                      </span>
                    )}
                    {i.fundingPending && <span className="text-[11px] text-amber-700">Versement en cours d&apos;autorisation</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-semibold text-[#0A1931] tabular-nums">
                    {fcfa(i.released, i.currency)} <span className="text-zinc-400 font-normal">/ {fcfa(i.contractual, i.currency)}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 tabular-nums">
                    {i.held > 0 ? `${fcfa(i.held, i.currency)} au séquestre` : i.refunded > 0 ? `${fcfa(i.refunded, i.currency)} remboursés` : "versé"}
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1 rounded-full bg-zinc-100 overflow-hidden" aria-hidden>
                <div className="h-full bg-[#008751] rounded-full" style={{ width: `${part}%` }} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
