"use client";

import { useCallback, useEffect, useState } from "react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  KpiStrip,
  btnDanger,
  btnPrimary,
  inputBase,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

// File d'instruction des comptes de versement Mobile Money (2026-09-23).
//
// La plateforme savait exécuter une mission de bout en bout — publier, candidater, signer,
// séquestrer, valider — sans avoir nulle part où envoyer l'argent : le schéma ne prévoyait ni
// IBAN ni Mobile Money. Cet écran est la contrepartie admin de l'écran P8 du prestataire.
//
// Ce que l'Admin contrôle ici :
//   - l'opérateur et le numéro (format plausible) ;
//   - le TITULAIRE, saisi et non déduit du compte. Un nom qui ne correspond pas à la pièce
//     d'identité est un signal, pas une erreur de saisie — c'est précisément pour le voir que
//     le champ n'est pas pré-rempli ;
//   - le justificatif de domicile, joint au dossier.
//
// La pièce d'identité n'est PAS dans cette file : elle a la sienne (`/admin/kyc`) et son propre
// statut. Un dossier financier ne rejuge pas l'identité, il la suppose acquise.

type PayoutItem = {
  id: string;
  userId: string;
  user: { email: string; tel: string; firstname: string | null; lastname: string | null; role: string; kycStatus: string };
  operator: string;
  operatorLabel: string;
  number: string;
  holder: string;
  submittedAt: string;
  addressProof: { docId: string; status: string } | null;
};

function fullName(u: PayoutItem["user"]): string {
  return [u.firstname, u.lastname].filter(Boolean).join(" ") || u.email;
}

export function PayoutQueue() {
  const [items, setItems] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Idem file des badges : un échec de lecture n'est pas une file vide.
  const [loadError, setLoadError] = useState(false);
  const [refusalDraft, setRefusalDraft] = useState<Record<string, string>>({});
  const canAct = useCanActIn("kyc");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/kyc/payouts");
    if (res.ok) {
      setItems((await res.json()).items ?? []);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(userId: string, decision: "verifie" | "rejete", refusalReason?: string) {
    setBusy(userId);
    setMsg(null);
    const res = await fetch(`/api/admin/kyc/payouts/${userId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, refusalReason }),
    });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.userId !== userId));
      setMsg({ text: decision === "verifie" ? "Compte de versement vérifié." : "Dossier rejeté.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({ text: data.message ?? "Échec de la décision.", ok: false });
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="📲"
        title="Comptes de versement"
        subtitle="Dossiers Mobile Money en attente : opérateur, numéro, titulaire et justificatif de domicile."
        readOnly={!canAct}
      />

      <KpiStrip
        items={[
          { icon: "⏳", label: "Dossiers en attente", value: items.length, tone: items.length ? "amber" : "neutral" },
          { icon: "📲", label: "Opérateurs couverts", value: "MTN · Moov · Celtiis" },
        ]}
      />

      {msg && <AdminNotice tone={msg.ok ? "green" : "red"}>{msg.text}</AdminNotice>}
      {loadError && (
        <AdminNotice tone="amber">
          La file n&apos;a pas pu être chargée — rechargez la page. Elle n&apos;est pas vide pour autant.
        </AdminNotice>
      )}

      <AdminCard title="File d'attente" subtitle="Du plus ancien au plus récent." padded={false}>
        {loading ? (
          <p className="p-5 text-[13px] text-[#5A5750]">Chargement...</p>
        ) : items.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucun compte de versement en attente d&apos;instruction.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Prestataire</th>
                  <th className={tableHead}>Compte de versement</th>
                  <th className={tableHead}>Titulaire</th>
                  <th className={tableHead}>Justificatif</th>
                  <th className={tableHead}>Décision</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-[#F1EFE9] align-top last:border-0">
                    <td className={tableCell}>
                      <div className="font-medium">{fullName(item.user)}</div>
                      <div className="text-[12px] text-[#5A5750]">{item.user.email}</div>
                      <div className="text-[12px] text-[#5A5750]">
                        {item.user.role} · KYC {item.user.kycStatus}
                      </div>
                    </td>
                    <td className={tableCell}>
                      <div className="font-medium">{item.operatorLabel}</div>
                      <div className="text-[12px] text-[#5A5750]">{item.number}</div>
                    </td>
                    <td className={tableCell}>{item.holder}</td>
                    <td className={tableCell}>
                      {item.addressProof ? (
                        <a
                          href={`/admin/kyc?doc=${item.addressProof.docId}`}
                          className="text-[13px] font-medium text-[#2D5BE3] underline"
                        >
                          Voir le justificatif
                        </a>
                      ) : (
                        <span className="text-[12px] font-semibold text-[#B45309]">Non joint</span>
                      )}
                    </td>
                    <td className={tableCell}>
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={!canAct || busy === item.userId}
                          onClick={() => void decide(item.userId, "verifie")}
                          className={btnPrimary}
                        >
                          Vérifier
                        </button>
                        <input
                          value={refusalDraft[item.userId] ?? ""}
                          onChange={(e) => setRefusalDraft({ ...refusalDraft, [item.userId]: e.target.value })}
                          placeholder="Motif du rejet"
                          className={inputBase}
                          disabled={!canAct}
                        />
                        <button
                          type="button"
                          disabled={!canAct || busy === item.userId || !(refusalDraft[item.userId] ?? "").trim()}
                          onClick={() => void decide(item.userId, "rejete", refusalDraft[item.userId]?.trim())}
                          className={btnDanger}
                        >
                          Rejeter
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminNotice tone="blue">
        Un dossier déjà vérifié ne remonte pas dans cette file. Toute modification du numéro par le prestataire le
        repasse en instruction : une validation portait sur un numéro précis.
      </AdminNotice>
    </div>
  );
}
