"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  KpiStrip,
  btnPrimary,
  btnSecondary,
  fetchJson,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

type ReportItem = {
  id: string;
  targetType: "declaration" | "profile" | "mission" | "review";
  targetId: string | null;
  reason: string;
  status: "ouvert" | "retenu" | "classe";
  createdAt: string;
  handledAt: string | null;
  decisionNote: string | null;
  reporter: { email: string } | null;
  handledBy: { email: string } | null;
};

const TARGET_LABEL: Record<ReportItem["targetType"], string> = {
  declaration: "Déclaration",
  profile: "Profil",
  mission: "Mission",
  review: "Avis",
};

const STATUS_STYLE: Record<ReportItem["status"], { label: string; cls: string }> = {
  ouvert: { label: "Ouvert", cls: "border-[#FCD89A] bg-[#FEF3C7] text-[#B45309]" },
  retenu: { label: "Retenu", cls: "border-[#F5C2BE] bg-[#FDEDEC] text-[#B42318]" },
  classe: { label: "Classé", cls: "border-[#E2E0D9] bg-[#FAFAF8] text-[#5A5750]" },
};

type Filter = "ouvert" | "retenu" | "classe" | "tous";

/** Où poursuivre, une fois un signalement retenu : la rubrique qui détient le geste. */
function followUp(item: ReportItem): { href: string; label: string } | null {
  if (item.targetType === "declaration") return { href: "/admin/reports/declarations", label: "Retirer la déclaration →" };
  if (item.targetType === "profile") return { href: "/admin/utilisateurs", label: "Suspendre le compte →" };
  return null;
}

/**
 * Signalements — rubrique de flexwork_job, qui y tenait une maquette vide (« Données mock — à
 * remplacer par une vraie API »). Ici elle lit la table `Report`, alimentée par /signalement.
 *
 * Décider d'un signalement ne sanctionne personne : « Retenu » consigne qu'il est fondé, et le
 * geste qui suit (retrait, suspension) se fait depuis sa rubrique, avec son propre motif.
 */
export default function ReportsPage() {
  const canAct = useCanActIn("signalements");

  const [items, setItems] = useState<ReportItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>("ouvert");
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState<{ item: ReportItem; status: "retenu" | "classe" } | null>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchJson<{ items: ReportItem[]; counts: Record<string, number> }>(
      `/api/admin/reports${filter === "tous" ? "" : `?status=${filter}`}`,
    );
    if (res.ok) {
      setItems(res.data.items);
      setCounts(res.data.counts);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide() {
    if (!deciding || note.trim().length < 10) return;
    const res = await fetch(`/api/admin/reports/${deciding.item.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: deciding.status, note: note.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ ok: false, text: data.error === "already_decided" ? "Ce signalement a déjà été décidé." : "La décision n’a pas pu être enregistrée." });
      return;
    }
    setFeedback({
      ok: true,
      text: deciding.status === "retenu" ? "Signalement retenu. Le geste qui suit se fait depuis sa rubrique." : "Signalement classé sans suite.",
    });
    setDeciding(null);
    setNote("");
    load();
  }

  const open = counts.ouvert ?? 0;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="🚩"
        title="Signalements"
        subtitle="Ce que le public a signalé depuis /signalement. Un signalement ouvre une revue : il ne déclenche aucune sanction automatique."
        readOnly={!canAct}
        actions={
          <button onClick={load} className={btnSecondary}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
        }
      />

      <KpiStrip
        items={[
          { icon: "📥", label: "Ouverts", value: open, hint: "en attente de revue", tone: open > 0 ? "amber" : "neutral" },
          { icon: "⚠️", label: "Retenus", value: counts.retenu ?? 0, hint: "jugés fondés" },
          { icon: "🗄️", label: "Classés", value: counts.classe ?? 0, hint: "sans suite" },
        ]}
      />

      {feedback && <AdminNotice tone={feedback.ok ? "green" : "red"}>{feedback.text}</AdminNotice>}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "ouvert", label: "⏳ Ouverts" },
            { id: "retenu", label: "⚠️ Retenus" },
            { id: "classe", label: "🗄️ Classés" },
            { id: "tous", label: "📋 Tous" },
          ] as { id: Filter; label: string }[]
        ).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`h-9 rounded-full border px-4 text-[13px] font-medium transition ${
              filter === f.id ? "border-[#2D5BE3] bg-[#EEF2FD] text-[#2D5BE3]" : "border-[#E2E0D9] bg-white text-[#5A5750] hover:bg-[#FAFAF8]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <AdminCard padded={false}>
        {items === null ? (
          <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
        ) : items.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucun signalement dans cette file.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Reçu</th>
                  <th className={tableHead}>Cible</th>
                  <th className={tableHead}>Motif</th>
                  <th className={tableHead}>Statut</th>
                  <th className={`${tableHead} text-right`}>{canAct ? "Décision" : ""}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E0D9]">
                {items.map((item) => {
                  const next = followUp(item);
                  return (
                    <tr key={item.id} className="align-top">
                      <td className={`${tableCell} whitespace-nowrap`}>
                        {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                        <div className="text-[11px] text-[#9C9A95]">{item.reporter?.email ?? "anonyme"}</div>
                      </td>
                      <td className={tableCell}>
                        {TARGET_LABEL[item.targetType]}
                        {item.targetId && <div className="font-mono text-[11px] text-[#9C9A95]">{item.targetId}</div>}
                      </td>
                      <td className={`${tableCell} max-w-[420px]`}>
                        <p className="whitespace-pre-line">{item.reason}</p>
                        {item.decisionNote && (
                          <p className="mt-1.5 rounded-lg bg-[#FAFAF8] px-2.5 py-1.5 text-[12px] text-[#5A5750]">
                            <strong>{item.handledBy?.email ?? "Modération"}</strong> : {item.decisionNote}
                          </p>
                        )}
                      </td>
                      <td className={tableCell}>
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[item.status].cls}`}>
                          {STATUS_STYLE[item.status].label}
                        </span>
                      </td>
                      <td className={`${tableCell} text-right`}>
                        {canAct && item.status === "ouvert" && (
                          <div className="inline-flex gap-1.5">
                            <button onClick={() => setDeciding({ item, status: "retenu" })} className={btnPrimary}>
                              Retenir
                            </button>
                            <button onClick={() => setDeciding({ item, status: "classe" })} className={btnSecondary}>
                              Classer
                            </button>
                          </div>
                        )}
                        {canAct && item.status === "retenu" && next && (
                          <Link href={next.href} className="text-[12.5px] font-semibold text-[#2D5BE3]" style={{ textDecoration: "none" }}>
                            {next.label}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {deciding && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setDeciding(null)}>
          <div className="w-full max-w-md rounded-[16px] border border-[#E2E0D9] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold">
              {deciding.status === "retenu" ? "Retenir ce signalement" : "Classer sans suite"}
            </h2>
            <p className="mt-1 text-[12.5px] text-[#5A5750]">
              {deciding.status === "retenu"
                ? "Vous consignez que le signalement est fondé. Aucune sanction n’en découle automatiquement."
                : "Le signalement est clos. La décision ne se réécrit pas."}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Motif (10 caractères au moins) — il figure au journal d’audit."
              className="mt-3 w-full rounded-lg border border-[#E2E0D9] p-3 text-[13px] outline-none focus:border-[#2D5BE3]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setDeciding(null)} className={btnSecondary}>
                Annuler
              </button>
              <button onClick={decide} disabled={note.trim().length < 10} className={btnPrimary}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
