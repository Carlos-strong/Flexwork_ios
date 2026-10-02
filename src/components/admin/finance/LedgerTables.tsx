"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OperationRow, PayableAdminRow } from "@/lib/admin-finance";
import { Chip, OP_STATUS, OP_TYPE, PAYABLE_STATUS, dateTime, inputCls, money, selectCls } from "./ui";

// Recherche avec anti-rebond : un registre financier se filtre en tapant une référence PSP, et
// une requête par frappe ferait travailler la base pour rien.
function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// Le contrat est passé de « je te donne un tableau de dépendances » à « donne-moi une fonction
// mémoïsée » (2026-09-23). Le tableau était reconstruit à chaque rendu par l'appelant — donc
// instable par nature — et l'ancien `deps` en dépendance d'effet ne pouvait être vérifié, d'où
// deux `eslint-disable`. Une fonction mémoïsée dit exactement la même chose, sans ambiguïté.
function usePaged<T>(buildUrl: (cursor: string | null) => string) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  // Dernière URL constructrice et dernier curseur, lus AU MOMENT de l'appel : `load` reste
  // ainsi stable (aucune dépendance), et l'effet de rechargement peut ne dépendre que du
  // filtre. Mettre `cursor` en dépendance de l'effet ramenait la liste à la première page à
  // chaque page suivante chargée — un bug qu'on n'aurait vu qu'en paginant pour de vrai.
  const buildUrlRef = useRef(buildUrl);
  useEffect(() => { buildUrlRef.current = buildUrl; }, [buildUrl]);
  const cursorRef = useRef(cursor);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const load = useCallback(async (reset: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    const res = await fetch(buildUrlRef.current(reset ? null : cursorRef.current), { cache: "no-store" }).catch(() => null);
    if (id !== requestId.current) return;
    setLoading(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    const data = (await res.json()) as { items: T[]; nextCursor: string | null };
    setError(false);
    setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
    setCursor(data.nextCursor);
  }, []);

  // `load` est stable : cet effet ne rejoue donc QUE quand `buildUrl` change, c'est-à-dire
  // quand un filtre change. Charger la page suivante ne repart pas de zéro.
  useEffect(() => {
    load(true);
  }, [load, buildUrl]);

  return { items, hasMore: cursor !== null, loading, error, loadMore: () => load(false), reload: () => load(true) };
}

function TableShell({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
      <div className="px-4 py-2.5 border-t border-[#F4F3EF] text-[12px] text-[#5A5750] flex items-center justify-between gap-3">{footer}</div>
    </div>
  );
}

const th = "text-left py-2.5 px-3 font-semibold whitespace-nowrap";

export function OperationsTable({ onOpenContract, refreshKey }: { onOpenContract: (id: string) => void; refreshKey: number }) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);

  const buildUrl = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams();
      if (type) p.set("type", type);
      if (status) p.set("status", status);
      if (source) p.set("source", source);
      if (dq.trim()) p.set("q", dq.trim());
      if (cursor) p.set("cursor", cursor);
      // `refreshKey` ne filtre rien : le parent l'incrémente quand une action d'admin a modifié
      // les données, pour forcer le rechargement. Le faire figurer dans l'URL rend la
      // dépendance RÉELLE (sans quoi elle était déclarée « inutile » à juste titre) : deux
      // versions du même registre sont bien deux requêtes différentes. La route ne lit que les
      // paramètres qu'elle connaît — celui-ci est ignoré côté serveur.
      p.set("r", String(refreshKey));
      return `/api/admin/finance/operations?${p}`;
    },
    [type, status, source, dq, refreshKey],
  );
  const { items, hasMore, loading, error, loadMore } = usePaged<OperationRow>(buildUrl);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select id="ops-type" aria-label="Type d'instruction" value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
          <option value="">Tous les types</option>
          {Object.entries(OP_TYPE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select id="ops-status" aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">Tous les statuts</option>
          {Object.entries(OP_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select id="ops-source" aria-label="Domaine" value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
          <option value="">Missions et Gigs</option>
          <option value="mission_contract">Missions</option>
          <option value="gig_order">Commandes Gig</option>
        </select>
        <input
          id="ops-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Référence PSP, identifiant, mission…"
          aria-label="Rechercher dans le registre"
          className={`${inputCls} max-w-[320px]`}
        />
      </div>

      <TableShell
        footer={
          <>
            <span>{error ? "Le registre n'a pas pu être chargé." : `${items.length} opération${items.length > 1 ? "s" : ""} affichée${items.length > 1 ? "s" : ""}`}</span>
            {hasMore && (
              <button onClick={loadMore} disabled={loading} className="h-8 px-3 rounded-lg border border-[#E2E0D9] bg-white font-medium hover:bg-[#FAFAF8] disabled:opacity-50">
                {loading ? "Chargement…" : "Charger plus"}
              </button>
            )}
          </>
        }
      >
        <table className="w-full text-[12.5px] min-w-[860px]">
          <thead>
            <tr className="text-[10.5px] tracking-widest text-[#5A5750] uppercase bg-[#FAFAF8] border-b border-[#E2E0D9]">
              <th className={th}>Transmise</th>
              <th className={th}>Instruction</th>
              <th className={th}>Portée</th>
              <th className={`${th} text-right`}>Montant</th>
              <th className={th}>Statut</th>
              <th className={th}>Référence PSP</th>
              <th className={th}>Confirmée</th>
            </tr>
          </thead>
          <tbody>
            {items.map((op) => {
              const t = OP_TYPE[op.instructionType];
              return (
                <tr key={op.id} className="border-b border-[#F4F3EF] last:border-0 hover:bg-[#FAFAF8]">
                  <td className="py-2 px-3 whitespace-nowrap text-[#5A5750] tabular-nums">{dateTime(op.instructionSentAt)}</td>
                  <td className="py-2 px-3">
                    <Chip tone={t?.tone ?? "slate"}>{t?.label ?? op.instructionType}</Chip>
                  </td>
                  <td className="py-2 px-3 max-w-[260px]">
                    {op.contractId ? (
                      <button onClick={() => onOpenContract(op.contractId!)} className="text-left text-[#2D5BE3] font-medium hover:underline truncate block max-w-full">
                        {op.label}
                      </button>
                    ) : (
                      <span className="text-[#5A5750]">{op.label}</span>
                    )}
                    {op.jalon && <div className="text-[11px] text-[#9C9A95] truncate">{op.jalon}</div>}
                  </td>
                  <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-semibold ${t?.sign === 1 ? "text-[#1E40AF]" : t?.sign === 0 ? "text-[#9C9A95]" : ""}`}>
                    {t?.sign === 1 ? "+" : t?.sign === -1 ? "−" : ""}
                    {money(op.amount, op.currency)}
                  </td>
                  <td className="py-2 px-3">
                    <Chip tone={OP_STATUS[op.status]?.tone ?? "slate"}>{OP_STATUS[op.status]?.label ?? op.status}</Chip>
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-[#5A5750] max-w-[220px] truncate" title={op.pspReference ?? undefined}>
                    {op.pspReference ?? "—"}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap text-[#5A5750] tabular-nums">{dateTime(op.pspConfirmedAt)}</td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[#9C9A95]">Aucune opération ne correspond à ces filtres.</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}

export function PayablesTable({ onOpenContract, refreshKey }: { onOpenContract: (id: string) => void; refreshKey: number }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);

  const buildUrl = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
      if (dq.trim()) p.set("q", dq.trim());
      if (cursor) p.set("cursor", cursor);
      // Même rôle que sur le registre des opérations : signal de rafraîchissement, ignoré par
      // la route, mais qui rend la dépendance réelle.
      p.set("r", String(refreshKey));
      return `/api/admin/finance/payables?${p}`;
    },
    [status, dq, refreshKey],
  );
  const { items, hasMore, loading, error, loadMore } = usePaged<PayableAdminRow>(buildUrl);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select id="payables-status" aria-label="Statut de la créance" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">Toutes les créances</option>
          {Object.entries(PAYABLE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          id="payables-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mission, identifiant…"
          aria-label="Rechercher une créance"
          className={`${inputCls} max-w-[320px]`}
        />
      </div>
      <TableShell
        footer={
          <>
            <span>{error ? "Les créances n'ont pas pu être chargées." : `${items.length} créance${items.length > 1 ? "s" : ""} affichée${items.length > 1 ? "s" : ""}`}</span>
            {hasMore && (
              <button onClick={loadMore} disabled={loading} className="h-8 px-3 rounded-lg border border-[#E2E0D9] bg-white font-medium hover:bg-[#FAFAF8] disabled:opacity-50">
                {loading ? "Chargement…" : "Charger plus"}
              </button>
            )}
          </>
        }
      >
        <table className="w-full text-[12.5px] min-w-[760px]">
          <thead>
            <tr className="text-[10.5px] tracking-widest text-[#5A5750] uppercase bg-[#FAFAF8] border-b border-[#E2E0D9]">
              <th className={th}>Reconnue</th>
              <th className={th}>Source</th>
              <th className={th}>Mission</th>
              <th className={`${th} text-right`}>Montant</th>
              <th className={th}>Statut</th>
              <th className={th}>Payée</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-[#F4F3EF] last:border-0 hover:bg-[#FAFAF8]">
                <td className="py-2 px-3 whitespace-nowrap text-[#5A5750] tabular-nums">{dateTime(p.validatedAt)}</td>
                <td className="py-2 px-3 text-[#1A1916] max-w-[220px] truncate">{p.label}</td>
                <td className="py-2 px-3 max-w-[240px]">
                  {p.contractId ? (
                    <button onClick={() => onOpenContract(p.contractId!)} className="text-left text-[#2D5BE3] font-medium hover:underline truncate block max-w-full">
                      {p.missionTitle}
                    </button>
                  ) : (
                    <span className="text-[#5A5750]">{p.missionTitle}</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right tabular-nums font-semibold whitespace-nowrap">{money(p.amount, p.currency)}</td>
                <td className="py-2 px-3">
                  <Chip tone={PAYABLE_STATUS[p.status]?.tone ?? "slate"}>{PAYABLE_STATUS[p.status]?.label ?? p.status}</Chip>
                </td>
                <td className="py-2 px-3 whitespace-nowrap text-[#5A5750] tabular-nums">{dateTime(p.paidAt)}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#9C9A95]">Aucune créance ne correspond à ces filtres.</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}
