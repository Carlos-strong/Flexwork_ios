"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  KpiStrip,
  btnDanger,
  btnPrimary,
  btnSecondary,
  fetchJson,
  inputBase,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

type UserRow = {
  id: string;
  email: string;
  tel: string;
  firstname: string | null;
  lastname: string | null;
  role: string;
  status: "active" | "suspended" | "banned";
  kycStatus: "en_attente" | "verifie" | "rejete";
  isAdmin: boolean;
  adminRole: string | null;
  country: string | null;
  createdAt: string;
};

type Payload = {
  items: UserRow[];
  total: number;
  counts: { status: Record<string, number>; kyc: Record<string, number> };
};

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP / Autres",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
  responsable_chantier: "Responsable chantier",
};

const KYC_STYLE: Record<UserRow["kycStatus"], { label: string; cls: string }> = {
  verifie: { label: "✅ Vérifié", cls: "bg-[#E6F5EE] text-[#1A7A4A]" },
  en_attente: { label: "⏳ En attente", cls: "bg-[#FEF9E7] text-[#B45309]" },
  rejete: { label: "❌ Rejeté", cls: "bg-[#FDEDEC] text-[#B42318]" },
};

const STATUS_STYLE: Record<UserRow["status"], { label: string; cls: string }> = {
  active: { label: "Actif", cls: "border-[#9FD4B4] bg-[#E6F5EE] text-[#1A7A4A]" },
  suspended: { label: "Suspendu", cls: "border-[#FCD89A] bg-[#FEF3C7] text-[#B45309]" },
  banned: { label: "Banni", cls: "border-[#F5C2BE] bg-[#FDEDEC] text-[#B42318]" },
};

// Filtres repris de flexwork_job (Tous / Validés / En attente / Rejetés), plus les suspendus :
// c'est la file de travail de la Modération sur cet écran.
const FILTERS: { id: string; label: string; query: string }[] = [
  { id: "tous", label: "📋 Tous", query: "" },
  { id: "verifie", label: "✅ Vérifiés", query: "kyc=verifie" },
  { id: "en_attente", label: "⏳ En attente", query: "kyc=en_attente" },
  { id: "rejete", label: "❌ Rejetés", query: "kyc=rejete" },
  { id: "suspended", label: "⏸ Suspendus", query: "status=suspended" },
];

/**
 * Utilisateurs — rubrique de flexwork_job, sous séparation des pouvoirs.
 *
 * Tous les rôles qui voient cet écran lisent la même liste. Un seul y agit : la Modération,
 * qui suspend (ou réactive) un compte sur signalement, motif obligatoire. Le KYC et le
 * superviseur n'ont pas le bouton — ils ne le verraient que pour récolter un 403.
 */
export default function UtilisateursPage() {
  const canAct = useCanActIn("utilisateurs");

  const [data, setData] = useState<Payload | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("tous");
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<UserRow | null>(null);
  const [justification, setJustification] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = [FILTERS.find((f) => f.id === filter)?.query, query ? `q=${encodeURIComponent(query)}` : ""]
      .filter(Boolean)
      .join("&");
    const res = await fetchJson<Payload>(`/api/admin/users${params ? `?${params}` : ""}`);
    if (res.ok) setData(res.data);
    setLoading(false);
  }, [filter, query]);

  useEffect(() => {
    load();
  }, [load]);

  // Recherche différée : une requête par frappe interrogerait la base à chaque lettre.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  async function changeStatus() {
    if (!target || justification.trim().length < 10) return;
    const next = target.status === "active" ? "suspended" : "active";
    const res = await fetch(`/api/admin/users/${target.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, justification: justification.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const messages: Record<string, string> = {
        cannot_target_admin: "Un compte administrateur ne se suspend pas depuis cet écran.",
        cannot_target_self: "Vous ne pouvez pas agir sur votre propre compte.",
        banned_account: "Ce compte est banni : il ne relève plus de la suspension.",
      };
      setFeedback({ ok: false, text: messages[err.error] ?? "Le changement de statut a échoué." });
      return;
    }
    setFeedback({
      ok: true,
      text:
        next === "suspended"
          ? `${target.email} est suspendu : sa session est coupée dès sa prochaine requête.`
          : `${target.email} est réactivé.`,
    });
    setTarget(null);
    setJustification("");
    load();
  }

  const counts = data?.counts;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="👥"
        title="Gestion des utilisateurs"
        subtitle="Comptes, statut d’identité, suspension motivée. La plateforme ne supprime pas un compte : elle le suspend, et la trace reste."
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
          {
            icon: "👥",
            label: "Comptes",
            value: counts ? Object.values(counts.status).reduce((a, b) => a + b, 0).toLocaleString("fr-FR") : "…",
            hint: "tous statuts",
          },
          { icon: "✅", label: "Identité vérifiée", value: counts?.kyc.verifie ?? 0, tone: "green", hint: "KYC validé" },
          { icon: "⏳", label: "KYC en attente", value: counts?.kyc.en_attente ?? 0, tone: "blue", hint: "à instruire", href: "/admin/kyc" },
          { icon: "⏸", label: "Suspendus", value: counts?.status.suspended ?? 0, tone: (counts?.status.suspended ?? 0) > 0 ? "amber" : "neutral", hint: "connexion refusée" },
        ]}
      />

      {feedback && <AdminNotice tone={feedback.ok ? "green" : "red"}>{feedback.text}</AdminNotice>}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher par nom, prénom, email ou téléphone..."
        className={inputBase}
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
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

      <AdminCard
        title={data ? `${data.total.toLocaleString("fr-FR")} compte${data.total > 1 ? "s" : ""}` : "Comptes"}
        subtitle={data && data.total > data.items.length ? `Les ${data.items.length} plus récents — affinez la recherche pour voir les autres.` : undefined}
        padded={false}
      >
        {data === null ? (
          <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
        ) : data.items.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucun compte ne correspond.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Utilisateur</th>
                  <th className={tableHead}>Profil</th>
                  <th className={tableHead}>Identité</th>
                  <th className={tableHead}>Inscrit le</th>
                  <th className={`${tableHead} text-center`}>Statut</th>
                  <th className={`${tableHead} text-right`}>{canAct ? "Actions" : ""}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E0D9]">
                {data.items.map((u) => {
                  const name = [u.firstname, u.lastname].filter(Boolean).join(" ");
                  return (
                    <tr key={u.id}>
                      <td className={tableCell}>
                        <div className="font-medium">{name || u.email}</div>
                        <div className="text-[11.5px] text-[#9C9A95]">
                          {name ? `${u.email} · ` : ""}
                          {u.tel}
                        </div>
                      </td>
                      <td className={tableCell}>
                        {u.isAdmin ? (
                          <span className="rounded-full bg-[#EEF2FD] px-2 py-0.5 text-[11px] font-semibold text-[#2D5BE3]">
                            Admin · {u.adminRole ?? "sans rôle"}
                          </span>
                        ) : (
                          ROLE_LABEL[u.role] ?? u.role
                        )}
                        {u.country && <div className="text-[11px] text-[#9C9A95]">{u.country}</div>}
                      </td>
                      <td className={tableCell}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${KYC_STYLE[u.kycStatus].cls}`}>
                          {KYC_STYLE[u.kycStatus].label}
                        </span>
                      </td>
                      <td className={`${tableCell} whitespace-nowrap text-[#5A5750]`}>{new Date(u.createdAt).toLocaleDateString("fr-FR")}</td>
                      <td className={`${tableCell} text-center`}>
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[u.status].cls}`}>
                          {STATUS_STYLE[u.status].label}
                        </span>
                      </td>
                      <td className={`${tableCell} text-right`}>
                        {canAct && !u.isAdmin && u.status !== "banned" && (
                          <button onClick={() => setTarget(u)} className={u.status === "active" ? btnDanger : btnSecondary}>
                            {u.status === "active" ? "Suspendre" : "Réactiver"}
                          </button>
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

      {target && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setTarget(null)}>
          <div className="w-full max-w-md rounded-[16px] border border-[#E2E0D9] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold">{target.status === "active" ? "Suspendre" : "Réactiver"} {target.email}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#5A5750]">
              {target.status === "active"
                ? "La connexion lui sera refusée et sa session coupée dès sa prochaine requête. Ses missions, contrats et fonds sous séquestre ne sont pas touchés."
                : "Le compte pourra de nouveau se connecter."}
            </p>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={4}
              placeholder="Motif (10 caractères au moins) — il figure au journal d’audit."
              className="mt-3 w-full rounded-lg border border-[#E2E0D9] p-3 text-[13px] outline-none focus:border-[#2D5BE3]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setTarget(null)} className={btnSecondary}>
                Annuler
              </button>
              <button
                onClick={changeStatus}
                disabled={justification.trim().length < 10}
                className={target.status === "active" ? btnDanger : btnPrimary}
              >
                {target.status === "active" ? "Suspendre" : "Réactiver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
