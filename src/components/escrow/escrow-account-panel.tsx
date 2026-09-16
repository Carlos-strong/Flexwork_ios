"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { ESCROW_CHANGED_EVENT, notifyEscrowChanged } from "@/lib/escrow-events";

// Compte financier du séquestre (2026-09-14) — la distinction « financer ≠ payer », rendue
// visible aux deux parties.
//
// Le moteur l'applique depuis la Phase 1 : une validation métier crée une obligation de
// paiement, et le contrôle de solde décide si elle part. Mais rien ne le MONTRAIT. Une règle
// qu'on ne peut pas constater n'est appliquée qu'à moitié : le client ne savait pas ce qu'il
// restait engagé, et le prestataire ne savait pas ce qui lui était reconnu dû.
//
// ── Lisible par les DEUX parties, dans les mêmes chiffres ──────────────────────────────────
// Le séquestre est leur compte commun. Seuls les LIBELLÉS changent selon le rôle — « à verser »
// côté client, « à vous verser » côté prestataire — jamais les montants. Montrer au prestataire
// un compte différent de celui du client rouvrirait le soupçon que le séquestre existe
// justement pour lever.

type Balance = {
  currency: string;
  role: "client" | "provider";
  financialState: string;
  contractual: number;
  funded: number;
  released: number;
  refunded: number;
  held: number;
  blocked: number;
  retained: number;
  releasable: number;
  available: number;
  owedToProvider: number;
  refundable: number;
  fundingPending: boolean;
  payables: PayableRow[];
};

type PayableRow = {
  id: string;
  label: string;
  amount: number;
  status: "validated" | "instructed" | "paid" | "failed";
  validatedAt: string;
  paidAt: string | null;
  reference: string | null;
};

// Une créance (Payable) vue par les parties : ce qui a été reconnu dû, et où en est son
// versement. `validated` ne dit pas « en attente d'un clic » : l'instruction part dans la même
// transaction que la validation dès que le séquestre la couvre — une créance qui reste
// `validated` attend donc un financement.
const PAYABLE_META: Record<PayableRow["status"], { client: string; provider: string; cls: string }> = {
  validated: { client: "Due — attend un financement", provider: "Due — attend le financement du client", cls: "bg-[#FFFBEB] text-[#92400E]" },
  instructed: { client: "Versement en cours", provider: "Versement en cours", cls: "bg-[#EFF6FF] text-[#1E40AF]" },
  paid: { client: "Versée", provider: "Reçue", cls: "bg-[#E6F4EE] text-[#00623A]" },
  failed: { client: "Refusée par le PSP — sera reprise", provider: "Refusée par le PSP — sera reprise", cls: "bg-[#FEF2F2] text-[#B91C1C]" },
};

type RechargeNeed = { due: number; available: number; missing: number; currency: string; pendingHold: boolean };

// Libellés des six états du cycle financier. Le ton est factuel : un état financier n'est pas
// un jugement sur la mission, et « partiellement libéré » ne veut dire ni bien ni mal.
const STATE_META: Record<string, { label: string; bg: string; fg: string }> = {
  non_finance: { label: "Non financé", bg: "bg-[#F1F5F9]", fg: "text-[#475569]" },
  financement_en_attente: { label: "Financement en attente", bg: "bg-[#FFFBEB]", fg: "text-[#92400E]" },
  sequestre: { label: "Fonds sous séquestre", bg: "bg-[#E6F4EE]", fg: "text-[#00623A]" },
  partiellement_libere: { label: "Partiellement libéré", bg: "bg-[#EFF6FF]", fg: "text-[#1E40AF]" },
  totalement_libere: { label: "Totalement libéré", bg: "bg-[#E6F4EE]", fg: "text-[#00623A]" },
  cloture: { label: "Clôturé", bg: "bg-[#F1F5F9]", fg: "text-[#475569]" },
};

function Ligne({
  libelle,
  montant,
  devise,
  aide,
  accent,
}: {
  libelle: string;
  montant: number;
  devise: string;
  aide?: string;
  accent?: "vert" | "ambre" | "rouge";
}) {
  const couleur =
    accent === "vert" ? "text-[#008751]" : accent === "ambre" ? "text-[#92400E]" : accent === "rouge" ? "text-[#B91C1C]" : "text-[#0f172a]";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12.5px] text-[#64748B] min-w-0">
        {libelle}
        {aide && <span className="block text-[11px] text-[#94A3B8] leading-tight mt-0.5">{aide}</span>}
      </span>
      <strong className={`text-[13px] shrink-0 tabular-nums ${couleur}`}>
        {montant.toLocaleString("fr-FR")} {devise}
      </strong>
    </div>
  );
}

export function EscrowAccountPanel({ missionId, className = "" }: { missionId: string; className?: string }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [need, setNeed] = useState<RechargeNeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [redirect, setRedirect] = useState<{ reference: string; amount: number } | null>(null);

  const load = useCallback(() => {
    fetchDedupe(`/api/missions/${missionId}/escrow/balance`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBalance)
      .catch(() => setBalance(null));
    // La recharge est un geste de CLIENT ; la route renvoie 404 au prestataire, qui n'a alors
    // simplement pas de bloc « financement requis ». Aucun traitement d'erreur : l'absence de
    // besoin et l'absence de droit se rendent pareil — rien à afficher.
    fetchDedupe(`/api/missions/${missionId}/escrow/recharge`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setNeed)
      .catch(() => setNeed(null));
  }, [missionId]);

  useEffect(load, [load]);

  // Un relevé constaté ou un chantier clôturé dans un autre panneau de la page change ce compte.
  useEffect(() => {
    window.addEventListener(ESCROW_CHANGED_EVENT, load);
    return () => window.removeEventListener(ESCROW_CHANGED_EVENT, load);
  }, [load]);

  async function recharger() {
    setError(null);
    setSubmitting(true);
    const res = await fetch(`/api/missions/${missionId}/escrow/recharge`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(
        data.error === "hold_already_requested"
          ? "Un financement est déjà en cours d'autorisation — attendez sa confirmation avant d'en relancer un."
          : data.error === "nothing_to_recharge"
            ? "Le séquestre couvre déjà tout ce qui est dû."
            : "Le financement complémentaire n'a pas pu être transmis."
      );
      return;
    }
    if (data.pspRedirect) setRedirect({ reference: data.pspRedirect.reference, amount: data.amount });
    load();
    notifyEscrowChanged();
  }

  if (!balance) return null;

  const { currency: d, role } = balance;
  const estClient = role === "client";
  const etat = STATE_META[balance.financialState] ?? STATE_META.non_finance;

  return (
    <div className={`bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-[13px] font-semibold">Compte du séquestre</h2>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${etat.bg} ${etat.fg}`}>
          {etat.label}
        </span>
      </div>

      {/* La distinction que tout le reste sert. Énoncée en une phrase, à l'endroit où les
          chiffres pourraient laisser croire le contraire. */}
      <p className="text-[12px] text-[#64748B] leading-relaxed mb-3">
        Financer n&apos;est pas payer : les fonds restent séquestrés chez le prestataire de paiement agréé
        jusqu&apos;à validation. {estClient ? "Ils ne sont versés qu'à ce moment-là." : "Ils vous sont versés à ce moment-là."}
      </p>

      <div className="rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] px-3.5 py-2 divide-y divide-[#E2E8F0]">
        <Ligne libelle="Montant du contrat" montant={balance.contractual} devise={d} />
        <Ligne
          libelle={estClient ? "Vous avez financé" : "Le client a financé"}
          montant={balance.funded}
          devise={d}
          aide={balance.fundingPending ? "Un versement complémentaire est en cours d'autorisation." : undefined}
        />
        <Ligne
          libelle={estClient ? "Déjà versé au prestataire" : "Déjà reçu"}
          montant={balance.released}
          devise={d}
          accent="vert"
        />
        {balance.refunded > 0 && (
          <Ligne libelle={estClient ? "Vous a été remboursé" : "Remboursé au client"} montant={balance.refunded} devise={d} />
        )}
        <Ligne
          libelle="Encore sous séquestre"
          montant={balance.held}
          devise={d}
          aide="Ce que le prestataire de paiement détient encore."
        />
      </div>

      {/* Décomposition : où va ce qui reste. N'a de sens que s'il reste quelque chose. */}
      {balance.held > 0 && (
        <div className="mt-3 rounded-xl border border-[#E2E8F0] px-3.5 py-2 divide-y divide-[#E2E8F0]">
          <div className="pb-1.5 text-[11px] uppercase tracking-wide font-semibold text-[#94A3B8]">
            Sur les {balance.held.toLocaleString("fr-FR")} {d} restants
          </div>
          <Ligne
            libelle={estClient ? "Reconnu dû au prestataire" : "Vous est reconnu dû"}
            montant={balance.owedToProvider}
            devise={d}
            aide={estClient ? "Validé par vous, en attente de versement." : "Validé par le client, pas encore versé."}
            accent="vert"
          />
          {balance.retained > 0 && (
            <Ligne
              libelle="Retenue de garantie"
              montant={balance.retained}
              devise={d}
              aide="Versée au prestataire en une fois, une fois tous les jalons validés."
              accent="ambre"
            />
          )}
          {balance.blocked > 0 && (
            <Ligne
              libelle="Gelé par une médiation"
              montant={balance.blocked}
              devise={d}
              aide="Immobilisé le temps du litige — ces fonds n'ont pas quitté le séquestre."
              accent="rouge"
            />
          )}
          <Ligne
            libelle={estClient ? "Vous serait restituable" : "Non encore engagé"}
            montant={balance.refundable}
            devise={d}
            aide={estClient ? "Ce qu'aucune validation ne réclame à ce stade." : undefined}
          />
        </div>
      )}

      {/* Insuffisance de séquestre : une somme est due et ne peut pas partir. C'est le seul
          état qui appelle une ACTION, et seul le client peut la faire. */}
      {need && need.missing > 0 && (
        <div className="mt-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
          <p className="text-[12.5px] text-[#92400E] leading-relaxed">
            <strong>Financement complémentaire requis : {need.missing.toLocaleString("fr-FR")} {d}.</strong>{" "}
            {need.due.toLocaleString("fr-FR")} {d} sont reconnus dus au prestataire, et le séquestre n&apos;en couvre
            que {need.available.toLocaleString("fr-FR")}. Aucun versement partiel n&apos;est effectué : le paiement
            attend que le séquestre couvre l&apos;intégralité du montant dû.
          </p>
          {estClient && !need.pendingHold && (
            <button
              onClick={recharger}
              disabled={submitting}
              className="mt-2.5 w-full h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50"
            >
              {submitting ? "Envoi…" : `Compléter le séquestre (${need.missing.toLocaleString("fr-FR")} ${d})`}
            </button>
          )}
          {need.pendingHold && (
            <p className="mt-2 text-[12px] text-[#92400E]">
              Un versement est déjà en cours d&apos;autorisation — attendez sa confirmation.
            </p>
          )}
        </div>
      )}

      {/* Détail des créances : de quoi est fait « reconnu dû », et où en est chaque versement.
          Déplié d'office tant qu'un versement n'est pas abouti — c'est là qu'est la question. */}
      {balance.payables.length > 0 && (
        <details
          className="mt-3 rounded-xl border border-[#E2E8F0] group"
          open={balance.payables.some((p) => p.status !== "paid")}
        >
          <summary className="flex items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer list-none text-[12.5px] font-semibold text-[#0f172a]">
            <span>Détail des versements ({balance.payables.length})</span>
            <span className="text-[#94A3B8] transition-transform group-open:rotate-180" aria-hidden>▾</span>
          </summary>
          <ul className="divide-y divide-[#F1F5F9] border-t border-[#E2E8F0]">
            {balance.payables.map((p) => {
              const meta = PAYABLE_META[p.status];
              const quand = new Date(p.paidAt ?? p.validatedAt).toLocaleDateString("fr-FR");
              return (
                <li key={p.id} className="flex items-start justify-between gap-3 px-3.5 py-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-[#0f172a] truncate">{p.label}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.cls}`}>
                        {estClient ? meta.client : meta.provider}
                      </span>
                      <span className="text-[11px] text-[#94A3B8]">
                        {p.paidAt ? "le" : "reconnue le"} {quand}
                      </span>
                    </div>
                  </div>
                  <strong className="text-[12.5px] tabular-nums shrink-0">
                    {p.amount.toLocaleString("fr-FR")} {d}
                  </strong>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {redirect && (
        <Link
          href={`/psp-sandbox/payer?ref=${encodeURIComponent(redirect.reference)}&missionId=${missionId}`}
          className="block mt-2.5 text-[12.5px] text-[#008751] font-semibold"
          style={{ textDecoration: "none" }}
        >
          Autoriser le versement de {redirect.amount.toLocaleString("fr-FR")} {d} (sandbox PSP virtuelle) →
        </Link>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[12.5px] text-[#B91C1C]">{error}</div>
      )}
    </div>
  );
}
