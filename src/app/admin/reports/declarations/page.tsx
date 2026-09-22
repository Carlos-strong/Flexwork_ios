"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import { AdminPageHeader, btnSecondary } from "@/components/admin/admin-ui";

// Modération (US-306) — « action sur signalement uniquement », jamais de vérification
// systématique (modele-skillafrica-v3-Flexwork.md §5).
//
// L'écran n'était qu'une zone de saisie d'identifiant : il fallait connaître de mémoire le
// cuid de la déclaration signalée, et rien ne montrait ce qui existait ni ce qui avait déjà
// été retiré — un pouvoir sans registre, donc inutilisable. Il devient le tableau de bord du
// rôle : ce qui est publié, ce qui a été retiré, et de quoi retirer le reste.
//
// Le superviseur y vient en consultation : les boutons de retrait disparaissent (la route de
// retrait exige `requireAdminRole("moderation")`), les retraits opérés restent lisibles.
//
// Style harmonisé sur le même modèle Tailwind que missions/[id]/devis/page.tsx
// (palette #1A1916/#E2E0D9/#2D5BE3).

type DeclarationRow = {
  id: string;
  declarationType: string;
  label: string | null;
  insurerName: string | null;
  policyNumber: string | null;
  coverageCeiling: number | null;
  validUntil: string | null;
  declaredAt: string;
  removedAt: string | null;
  removedReason: string | null;
  documentCount: number;
  currentHash: string;
  user: { id: string; email: string; role: string };
};

type Payload = { counts: { active: number; removed: number }; items: DeclarationRow[] };

const TYPE_LABEL: Record<string, string> = { insurance: "Assurance", qualification: "Qualification" };

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
  responsable_chantier: "Responsable chantier",
};

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E0D9] p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: color }} />
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#9C9A95]">{label}</div>
      <div className="mt-1 text-[22px] font-extrabold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[#5A5750]">{sub}</div>}
    </div>
  );
}

export default function AdminModerationPage() {
  const canAct = useCanActIn("signalements");

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<DeclarationRow | null>(null);
  const [justification, setJustification] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/declarations");
    if (res.ok) setPayload(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmRemove() {
    if (!removing || !justification.trim()) return;
    const res = await fetch(`/api/admin/declarations/${removing.id}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification: justification.trim() }),
    });
    if (res.ok) {
      setFeedback({ ok: true, text: "Déclaration retirée, journalisée dans admin_audit_log (append-only, hash chaîné SHA-256)." });
      setRemoving(null);
      setJustification("");
      load();
      return;
    }
    setFeedback({ ok: false, text: "Échec du retrait — la déclaration a peut-être déjà été retirée." });
  }

  const items = payload?.items ?? [];
  const active = items.filter((d) => !d.removedAt);
  const removed = items.filter((d) => d.removedAt);

  return (
    <div className="text-[#1A1916]">
      <div className="space-y-5">
        <AdminPageHeader
          icon="🚩"
          title="Déclarations"
          subtitle="Action sur signalement uniquement. Chaque retrait exige une justification et reste traçable : la déclaration quitte les listes publiques, jamais la chaîne de hachage."
          actions={
            <button onClick={() => load()} className={btnSecondary}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
          }
        />

        {!canAct && (
          <div className="rounded-xl border border-[#E2E0D9] bg-white p-3.5 text-[12.5px] text-[#5A5750]">
            <strong className="text-[#1A1916]">Consultation seule.</strong> Le retrait d&apos;une déclaration appartient au rôle{" "}
            <code className="px-1 py-0.5 rounded bg-[#F4F3EF] text-[12px]">moderation</code> : un contrôleur qui peut réécrire ce qu&apos;il
            contrôle n&apos;en est plus un (§13).
          </div>
        )}

        {feedback && (
          <div
            role={feedback.ok ? "status" : "alert"}
            className={`rounded-xl border p-3 text-[13px] ${feedback.ok ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"}`}
          >
            {feedback.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Déclarations actives" value={payload?.counts.active ?? 0} sub="Visibles publiquement" color="#2D5BE3" />
          <StatCard label="Déclarations retirées" value={payload?.counts.removed ?? 0} sub="Conservées dans la chaîne" color="#B45309" />
          <StatCard label="Assurances" value={active.filter((d) => d.declarationType === "insurance").length} color="#1D4ED8" />
          <StatCard label="Qualifications" value={active.filter((d) => d.declarationType === "qualification").length} color="#7C3AED" />
        </div>

        <div className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
          <div className="px-4 lg:px-5 py-3 border-b border-[#F4F3EF] flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Déclarations reçues</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-[#F4F3EF] text-[#5A5750] font-bold">{items.length} dernières</span>
          </div>

          {loading && items.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px] text-[#9C9A95]">Chargement…</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-10 text-center text-[12px] text-[#9C9A95]">Aucune déclaration enregistrée.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#FAFAF8] text-[10px] font-bold uppercase tracking-wider text-[#9C9A95]">
                  <tr>
                    <th className="px-4 lg:px-5 py-2.5">Déclarant</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Libellé</th>
                    <th className="px-4 py-2.5">Assureur / police</th>
                    <th className="px-4 py-2.5">Valide jusqu&apos;au</th>
                    <th className="px-4 py-2.5">Déclarée le</th>
                    <th className="px-4 py-2.5">État</th>
                    {canAct && <th className="px-4 py-2.5">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F4F3EF] text-[12.5px]">
                  {items.map((d) => (
                    <tr key={d.id} className={d.removedAt ? "bg-[#FFFBF5]" : undefined}>
                      <td className="px-4 lg:px-5 py-3">
                        <div className="font-medium">{d.user.email}</div>
                        <div className="text-[11px] text-[#9C9A95]">{ROLE_LABEL[d.user.role] ?? d.user.role}</div>
                      </td>
                      <td className="px-4 py-3 text-[#5A5750]">{TYPE_LABEL[d.declarationType] ?? d.declarationType}</td>
                      <td className="px-4 py-3 text-[#5A5750]">{d.label ?? "—"}</td>
                      <td className="px-4 py-3 text-[#5A5750]">
                        {d.insurerName ?? "—"}
                        {d.policyNumber && <div className="text-[11px] font-mono text-[#9C9A95]">{d.policyNumber}</div>}
                      </td>
                      <td className="px-4 py-3 text-[#5A5750]">
                        {d.validUntil ? new Date(d.validUntil).toLocaleDateString("fr-FR") : "—"}
                      </td>
                      <td className="px-4 py-3 text-[#5A5750]">{new Date(d.declaredAt).toLocaleDateString("fr-FR")}</td>
                      <td className="px-4 py-3">
                        {d.removedAt ? (
                          <span
                            className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7] text-[#92400E]"
                            title={d.removedReason ?? undefined}
                          >
                            Retirée
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E6F4EE] text-[#2D5BE3]">
                            En ligne
                          </span>
                        )}
                        {d.documentCount > 0 && (
                          <div className="text-[11px] text-[#9C9A95] mt-0.5">
                            {d.documentCount} pièce{d.documentCount > 1 ? "s" : ""}
                          </div>
                        )}
                      </td>
                      {canAct && (
                        <td className="px-4 py-3">
                          {d.removedAt ? (
                            <span className="text-[11px] text-[#9C9A95]">Déjà retirée</span>
                          ) : (
                            <button
                              onClick={() => {
                                setRemoving(d);
                                setJustification("");
                                setFeedback(null);
                              }}
                              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#DC2626] text-white text-[11.5px] font-semibold hover:bg-[#B91C1C] transition-colors"
                            >
                              <Trash2 size={13} />
                              Retirer
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div id="retraits" className="bg-white border border-[#E2E0D9] rounded-xl p-4 lg:p-5 scroll-mt-28">
            <h2 className="text-[13px] font-semibold mb-2 flex items-center gap-2">
              <ShieldCheck size={15} className="text-[#B45309]" /> Retraits opérés
            </h2>
            <ul className="space-y-2 text-[12.5px] text-[#5A5750]">
              {removed.length === 0 && (
                <li className="text-[#9C9A95]">Aucun retrait opéré : aucune déclaration n&apos;a quitté les listes publiques.</li>
              )}
              {removed.map((d) => (
                <li key={d.id} className="border-b border-[#F4F3EF] last:border-0 pb-2 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-[#1A1916]">{d.user.email}</span>
                    <span>
                      {TYPE_LABEL[d.declarationType] ?? d.declarationType}
                      {d.label ? ` — ${d.label}` : ""}
                    </span>
                    <span className="text-[11px] text-[#9C9A95]">
                      le {new Date(d.removedAt!).toLocaleDateString("fr-FR")} · chaîne {d.currentHash.slice(0, 10)}…
                    </span>
                  </div>
                  {d.removedReason && <div className="text-[12px] text-[#92400E] mt-0.5">Motif : {d.removedReason}</div>}
                </li>
              ))}
            </ul>
          </div>
      </div>

      {removing && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4" onClick={() => setRemoving(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold">Retirer cette déclaration ?</h3>
            <p className="text-[12.5px] text-[#5A5750]">
              <strong>{removing.user.email}</strong> — {TYPE_LABEL[removing.declarationType] ?? removing.declarationType}
              {removing.label ? ` : ${removing.label}` : ""}. Elle disparaîtra des listes publiques et restera dans la chaîne de hachage.
            </p>
            <div>
              <label htmlFor="mod-justification" className="block text-[12px] font-semibold text-[#5A5750] mb-1">
                Justification (obligatoire, consignée dans le journal d&apos;audit)
              </label>
              <textarea
                id="mod-justification"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E2E0D9] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#2D5BE3]/20 focus:border-[#2D5BE3]"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRemoving(null)} className="h-9 px-4 rounded-lg border border-[#E2E0D9] text-[13px] font-medium hover:bg-[#FAFAF8]">
                Annuler
              </button>
              <button
                onClick={confirmRemove}
                disabled={!justification.trim()}
                className="h-9 px-4 rounded-lg bg-[#DC2626] text-white text-[13px] font-semibold hover:bg-[#B91C1C] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Retirer la déclaration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
