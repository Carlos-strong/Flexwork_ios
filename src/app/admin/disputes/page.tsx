"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import { AdminPageHeader, StatCard, btnSecondary, formatXof } from "@/components/admin/admin-ui";

// Médiation — aligné sur formulaires-flexwork-tous-profils.html.
// L'admin propose, ne tranche jamais. Double validation pour les rejets.
// Style harmonisé sur le même modèle Tailwind que missions/[id]/devis/page.tsx
// (palette #1A1916/#E2E0D9/#2D5BE3).
//
// Répartition financière (2026-09-15) : la proposition porte désormais ses montants — libérer au
// prestataire, rembourser au client, et, implicitement, maintenir gelé le reste (§24). Ils ne
// s'exécutent qu'une fois acceptés par les DEUX parties (POST .../respond).
//
// Tableau de bord du rôle (2026-09-21) : la page n'était qu'un formulaire réclamant un
// identifiant de médiation saisi de mémoire, alors que `GET /api/admin/mediations/queue`
// existait précisément pour alimenter cet écran. Un pouvoir sans file d'attente oblige à
// deviner ce sur quoi on travaille.
const inputCls =
  "w-full h-10 px-3 rounded-lg border border-[#E7E2F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]";

type MediationItem = {
  id: string;
  reason: string;
  proposedResolution: string | null;
  createdAt: string;
  openedBy: string;
  mission: { id: string; titre: string };
};

type FinanceTotals = { held: number; payables: Record<string, { count: number; amount: number }> };



export default function AdminMediationPage() {
  // Le superviseur lit les litiges (§13) mais ne propose pas : `POST .../propose` exige
  // `requireAdminRole("mediation")`.
  const canAct = useCanActIn("litiges");

  const [mediationId, setMediationId] = useState("");
  const [resolution, setResolution] = useState("");
  const [justification, setJustification] = useState("");
  const [releaseAmount, setReleaseAmount] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [items, setItems] = useState<MediationItem[] | null>(null);
  const [finance, setFinance] = useState<FinanceTotals | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [queueRes, financeRes] = await Promise.all([
      fetch("/api/admin/mediations/queue"),
      fetch("/api/admin/finance"),
    ]);
    if (queueRes.ok) setItems((await queueRes.json()).items);
    if (financeRes.ok) {
      const data = await financeRes.json();
      setFinance({ held: data.total?.held ?? 0, payables: data.payables ?? {} });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/admin/mediations/${mediationId}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposedResolution: resolution,
        justification,
        resolutionAmount: releaseAmount ? Math.round(Number(releaseAmount)) : undefined,
        refundAmount: refundAmount ? Math.round(Number(refundAmount)) : undefined,
      }),
    });
    if (res.ok) {
      setFeedback({ ok: true, text: "Proposition envoyée aux deux parties — en attente de leur acceptation ou refus." });
      setResolution("");
      setReleaseAmount("");
      setRefundAmount("");
      setJustification("");
      load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setFeedback({
      ok: false,
      text:
        data.error === "amount_exceeds_escrow"
          ? `La répartition dépasse ce qui reste au séquestre (${Number(data.held ?? 0).toLocaleString("fr-FR")} XOF).`
          : data.error === "mediation_closed"
            ? "Cette médiation est déjà close."
            : data.error === "forbidden_wrong_admin_role"
              ? "Refusé : la proposition de résolution exige le rôle admin « mediation »."
              : "Échec de l'envoi — vérifiez l'identifiant de la médiation.",
    });
  }

  const open = items ?? [];
  const withProposal = open.filter((m) => m.proposedResolution).length;
  const awaitingProposal = open.filter((m) => !m.proposedResolution);
  const oldest = open[0] ?? null;

  return (
    <div className="text-[#191224]">
      <div className="space-y-5">
        <AdminPageHeader
          icon="⚖️"
          title="Litiges"
          subtitle="Vous proposez, vous ne tranchez pas : la résolution ne s’exécute qu’acceptée par les deux parties."
          readOnly={!canAct}
          actions={
            <button onClick={() => load()} className={btnSecondary}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Médiations ouvertes" value={open.length} sub="Litiges en cours" color={open.length > 0 ? "#B42318" : "#4C1D95"} />
          <StatCard label="Sans proposition" value={awaitingProposal.length} sub="À instruire" color={awaitingProposal.length > 0 ? "#B45309" : "#4C1D95"} />
          <StatCard label="Proposition en attente" value={withProposal} sub="Accord des deux parties requis" color="#1D4ED8" />
          <StatCard
            label="Fonds au séquestre"
            value={finance ? formatXof(finance.held) : "—"}
            sub={finance ? `${finance.payables.validated?.count ?? 0} payable(s) à instruire` : "Chargement…"}
            color="#4C1D95"
          />
        </div>

        {!canAct && (
          <div className="rounded-xl border border-[#E7E2F0] bg-white p-3.5 text-[12.5px] text-[#6B6478]">
            <strong className="text-[#191224]">Consultation seule.</strong> Proposer une résolution appartient au rôle{" "}
            <code className="px-1 py-0.5 rounded bg-[#EFEAF8] text-[12px]">mediation</code> — un contrôleur qui peut réécrire ce qu&apos;il
            contrôle n&apos;en est plus un (§13).
          </div>
        )}

        <div className="bg-white border border-[#E7E2F0] rounded-xl overflow-hidden">
          <div className="px-4 lg:px-5 py-3 border-b border-[#EFEAF8] flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Litiges ouverts</h2>
            <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-[#EFEAF8] text-[#6B6478]">
              Résolution non contraignante — modele-skillafrica-v3 §9
            </span>
          </div>
          {loading && open.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px] text-[#9A93A8]">Chargement…</div>
          ) : open.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px] text-[#9A93A8]">Aucune médiation ouverte.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#F6F5FA] text-[10px] font-bold uppercase tracking-wider text-[#9A93A8]">
                  <tr>
                    <th className="px-4 lg:px-5 py-2.5">Mission</th>
                    <th className="px-4 py-2.5">Motif</th>
                    <th className="px-4 py-2.5">Ouvert par</th>
                    <th className="px-4 py-2.5">Ouvert le</th>
                    <th className="px-4 py-2.5">Proposition</th>
                    {canAct && <th className="px-4 py-2.5">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEAF8] text-[12.5px]">
                  {open.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 lg:px-5 py-3">
                        <div className="font-medium">{m.mission.titre}</div>
                        <div className="text-[11px] font-mono text-[#9A93A8]">#{m.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-3 text-[#6B6478]">{m.reason}</td>
                      <td className="px-4 py-3 text-[#6B6478]">{m.openedBy}</td>
                      <td className="px-4 py-3 text-[#6B6478]">{new Date(m.createdAt).toLocaleDateString("fr-FR")}</td>
                      <td className="px-4 py-3 text-[#6B6478]">{m.proposedResolution ?? "—"}</td>
                      {canAct && (
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              setMediationId(m.id);
                              setFeedback(null);
                              document.getElementById("mediation-id")?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                            className="h-8 px-3 rounded-full bg-[#4C1D95] text-white text-[11.5px] font-semibold hover:bg-[#3B1578] transition-colors"
                          >
                            Proposer
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#FDE68A] bg-[#FFF6E3] p-3.5 text-[12.5px] text-[#92400E] leading-relaxed">
          <strong>Vous proposez, vous ne tranchez pas.</strong> Ne jamais libérer ou bloquer de fonds unilatéralement.
          Toute proposition doit être soumise à l&apos;acceptation des deux parties.{oldest ? ` Le plus ancien litige ouvert date du ${new Date(oldest.createdAt).toLocaleDateString("fr-FR")}.` : ""}
        </div>

        {feedback && (
          <div
            className={`rounded-xl border p-3 text-[13px] ${feedback.ok ? "border-[#BFDBFE] bg-[#EAF1FF] text-[#1D4ED8]" : "border-[#FECACA] bg-[#FEECEB] text-[#B42318]"}`}
            role={feedback.ok ? "status" : "alert"}
          >
            {feedback.text}
          </div>
        )}

        {canAct && (
        <div id="proposer" className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5 max-w-[820px] scroll-mt-28">
          <h3 className="text-[13px] font-semibold mb-3">Proposer une résolution</h3>
          <form onSubmit={handlePropose} className="space-y-3">
            <div>
              <label htmlFor="mediation-id" className="block text-[12px] font-medium text-[#6B6478] mb-1">Identifiant de la médiation</label>
              <input id="mediation-id" type="text" required value={mediationId} onChange={(e) => setMediationId(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="mediation-resolution" className="block text-[12px] font-medium text-[#6B6478] mb-1">Proposition de résolution</label>
              <textarea
                id="mediation-resolution"
                rows={4} required minLength={5} value={resolution} onChange={(e) => setResolution(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E7E2F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="mediation-release" className="block text-[12px] font-medium text-[#6B6478] mb-1">Libérer au prestataire (XOF)</label>
                <input id="mediation-release" type="number" min={0} step={500} value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder="0" className={`${inputCls} tabular-nums`} />
              </div>
              <div>
                <label htmlFor="mediation-refund" className="block text-[12px] font-medium text-[#6B6478] mb-1">Rembourser au client (XOF)</label>
                <input id="mediation-refund" type="number" min={0} step={500} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="0" className={`${inputCls} tabular-nums`} />
              </div>
            </div>
            <p className="text-[11.5px] text-[#6B6478]">
              Ce qui n&apos;est ni libéré ni remboursé reste gelé au séquestre. Laissez les deux montants vides pour une résolution non
              financière.
            </p>
            <div>
              <label htmlFor="mediation-justification" className="block text-[12px] font-medium text-[#6B6478] mb-1">Justification (obligatoire)</label>
              <input id="mediation-justification" type="text" required value={justification} onChange={(e) => setJustification(e.target.value)} className={inputCls} />
            </div>
            <button type="submit" className="h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] transition-colors">
              Soumettre la proposition aux deux parties
            </button>
          </form>
        </div>
        )}
      </div>
    </div>
  );
}
