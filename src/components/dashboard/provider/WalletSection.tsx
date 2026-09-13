"use client";
import { useEffect, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import Link from "next/link";
import { Wallet, ShieldCheck, Clock } from "lucide-react";

type Summary = {
  stats: {
    revenueTotal: number;
    revenueThisMonth: number;
    missionsCompleted: number;
  };
};

function formatFCFA(n: number): string {
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

// Section "Wallet" du dashboard prestataire (/dashboard/<role>/wallet).
// Pas de solde retirable par conception (modèle v3, voir PspEscrowOperation) : la
// plateforme instruit des paiements PSP mais ne détient jamais les fonds. "Revenus totaux"
// est donc la somme des paiements confirmés réellement reçus.
export default function WalletSection() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetchDedupe("/api/dashboard/provider-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  const total = summary?.stats.revenueTotal ?? 0;
  const month = summary?.stats.revenueThisMonth ?? 0;
  const completed = summary?.stats.missionsCompleted ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[#0A1931]">Wallet</h1>
        <p className="text-[12px] text-zinc-500 mt-0.5">Tes revenus issus des paiements sécurisés.</p>
      </div>

      <div className="bg-[#0A1931] rounded-[20px] p-6 text-white relative overflow-hidden">
        <div className="absolute top-[-30%] right-[-10%] w-[200px] h-[200px] rounded-full bg-[#FF7A00]/20 blur-[60px]" />
        <div className="relative">
          <div className="flex items-center gap-2 text-white/60 font-semibold uppercase tracking-widest text-[11px] mb-2">
            <Wallet className="w-4 h-4" /> Revenus totaux
          </div>
          <div className="text-[32px] md:text-[36px] font-bold tracking-tight">{summary ? formatFCFA(total) : "—"}</div>
          <div className="text-[12px] text-white/50 mt-1">
            {summary ? `${formatFCFA(month)} reçus ce mois-ci` : "Chargement…"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="bg-white rounded-[16px] border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">
            <ShieldCheck className="w-4 h-4 text-[#008751]" /> Paiement sécurisé
          </div>
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            Les fonds passent par un PSP (séquestre). La plateforme ne détient jamais ton argent.
          </p>
        </div>
        <div className="bg-white rounded-[16px] border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">
            <Clock className="w-4 h-4 text-[#FF7A00]" /> Ce mois
          </div>
          <div className="text-[20px] font-bold text-[#0A1931]">{summary ? formatFCFA(month) : "—"}</div>
          <div className="text-[12px] text-zinc-400 mt-0.5">reçus sur les 30 derniers jours</div>
        </div>
        <div className="bg-white rounded-[16px] border border-gray-100 p-4">
          <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">Missions terminées</div>
          <div className="text-[20px] font-bold text-[#0A1931]">{summary ? String(completed) : "—"}</div>
          <div className="text-[12px] text-zinc-400 mt-0.5">validées et clôturées</div>
        </div>
      </div>

      <div className="bg-white rounded-[16px] border border-gray-100 p-5 text-[12px] text-zinc-500 leading-relaxed">
        💡 <b>Comment ça marche :</b> à la signature du contrat, le client bloque les fonds chez le PSP.
        À la validation du livrable, la plateforme instruit la libération vers ton compte — c&apos;est la
        protection anti-arnaque de FlexWork.
      </div>
    </div>
  );
}
