"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin-nav";

type HistoryItem = {
  docId: string;
  type: string;
  fileName: string;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  user: { id: string; email: string; tel: string; firstname: string | null; lastname: string | null; kycStatus: string };
};

const DOC_LABEL: Record<string, string> = {
  piece_identite_recto: "Recto",
  piece_identite_verso: "Verso",
  selfie: "Selfie",
  selfie_avec_piece: "Selfie+pièce",
};

// Rubrique "Historique des validations" (sidebar admin → AdminNav) : liste toutes les
// décisions KYC passées (documents examinés) et permet de révoquer une validation
// potentiellement erronée. Toute révocation est journalisée (AdminAuditLog), tracée
// (VerificationHistoryEntry) et resynchronise l'état KYC du compte (deriveKycStatus).
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/proposals/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
export default function KycHistoryPage() {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [revokeInputs, setRevokeInputs] = useState<Record<string, string>>({});
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadHistory() {
    const res = await fetch("/api/admin/kyc/history");
    if (res.ok) setHistory((await res.json()).history);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function revokeDecision(h: HistoryItem) {
    const justification = revokeInputs[h.docId]?.trim();
    if (!justification) {
      setFeedback("Justification obligatoire pour révoquer une validation.");
      return;
    }
    if (!window.confirm(`Révoquer la validation du document « ${DOC_LABEL[h.type] ?? h.type} » pour ${h.user.email} ?`)) return;
    setFeedback(null);
    setRevokingId(h.docId);
    const res = await fetch(`/api/admin/kyc/${h.user.id}/documents/${h.docId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification }),
    });
    setRevokingId(null);
    if (res.ok) {
      setFeedback("Validation révoquée — le dossier repasse en attente de revue.");
      setRevokeInputs((prev) => ({ ...prev, [h.docId]: "" }));
      loadHistory();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback(data.error === "not_reviewed" ? "Ce document n'a pas de validation à révoquer." : "Échec de la révocation.");
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[1400px] mx-auto px-4 py-5 space-y-4">
        <h1 className="text-[18px] font-bold">Admin KYC — Historique des validations</h1>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12.5px] text-[#475569] leading-relaxed">
          Consultez toutes les décisions KYC passées (validations / rejets, par dossier ou par
          document). Une validation potentiellement erronée peut être <strong className="text-[#0f172a]">révoquée</strong> :
          le document repasse en attente et l&apos;état du compte est resynchronisé automatiquement.
        </div>

        {feedback && <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">{feedback}</div>}

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]">
            <h3 className="text-[13px] font-semibold">Historique des validations ({history?.length ?? "…"})</h3>
          </div>
          {history === null ? (
            <p className="p-4 lg:p-5 text-[13px] text-[#64748B]">Chargement…</p>
          ) : history.length === 0 ? (
            <p className="p-4 lg:p-5 text-[13px] text-[#64748B]">Aucune validation pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-y border-[#E2E8F0]">
                    <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Utilisateur</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Document</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Statut</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Réviseur</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Date</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Justification (révocation)</th>
                    <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const isVerified = h.status === "verifie";
                    const isRejected = h.status === "rejete";
                    const badgeClass = isVerified
                      ? "bg-[#DCFCE7] text-[#166534]"
                      : isRejected
                        ? "bg-[#FEE2E2] text-[#B91C1C]"
                        : "bg-[#FEF9C3] text-[#854D0E]";
                    return (
                      <tr key={h.docId} className="border-b border-[#F1F5F9] last:border-0">
                        <td className="py-2.5 px-4 lg:px-5 text-[#475569]">
                          {h.user.email}
                          <br />
                          <span className="text-[11px] text-[#94A3B8]">{h.user.tel}</span>
                          <br />
                          <span className="text-[11px] text-[#94A3B8]">KYC : <strong className="text-[#0f172a]">{h.user.kycStatus}</strong></span>
                        </td>
                        <td className="py-2.5 px-3 text-[#475569]">{DOC_LABEL[h.type] ?? h.type}</td>
                        <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}`}>{isVerified ? "Validé" : isRejected ? "Rejeté" : "En attente"}</span></td>
                        <td className="py-2.5 px-3 text-[#475569]">{h.reviewedBy ?? "—"}</td>
                        <td className="py-2.5 px-3 text-[12px] text-[#475569]">{h.reviewedAt ? new Date(h.reviewedAt).toLocaleString("fr-FR") : "—"}</td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            placeholder="Justification"
                            value={revokeInputs[h.docId] ?? ""}
                            onChange={(e) => setRevokeInputs((prev) => ({ ...prev, [h.docId]: e.target.value }))}
                            className="min-w-[150px] h-8 px-2.5 rounded-md border border-[#E2E8F0] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                          />
                        </td>
                        <td className="py-2.5 px-4 lg:px-5">
                          <button
                            disabled={revokingId === h.docId}
                            onClick={() => revokeDecision(h)}
                            className="h-8 px-3 rounded-md border border-[#FECACA] bg-white text-[#DC2626] text-[11.5px] font-medium hover:bg-[#FEF2F2] disabled:opacity-50"
                          >
                            {revokingId === h.docId ? "…" : "Révoquer"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
