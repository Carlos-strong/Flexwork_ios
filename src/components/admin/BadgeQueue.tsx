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

// File d'instruction des badges « Vérifié » (2026-09-23).
//
// Sans cet écran, la demande de badge était un cul-de-sac : `badgeStatus` restait
// `en_attente` indéfiniment, parce qu'aucun code n'écrivait jamais `accorde` ni `refuse`, et
// aucune file admin ne listait les demandes. Le prestataire voyait « en attente », cliquait à
// nouveau, et recevait « demande déjà en cours » — une impasse définitive présentée comme un
// état transitoire.
//
// Ce que l'Admin regarde : le DIPLÔME D'ÉTAT déclaré. C'est le pivot du badge, et c'est la
// seule pièce sur laquelle il instruit ici. Les expériences et les références ne sont pas
// réexaminées : elles vivent dans les déclarations.

type BadgeItem = {
  profileId: string;
  userId: string;
  label: string;
  mainDomain: string;
  title: string | null;
  requestedAt: string | null;
  user: { email: string; tel: string; firstname: string | null; lastname: string | null; role: string; kycStatus: string };
  stateDiplomas: { id: string; name: string; year: number | null; institution: string | null; specialty: string | null }[];
};

function fullName(u: BadgeItem["user"]): string {
  return [u.firstname, u.lastname].filter(Boolean).join(" ") || u.email;
}

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

export function BadgeQueue() {
  const [items, setItems] = useState<BadgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Une file qui n'a pas pu être LUE n'est pas une file vide. Sans cet état, un 403 ou une
  // coupure réseau s'affichaient « Aucune demande de badge en attente » — l'écran affirmait
  // quelque chose de faux sur l'état réel des demandes.
  const [loadError, setLoadError] = useState(false);
  // Un refus SANS motif est refusé par la route : on ne propose donc pas le bouton tant que
  // le motif n'est pas écrit, plutôt que de laisser l'utilisateur découvrir l'exigence par un 400.
  const [refusalDraft, setRefusalDraft] = useState<Record<string, string>>({});
  const canAct = useCanActIn("kyc");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/kyc/badges");
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

  async function decide(userId: string, decision: "accorde" | "refuse", refusalReason?: string) {
    setBusy(userId);
    setMsg(null);
    const res = await fetch(`/api/admin/kyc/badges/${userId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, refusalReason }),
    });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.userId !== userId));
      setMsg({ text: decision === "accorde" ? "Badge accordé." : "Demande refusée.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({ text: data.message ?? "Échec de la décision.", ok: false });
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="🎖"
        title="Badges « Vérifié »"
        subtitle="Demandes en attente d'instruction, examinées sur le diplôme d'État déclaré."
        readOnly={!canAct}
      />

      <KpiStrip items={[{ icon: "⏳", label: "Demandes en attente", value: items.length, tone: items.length ? "amber" : "neutral" }]} />

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
            <AdminEmpty>Aucune demande de badge en attente.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Prestataire</th>
                  <th className={tableHead}>Diplôme d&apos;État déclaré</th>
                  <th className={tableHead}>Demandé le</th>
                  <th className={tableHead}>Décision</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.profileId} className="border-b border-[#F1EFE9] align-top last:border-0">
                    <td className={tableCell}>
                      <div className="font-medium">{fullName(item.user)}</div>
                      <div className="text-[12px] text-[#5A5750]">{item.user.email}</div>
                      <div className="text-[12px] text-[#5A5750]">
                        {item.mainDomain} · {item.label} · KYC {item.user.kycStatus}
                      </div>
                    </td>
                    <td className={tableCell}>
                      {item.stateDiplomas.length === 0 ? (
                        // Inéligible : la déclaration qui portait le diplôme a pu être retirée
                        // depuis la demande. Mieux vaut le dire que de laisser accorder un badge
                        // sur rien.
                        <span className="text-[12px] font-semibold text-[#B42318]">Aucun diplôme d&apos;État — inéligible</span>
                      ) : (
                        <ul className="space-y-1">
                          {item.stateDiplomas.map((d) => (
                            <li key={d.id} className="text-[13px]">
                              <span className="font-medium">{d.name}</span>
                              <span className="text-[12px] text-[#5A5750]">
                                {[d.year, d.institution, d.specialty].filter(Boolean).length
                                  ? ` — ${[d.year, d.institution, d.specialty].filter(Boolean).join(" · ")}`
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={tableCell}>{day(item.requestedAt)}</td>
                    <td className={tableCell}>
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={!canAct || busy === item.userId || item.stateDiplomas.length === 0}
                          onClick={() => void decide(item.userId, "accorde")}
                          className={btnPrimary}
                        >
                          Accorder
                        </button>
                        <input
                          value={refusalDraft[item.userId] ?? ""}
                          onChange={(e) => setRefusalDraft({ ...refusalDraft, [item.userId]: e.target.value })}
                          placeholder="Motif du refus (lisible par le prestataire)"
                          className={inputBase}
                          disabled={!canAct}
                        />
                        <button
                          type="button"
                          disabled={!canAct || busy === item.userId || !(refusalDraft[item.userId] ?? "").trim()}
                          onClick={() => void decide(item.userId, "refuse", refusalDraft[item.userId]?.trim())}
                          className={btnDanger}
                        >
                          Refuser
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
        Accorder un badge enregistre une décision datée, tracée dans l&apos;audit admin et dans l&apos;historique de
        vérification. Le badge n&apos;ouvre aucun droit : il ne conditionne ni les missions ni les paiements.
      </AdminNotice>
    </div>
  );
}
