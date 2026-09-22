"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ContractDrawer } from "@/components/admin/finance/ContractDrawer";
import { useCanActIn } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  KpiStrip,
  btnSecondary,
  fetchJson,
  formatXof,
  inputBase,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

type ContractRow = {
  id: string;
  createdAt: string;
  signedByClient: boolean;
  signedByProvider: boolean;
  financingMode: string;
  retentionRate: number;
  mission: { id: string; titre: string; status: string; currency: string };
  client: string;
  provider: string;
  jalons: number;
  openMediation: boolean;
  balance: { contractual: number; funded: number; released: number; held: number; fundingPending: boolean } | null;
};

function signatureLabel(c: ContractRow): { label: string; cls: string } {
  if (c.signedByClient && c.signedByProvider) return { label: "Signé 2/2", cls: "bg-[#E6F5EE] text-[#1A7A4A]" };
  if (c.signedByProvider) return { label: "Prestataire 1/2", cls: "bg-[#FEF9E7] text-[#B45309]" };
  if (c.signedByClient) return { label: "Client 1/2", cls: "bg-[#FEF9E7] text-[#B45309]" };
  return { label: "Non signé", cls: "bg-[#FAFAF8] text-[#5A5750]" };
}

/**
 * Contrats — rubrique de flexwork_job (« Contrats — Réinitialisation d'étape »).
 *
 * La liste, les signatures et l'état du séquestre sont repris. Le geste de réinitialisation ne
 * l'est pas : un contrat signé est chaîné par hachage et son journal est append-only, rejouer
 * une étape réécrirait ce que les deux parties ont signé. Les gestes de la Médiation sur l'argent
 * d'un contrat (remboursement, solde de retenue) sont dans son panneau de détail, le même que
 * celui de Paiements.
 */
export default function ContratsPage() {
  const canAct = useCanActIn("contrats");

  const [items, setItems] = useState<ContractRow[] | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchJson<{ items: ContractRow[] }>(`/api/admin/contracts${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    if (res.ok) setItems(res.data.items);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = items ?? [];
  const signed = list.filter((c) => c.signedByClient && c.signedByProvider).length;
  const held = list.reduce((s, c) => s + (c.balance?.held ?? 0), 0);
  const disputes = list.filter((c) => c.openMediation).length;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="🔄"
        title="Contrats"
        subtitle="Contrats de prestation, signatures et état du séquestre. Un contrat signé ne se réinitialise pas : il est chaîné par hachage."
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
          { icon: "🔄", label: "Contrats", value: items ? list.length : "…", hint: "les 200 plus récents" },
          { icon: "✍️", label: "Signés 2/2", value: signed, tone: "green", hint: "engagement des deux parties" },
          { icon: "🔒", label: "Sous séquestre", value: formatXof(held), tone: "blue", hint: "détenu par le PSP" },
          { icon: "⚖️", label: "En litige", value: disputes, tone: disputes > 0 ? "amber" : "neutral", hint: "médiation ouverte", href: "/admin/disputes" },
        ]}
      />

      {toast && <AdminNotice tone="blue">{toast}</AdminNotice>}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par mission, client ou prestataire (email)..." className={inputBase} />

      <AdminCard padded={false}>
        {items === null ? (
          <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
        ) : list.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucun contrat ne correspond.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Mission</th>
                  <th className={tableHead}>Client</th>
                  <th className={tableHead}>Prestataire</th>
                  <th className={tableHead}>Signature</th>
                  <th className={`${tableHead} text-right`}>Séquestre</th>
                  <th className={`${tableHead} text-right`}>Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E0D9]">
                {list.map((c) => {
                  const sig = signatureLabel(c);
                  return (
                    <tr key={c.id}>
                      <td className={tableCell}>
                        <div className="font-medium">{c.mission.titre}</div>
                        <div className="text-[11px] text-[#9C9A95]">
                          {c.mission.status} · {c.jalons > 0 ? `${c.jalons} jalon${c.jalons > 1 ? "s" : ""}` : "sans jalon"}
                          {c.openMediation && <span className="ml-1.5 font-semibold text-[#B45309]">· ⚖️ litige</span>}
                        </div>
                      </td>
                      <td className={`${tableCell} text-[#5A5750]`}>{c.client}</td>
                      <td className={`${tableCell} text-[#5A5750]`}>{c.provider}</td>
                      <td className={tableCell}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${sig.cls}`}>{sig.label}</span>
                      </td>
                      <td className={`${tableCell} text-right tabular-nums`}>
                        {c.balance ? (
                          <>
                            {formatXof(c.balance.held)}
                            <div className="text-[11px] text-[#9C9A95]">
                              sur {formatXof(c.balance.contractual)}
                              {c.balance.fundingPending ? " · financement en attente" : ""}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${tableCell} text-right`}>
                        <button onClick={() => setSelected(c.id)} className={btnSecondary}>
                          Ouvrir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {selected && (
        <ContractDrawer
          contractId={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
          notify={(message) => {
            setToast(message);
            setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
    </div>
  );
}
