"use client";

import { useEffect, useState } from "react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import { AdminPageHeader } from "@/components/admin/admin-ui";

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

// Rubrique « Historique des validations » (module `kyc-historique` de la sidebar du rôle) : liste toutes les
// décisions KYC passées (documents examinés) et permet de révoquer une validation
// potentiellement erronée. Toute révocation est journalisée (AdminAuditLog), tracée
// (VerificationHistoryEntry) et resynchronise l'état KYC du compte (deriveKycStatus).
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/proposals/
// page.tsx (palette #1A1916/#E2E0D9/#2D5BE3) — logique et appels API strictement inchangés.
export default function KycHistoryPage() {
  // Révéler une validation est un geste du pouvoir `kyc` (POST .../revoke exige ce rôle).
  // Le superviseur lit l'historique — c'est même là tout son intérêt : savoir qui a validé
  // quoi — mais ne réécrit pas une décision qu'il n'a pas rendue.
  const canAct = useCanActIn("kyc");

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
    <div className="text-[#1A1916]">
      <div className="space-y-5">
        <AdminPageHeader
          icon="🪪"
          title="KYC — Historique"
          subtitle="Toutes les décisions rendues, avec leur auteur et leur motif. Une décision peut être révoquée, jamais effacée."
          readOnly={!canAct}
        />

        <div className="rounded-xl border border-[#E2E0D9] bg-white p-3.5 text-[12.5px] text-[#5A5750] leading-relaxed">
          Consultez toutes les décisions KYC passées (validations / rejets, par dossier ou par
          document). Une validation potentiellement erronée peut être <strong className="text-[#1A1916]">révoquée</strong> :
          le document repasse en attente et l&apos;état du compte est resynchronisé automatiquement.
        </div>

        {feedback && <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">{feedback}</div>}

        <div className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E0D9]">
            <h3 className="text-[13px] font-semibold">Historique des validations ({history?.length ?? "…"})</h3>
          </div>
          {history === null ? (
            <p className="p-4 lg:p-5 text-[13px] text-[#5A5750]">Chargement…</p>
          ) : history.length === 0 ? (
            <p className="p-4 lg:p-5 text-[13px] text-[#5A5750]">Aucune validation pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] tracking-widest text-[#5A5750] uppercase bg-[#FAFAF8] border-y border-[#E2E0D9]">
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
                      <tr key={h.docId} className="border-b border-[#F4F3EF] last:border-0">
                        <td className="py-2.5 px-4 lg:px-5 text-[#5A5750]">
                          {h.user.email}
                          <br />
                          <span className="text-[11px] text-[#9C9A95]">{h.user.tel}</span>
                          <br />
                          <span className="text-[11px] text-[#9C9A95]">KYC : <strong className="text-[#1A1916]">{h.user.kycStatus}</strong></span>
                        </td>
                        <td className="py-2.5 px-3 text-[#5A5750]">{DOC_LABEL[h.type] ?? h.type}</td>
                        <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}`}>{isVerified ? "Validé" : isRejected ? "Rejeté" : "En attente"}</span></td>
                        <td className="py-2.5 px-3 text-[#5A5750]">{h.reviewedBy ?? "—"}</td>
                        <td className="py-2.5 px-3 text-[12px] text-[#5A5750]">{h.reviewedAt ? new Date(h.reviewedAt).toLocaleString("fr-FR") : "—"}</td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            placeholder="Justification"
                            disabled={!canAct}
                            value={revokeInputs[h.docId] ?? ""}
                            onChange={(e) => setRevokeInputs((prev) => ({ ...prev, [h.docId]: e.target.value }))}
                            className="min-w-[150px] h-8 px-2.5 rounded-md border border-[#E2E0D9] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#2D5BE3]/20 focus:border-[#2D5BE3] disabled:bg-[#FAFAF8] disabled:text-[#9C9A95]"
                          />
                        </td>
                        <td className="py-2.5 px-4 lg:px-5">
                          {canAct ? (
                            <button
                              disabled={revokingId === h.docId}
                              onClick={() => revokeDecision(h)}
                              className="h-8 px-3 rounded-md border border-[#FECACA] bg-white text-[#DC2626] text-[11.5px] font-medium hover:bg-[#FEF2F2] disabled:opacity-50"
                            >
                              {revokingId === h.docId ? "…" : "Révoquer"}
                            </button>
                          ) : (
                            <span className="text-[12px] text-[#9C9A95]">Consultation</span>
                          )}
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
