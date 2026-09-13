"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { ValidationClientView } from "@/components/validation-client/ValidationClientView";
import { releasableBeforeRetention, retentionAmount, totalRetentionAmount } from "@/lib/jalons";

type Mission = { id: string; titre: string; budget: number; currency: string; status: string; isOwner: boolean; contractPrice: number | null; escrowHoldStatus: string | null; escrowHoldReference: string | null };
type Jalon = { id: string; ordre: number; titre: string; montant: number; status: string };

type SplitRow = { titre: string; montant: string };

// Reprend public/flexwork-ui/payment-escrow.html — instruction HOLD au PSP (US-501), puis
// RELEASE une fois le livrable soumis (US-504). La plateforme ne détient jamais les fonds :
// c'est une instruction transmise, jamais un mouvement de solde interne.
// Paiement fractionné (2026-08-06) : si le contrat a des jalons, cette page pilote chaque
// jalon indépendamment (financer / scinder). La décision sur un livrable déjà soumis
// (vérifier/valider/rejeter les preuves) est déléguée à ValidationClientView
// (src/components/validation-client/ValidationClientView.tsx, 2026-09-03) — composant
// factorisé (règle R03). La vue plein écran « Validation Client » est désormais /missions/[id]
// pour le client propriétaire (missions/[id]/validation-client redirige vers elle).
export default function EscrowPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const router = useRouter();
  const [mission, setMission] = useState<Mission | null>(null);
  const [jalons, setJalons] = useState<Jalon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [splitRows, setSplitRows] = useState<SplitRow[]>([{ titre: "", montant: "" }, { titre: "", montant: "" }]);

  // Retenue de garantie figée au contrat (mode J4, 0 partout ailleurs). La page annonçait le
  // montant nominal de chaque jalon sans jamais dire qu'une part en resterait au séquestre :
  // le client finançait 600 000 en croyant que 600 000 seraient libérés à la validation.
  const [retentionRate, setRetentionRate] = useState(0);

  function reload() {
    fetchDedupe(`/api/missions/${missionId}`).then((r) => (r.ok ? r.json() : null)).then(setMission);
    fetchDedupe(`/api/missions/${missionId}/jalons`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setJalons(d.items ?? []));
    fetchDedupe(`/api/missions/${missionId}/contract`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (typeof c?.retentionRate === "number") setRetentionRate(c.retentionRate); })
      .catch(() => {});
  }

  useEffect(reload, [missionId]);

  async function handleHold(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting("whole");
    const res = await fetch(`/api/missions/${missionId}/escrow/hold`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "psp_not_enabled"
          ? "Le montage PSP n'est pas encore activé pour cette zone (prérequis juridique en cours de validation)."
          : data.error === "effective_insurance_required"
            ? "Une assurance effective est requise avant de démarrer cette mission à risque élevé."
            : "Échec de la mise sous séquestre."
      );
      return;
    }
    const data = await res.json().catch(() => ({}));
    // PSP virtuelle en mode console : l'instruction est `pending` — le client autorise le
    // paiement sur l'écran Mobile Money simulé (puis webhook signé → fonds sous séquestre).
    if (data.pspRedirect?.reference) {
      const q = new URLSearchParams({
        ref: data.pspRedirect.reference,
        amount: String(data.pspRedirect.amount),
        currency: data.pspRedirect.currency ?? "XOF",
        missionId,
      });
      router.push(`/psp-sandbox/payer?${q.toString()}`);
      return;
    }
    router.push("/client/dashboard");
  }

  async function holdJalon(jalonId: string) {
    setError(null);
    setSubmitting(jalonId);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/hold`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "psp_not_enabled"
          ? "Le montage PSP n'est pas encore activé pour cette zone."
          : data.error === "effective_insurance_required"
            ? "Une assurance effective est requise avant de démarrer cette mission à risque élevé."
            : "Échec de la mise sous séquestre de ce jalon."
      );
      return;
    }
    const data = await res.json().catch(() => ({}));
    // PSP virtuelle en mode console : redirection vers l'écran d'autorisation Mobile Money.
    if (data.pspRedirect?.reference) {
      const q = new URLSearchParams({
        ref: data.pspRedirect.reference,
        amount: String(data.pspRedirect.amount),
        currency: data.pspRedirect.currency ?? "XOF",
        missionId,
      });
      router.push(`/psp-sandbox/payer?${q.toString()}`);
      return;
    }
    reload();
  }

  function openSplit(jalonId: string) {
    setSplittingId(jalonId);
    setSplitRows([{ titre: "", montant: "" }, { titre: "", montant: "" }]);
  }

  async function submitSplit(jalon: Jalon) {
    setError(null);
    const parts = splitRows
      .filter((r) => r.titre.trim() && Number(r.montant) > 0)
      .map((r) => ({ titre: r.titre.trim(), montant: Number(r.montant) }));
    setSubmitting(jalon.id);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalon.id}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts }),
    });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "jalons_sum_mismatch"
          ? `La somme des parts doit être exactement égale au montant du jalon (${jalon.montant.toLocaleString("fr-FR")}).`
          : "Échec de la scission du jalon."
      );
      return;
    }
    setSplittingId(null);
    reload();
  }

  if (!mission || jalons === null) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Chargement...</div>;

  const usesJalons = jalons.length > 0;
  const splitTotal = splitRows.reduce((sum, r) => sum + (Number(r.montant) || 0), 0);
  const splittingJalon = jalons.find((j) => j.id === splittingId) ?? null;
  const splitValid = splittingJalon && splitRows.filter((r) => r.titre.trim() && Number(r.montant) > 0).length >= 2 && Math.abs(splitTotal - splittingJalon.montant) < 0.01;

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[860px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">Séquestre</span>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold">Paiement sous séquestre</h1>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] text-[11px] font-semibold">Phase 5{usesJalons ? " — paiement par jalons" : ""}</span>
          </div>

          <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1E40AF] leading-relaxed">
            <strong>Flexwork ne détient jamais les fonds.</strong> Votre paiement est séquestré chez notre prestataire
            de paiement agréé. Les fonds ne seront libérés au prestataire que sur validation de la livraison{usesJalons ? ", jalon par jalon" : " ou acceptation tacite après 7 jours"}.
          </div>

          <div className="rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] p-4 space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-[#64748B]">Mission</span><strong className="text-[#0f172a]">{mission.titre}</strong>
            </div>
            <div className="flex items-center justify-between text-[15px]">
              <span className="text-[#64748B]">Total</span><strong className="text-[#008751]">{(mission.contractPrice ?? mission.budget).toLocaleString("fr-FR")} {mission.currency}</strong>
            </div>
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}

          {/* Instruction HOLD auto-déclenchée à la contre-signature du client (workflow étape 5) :
              en attente de confirmation PSP — ne pas proposer un second paiement. */}
          {!usesJalons && mission.escrowHoldStatus === "pending" && mission.isOwner && (
            <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E]">
              <strong>Instruction de séquestre envoyée.</strong> Le montant ({(mission.contractPrice ?? mission.budget).toLocaleString("fr-FR")} {mission.currency})
              a été déclenché automatiquement à la signature du contrat — en attente de confirmation du prestataire de paiement.
              {mission.escrowHoldReference && (
                <Link
                  href={`/psp-sandbox/payer?ref=${encodeURIComponent(mission.escrowHoldReference)}&missionId=${mission.id}`}
                  className="block mt-1.5 text-[12.5px] text-[#008751] font-semibold"
                  style={{ textDecoration: "none" }}
                >
                  Autoriser le paiement (sandbox PSP virtuelle) →
                </Link>
              )}
            </div>
          )}

          {!usesJalons && mission.status === "contrat_signe" && mission.isOwner && !mission.escrowHoldStatus && (
            <form onSubmit={handleHold} className="space-y-3">
              <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E]">
                En validant, vous autorisez le PSP agréé à mettre sous séquestre le montant indiqué. Flexwork
                n&apos;apparaît pas comme bénéficiaire de ce paiement.
              </div>
              <button type="submit" disabled={submitting === "whole"} className="w-full h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
                {submitting === "whole" ? "Envoi..." : "Payer et séquestrer les fonds"}
              </button>
            </form>
          )}

          {!mission.isOwner && <p className="text-[13px] text-[#64748B]">Seul le client peut déclencher les mouvements d&apos;escrow.</p>}
        </div>

        {/* Financement par jalon (Financer/Scinder) — section distincte : la décision sur un
            livrable déjà soumis (table Validation Client ci-dessous) ne couvre pas le
            financement. */}
        {usesJalons && totalRetentionAmount(jalons, retentionRate) > 0 && (
          <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-[12.5px] text-[#92400E] leading-relaxed">
            <strong>Retenue de garantie — {Math.round(retentionRate * 100)} % par jalon.</strong>{" "}
            À la validation de chaque jalon, {Math.round(retentionRate * 100)} % de son montant restent au séquestre.
            La retenue cumulée, soit {totalRetentionAmount(jalons, retentionRate).toLocaleString("fr-FR")} {mission.currency},
            est versée au prestataire en une seule fois une fois tous les jalons validés.
          </div>
        )}

        {usesJalons && mission.isOwner && jalons.some((j) => j.status === "en_attente") && (
          <div className="space-y-3">
            {jalons.filter((j) => j.status === "en_attente").map((j) => (
              <div key={j.id} className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <strong className="text-[13px]">#{j.ordre} — {j.titre}</strong>
                    <div className="text-[12.5px] mt-0.5 text-[#64748B]">En attente de financement</div>
                  </div>
                  <div className="text-right shrink-0">
                    <strong className="text-[#008751] text-[13px]">{j.montant.toLocaleString("fr-FR")} {mission.currency}</strong>
                    {retentionAmount(j.montant, retentionRate) > 0 && (
                      <div className="text-[11px] text-[#92400E] mt-0.5 leading-tight max-w-[190px]">
                        {releasableBeforeRetention(j.montant, retentionRate).toLocaleString("fr-FR")} libérés à la validation,{" "}
                        {retentionAmount(j.montant, retentionRate).toLocaleString("fr-FR")} retenus en garantie
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2.5">
                  <button disabled={submitting === j.id} onClick={() => holdJalon(j.id)} className="flex-1 h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
                    {submitting === j.id ? "Envoi..." : "Financer ce jalon"}
                  </button>
                  <button onClick={() => openSplit(j.id)} className="h-10 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
                    Scinder
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <ValidationClientView missionId={missionId} onMissionChange={(m) => setMission((prev) => (prev ? { ...prev, status: m.status } : prev))} />

        <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>

      {splittingJalon && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSplittingId(null)} />
          <div className="relative w-full max-w-[480px] bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
            <h3 className="text-[13px] font-semibold mb-2">Scinder le jalon « {splittingJalon.titre} »</h3>
            <p className="text-[12.5px] text-[#64748B] mb-3 leading-relaxed">
              Répartissez le montant de <strong className="text-[#0f172a]">{splittingJalon.montant.toLocaleString("fr-FR")} {mission.currency}</strong> entre
              au moins 2 sous-jalons. La somme doit rester exactement égale (le total du contrat signé ne change jamais).
            </p>
            <div className="space-y-2">
              {splitRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text" placeholder={`Sous-jalon ${i + 1} — titre`} value={row.titre}
                    onChange={(e) => setSplitRows((rows) => rows.map((r, j) => (j === i ? { ...r, titre: e.target.value } : r)))}
                    className="flex-[2] h-9 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                  />
                  <input
                    type="number" placeholder="Montant" value={row.montant}
                    onChange={(e) => setSplitRows((rows) => rows.map((r, j) => (j === i ? { ...r, montant: e.target.value } : r)))}
                    className="flex-1 h-9 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                  />
                  {splitRows.length > 2 && (
                    <button type="button" onClick={() => setSplitRows((rows) => rows.filter((_, j) => j !== i))} className="h-9 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[13px] hover:bg-[#F8FAF9]">×</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setSplitRows((rows) => [...rows, { titre: "", montant: "" }])} className="mt-2 h-8 px-3 rounded-md border border-[#E2E8F0] bg-white text-[11px] font-medium hover:bg-[#F1F5F9]">
              + Ajouter une part
            </button>
            <p className={`text-[12.5px] mt-2 ${Math.abs(splitTotal - splittingJalon.montant) < 0.01 ? "text-[#008751]" : "text-[#E8112D]"}`}>
              Total réparti : <span>{splitTotal.toLocaleString("fr-FR")}</span> / <span>{splittingJalon.montant.toLocaleString("fr-FR")}</span>
            </p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setSplittingId(null)} className="flex-1 h-10 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">Annuler</button>
              <button disabled={!splitValid || submitting === splittingJalon.id} onClick={() => submitSplit(splittingJalon)} className="flex-1 h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
                {submitting === splittingJalon.id ? "Envoi..." : "Confirmer la scission"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
