"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { ESCROW_CHANGED_EVENT, notifyEscrowChanged } from "@/lib/escrow-events";
import { RATE_UNIT_LABEL, attendanceAmount, dayPeriod, monthPeriod, type RateUnit } from "@/lib/spot-time";

// Relevés de présence d'un contrat au temps (§20) — un seul composant pour les trois rôles.
//
// Le travailleur déclare, le client ou le responsable de chantier constate. Ce sont deux gestes
// que rien ne partage sauf la liste qu'ils regardent, d'où un composant unique piloté par le
// `role` que l'API renvoie : c'est le serveur qui sait qui valide (la désignation vit sur le
// contrat), jamais le navigateur.
//
// La phrase qui gouverne l'écran est celle du §20 : « le pointage n'a aucun pouvoir financier
// direct ». L'interface doit le MONTRER — un relevé déclaré affiche ce qu'il vaudrait, jamais ce
// qu'il rapporte, et seule la validation parle d'argent versé.
//
// ── Fluidité (2026-09-15) ──────────────────────────────────────────────────────────────────
// Les décisions passaient par des `window.prompt` en cascade : pas de montant affiché avant de
// confirmer, un motif vide découvert après coup, aucune annulation propre. Elles se prennent
// désormais dans la ligne du relevé, avec le montant qui sera libéré sous les yeux. La période
// déclarée suit l'unité du contrat — un mois se déclare par mois, des journées par plage de
// dates — au lieu d'imposer une date unique à tous.

type Item = {
  id: string;
  periodStart: string;
  periodEnd: string;
  declaredQuantity: number;
  approvedQuantity: number | null;
  overtimeQuantity: number;
  status: string;
  rejectionReason: string | null;
  validatedAt: string | null;
  amount: number;
};

type Terms = {
  rateUnit: RateUnit;
  rate: number;
  maxQuantity: number;
  maxAmount: number;
  overtimeAllowed: boolean;
  overtimeRate: number | null;
};

type Payload = {
  currency: string;
  role: "worker" | "client" | "site_manager";
  terms: Terms;
  closed: boolean;
  suspended: boolean;
  consumedQuantity: number;
  remainingQuantity: number;
  funding: { remainingUnits: number; low: boolean };
  available: number;
  items: Item[];
};

type DecisionKind = "approve" | "dispute" | "reject";
type Decision = { id: string; kind: DecisionKind; quantity: string; overtime: string; reason: string };

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  open: { label: "Brouillon", bg: "bg-[#F1F5F9]", fg: "text-[#475569]" },
  submitted: { label: "À constater", bg: "bg-[#FFFBEB]", fg: "text-[#92400E]" },
  approved: { label: "Validé", bg: "bg-[#E6F4EE]", fg: "text-[#00623A]" },
  rejected: { label: "Refusé", bg: "bg-[#FEF2F2]", fg: "text-[#B91C1C]" },
  disputed: { label: "Contesté", bg: "bg-[#FEF2F2]", fg: "text-[#B91C1C]" },
  cancelled: { label: "Annulé", bg: "bg-[#F1F5F9]", fg: "text-[#475569]" },
};

const DECISION_ERRORS: Record<string, string> = {
  quantity_cap_exceeded: "Cette quantité dépasse le plafond du contrat.",
  amount_cap_exceeded: "Le plafond financier du contrat est atteint.",
  rejection_reason_required: "Un motif est obligatoire pour refuser un relevé.",
  dispute_reason_required: "Un motif est obligatoire pour contester.",
  approved_above_declared: "Vous ne pouvez pas constater plus que ce qui a été déclaré.",
  nothing_disputed: "Vous reconnaissez la totalité : utilisez « Constater ».",
  attendance_not_submitted: "Ce relevé a déjà été traité — la liste vient d'être mise à jour.",
  invalid_quantity: "Indiquez une quantité supérieure à zéro.",
};

const CLOSE_ERRORS: Record<string, string> = {
  attendance_pending: "Des relevés attendent encore votre décision : constatez-les, refusez-les ou arbitrez les contestations avant de clôturer.",
  payment_pending: "Un versement reconnu dû n'est pas encore parti. Complétez le séquestre si nécessaire, puis clôturez une fois le prestataire payé.",
  mediation_open: "Une médiation est ouverte : le chantier ne peut pas être clôturé tant qu'elle n'est pas close.",
  already_closed: "Ce chantier est déjà clôturé.",
};

const inputCls =
  "w-full h-9 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

function unite(n: number, unit: RateUnit) {
  const l = RATE_UNIT_LABEL[unit];
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? l.many : l.one}`;
}

function dateISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function periodLabel(item: Item, unit: RateUnit): string {
  const start = new Date(item.periodStart);
  const end = new Date(item.periodEnd);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("fr-FR", { timeZone: "UTC", ...opts });
  if (unit === "month") return fmt(start, { month: "long", year: "numeric" });
  const sameDay = dateISO(start) === dateISO(end);
  return sameDay ? fmt(start, {}) : `${fmt(start, { day: "numeric", month: "short" })} → ${fmt(end, { day: "numeric", month: "short" })}`;
}

export function AttendancePanel({
  missionId,
  className = "",
  onChanged,
}: {
  missionId: string;
  className?: string;
  /**
   * Appelé après toute décision qui modifie les relevés.
   *
   * Un écran qui agrège ces relevés ailleurs (les compteurs du tableau de bord du responsable de
   * chantier) doit se remettre à jour en même temps : afficher « 2 à constater » au-dessus d'une
   * liste qui n'en montre plus qu'un fait douter des deux chiffres.
   */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Déclaration (travailleur) — la période suit l'unité du contrat.
  const today = dateISO(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [quantite, setQuantite] = useState("");

  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Désignation du responsable de chantier (client seulement)
  const [manager, setManager] = useState<{ id: string; name: string } | null>(null);
  const [managerInput, setManagerInput] = useState("");

  const load = useCallback(() => {
    fetchDedupe(`/api/missions/${missionId}/attendance`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
    // Réservé au client : la route répond 404 aux autres, qui n'auront simplement pas le bloc.
    fetchDedupe(`/api/missions/${missionId}/site-manager`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setManager(b?.siteManager ?? null))
      .catch(() => setManager(null));
  }, [missionId]);

  useEffect(load, [load]);

  // Un geste fait dans le compte du séquestre (une recharge) change ce que les relevés couvrent.
  useEffect(() => {
    window.addEventListener(ESCROW_CHANGED_EVENT, load);
    return () => window.removeEventListener(ESCROW_CHANGED_EVENT, load);
  }, [load]);

  function refreshAfterChange() {
    load();
    onChanged?.();
    notifyEscrowChanged();
  }

  // Plage de jours : la quantité suggérée est le nombre de jours couverts, modifiable (une demi-
  // journée, un jour non travaillé dans la plage).
  const joursDansPlage = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1);

  async function declarer(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setError(null);
    setNotice(null);

    const unit = data.terms.rateUnit;
    // Bornes normalisées (mêmes fonctions que le serveur) pour que « le 3 septembre » ou
    // « septembre 2026 » désignent toujours le même intervalle — c'est ce qui permet à l'unicité
    // de période de jouer son rôle.
    let periodStart: Date;
    let periodEnd: Date;
    if (unit === "month") {
      ({ periodStart, periodEnd } = monthPeriod(new Date(`${month}-01T00:00:00.000Z`)));
    } else if (unit === "day") {
      if (Date.parse(to) < Date.parse(from)) {
        setError("La date de fin doit suivre la date de début.");
        return;
      }
      periodStart = dayPeriod(new Date(`${from}T00:00:00.000Z`)).periodStart;
      periodEnd = dayPeriod(new Date(`${to}T00:00:00.000Z`)).periodEnd;
    } else {
      ({ periodStart, periodEnd } = dayPeriod(new Date(`${from}T00:00:00.000Z`)));
    }

    const declared = quantite ? Number(quantite) : unit === "day" ? joursDansPlage : unit === "month" ? 1 : NaN;
    setBusy("submit");
    const res = await fetch(`/api/missions/${missionId}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), declaredQuantity: declared }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(
        body.error === "duplicate_period" || body.error === "period_overlap"
          ? "Cette période est déjà couverte par un relevé."
          : body.error === "invalid_quantity"
            ? "Indiquez une quantité supérieure à zéro."
            : body.error === "contract_closed"
              ? "Ce chantier est clôturé ou suspendu : plus aucune présence ne peut être déclarée."
              : "Le relevé n'a pas pu être enregistré."
      );
      return;
    }
    setQuantite("");
    setNotice("Relevé envoyé au client pour constat.");
    refreshAfterChange();
  }

  async function designer(identifier: string | null) {
    setError(null);
    setBusy("manager");
    const res = await fetch(`/api/missions/${missionId}/site-manager`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: identifier === null ? null : identifier.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(
        body.error === "user_not_found"
          ? "Aucun compte actif ne correspond à cet identifiant."
          : body.error === "not_a_site_manager"
            ? "Ce compte n'est pas un compte « responsable chantier ». La personne doit s'inscrire avec ce profil."
            : body.error === "invalid_site_manager"
              ? "Le prestataire de la mission ne peut pas constater ses propres heures."
              : "La désignation n'a pas pu être enregistrée."
      );
      return;
    }
    setManager(body.siteManager ?? null);
    setManagerInput("");
  }

  function ouvrirDecision(item: Item, kind: DecisionKind) {
    setError(null);
    setNotice(null);
    setDecision({ id: item.id, kind, quantity: String(item.declaredQuantity), overtime: "", reason: "" });
  }

  async function confirmerDecision(item: Item) {
    if (!data || !decision) return;
    setError(null);
    const quantity = Number(decision.quantity);
    const body =
      decision.kind === "reject"
        ? { action: "reject", reason: decision.reason.trim() }
        : decision.kind === "dispute"
          ? { action: "dispute", approvedQuantity: quantity, reason: decision.reason.trim() }
          : { approvedQuantity: quantity, overtimeQuantity: Number(decision.overtime) || 0 };

    setBusy(item.id);
    const res = await fetch(`/api/missions/${missionId}/attendance/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      if (payload.error === "escrow_insufficient") {
        // Pas un échec : le travail est reconnu et la créance enregistrée. Seul le versement attend.
        setDecision(null);
        setNotice(
          `Présence constatée. Le séquestre ne couvre pas les ${Number(payload.allowed ?? 0).toLocaleString("fr-FR")} ${data.currency} dus (${Number(payload.available ?? 0).toLocaleString("fr-FR")} disponibles) : la somme reste due et partira dès que le financement sera complété.`
        );
        refreshAfterChange();
        return;
      }
      setError(
        payload.error === "quantity_cap_exceeded"
          ? `Le plafond du contrat ne permet plus que ${unite(Number(payload.allowed ?? 0), data.terms.rateUnit)}.`
          : DECISION_ERRORS[payload.error] ?? "La décision n'a pas pu être enregistrée."
      );
      if (payload.error === "attendance_not_submitted") {
        setDecision(null);
        refreshAfterChange();
      }
      return;
    }
    setDecision(null);
    setNotice(
      decision.kind === "reject"
        ? "Relevé refusé — le prestataire peut le corriger et le redéclarer."
        : decision.kind === "dispute"
          ? "Part reconnue libérée, part contestée gelée au séquestre en attendant l'arbitrage."
          : "Présence constatée — le versement est parti vers le prestataire."
    );
    refreshAfterChange();
  }

  async function arbitrer(item: Item, accept: boolean) {
    setError(null);
    setNotice(null);
    setBusy(item.id);
    const res = await fetch(`/api/missions/${missionId}/attendance/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve", accept }),
    });
    setBusy(null);
    if (!res.ok) setError("L'arbitrage n'a pas pu être enregistré.");
    else setNotice(accept ? "Part contestée reconnue et versée." : "Part contestée écartée : elle redevient disponible au séquestre.");
    refreshAfterChange();
  }

  async function cloturer() {
    setError(null);
    setNotice(null);
    setBusy("close");
    const res = await fetch(`/api/missions/${missionId}/time-contract/close`, { method: "POST" });
    const payload = await res.json().catch(() => ({}));
    setBusy(null);
    setConfirmClose(false);
    if (!res.ok) {
      setError(CLOSE_ERRORS[payload.error] ?? "La clôture n'a pas pu être enregistrée.");
      return;
    }
    setNotice(
      payload.refunded > 0 && data
        ? `Chantier clôturé — ${Number(payload.refunded).toLocaleString("fr-FR")} ${data.currency} non consommés vous sont restitués.`
        : "Chantier clôturé."
    );
    refreshAfterChange();
  }

  if (!data) return null;

  const { currency: d, terms, role } = data;
  const u = RATE_UNIT_LABEL[terms.rateUnit];
  const estTravailleur = role === "worker";
  const peutValider = role === "client" || role === "site_manager";
  const enAttente = data.items.filter((i) => i.status === "submitted" || i.status === "disputed");
  const actif = !data.closed && !data.suspended;

  return (
    <div className={`bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-[13px] font-semibold">Relevés de présence</h2>
        <span className="text-[11.5px] text-[#64748B] tabular-nums">
          {terms.rate.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} {d} / {u.per}
        </span>
      </div>

      {data.closed ? (
        <div className="mb-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3 text-[12.5px] text-[#475569] leading-relaxed">
          <strong className="text-[#0f172a]">Chantier clôturé.</strong> Plus aucune présence ne peut être déclarée ; le
          solde non consommé du plafond a été restitué au client.
        </div>
      ) : data.suspended ? (
        <div className="mb-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E] leading-relaxed">
          <strong>Chantier suspendu par une médiation.</strong> Les déclarations reprendront à sa clôture.
        </div>
      ) : (
        <p className="text-[12px] text-[#64748B] leading-relaxed mb-3">
          Un relevé ne paie rien par lui-même : il doit être constaté par{" "}
          {role === "site_manager" ? "vous" : "le client ou le responsable de chantier"}. C&apos;est cette
          validation, et elle seule, qui libère les fonds du séquestre.
        </p>
      )}

      {/* Jauge de consommation du plafond — ce qui est consommé, ce que le séquestre couvre encore. */}
      <div className="rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] px-3.5 py-2.5 text-[12.5px] space-y-1.5">
        <div className="flex justify-between gap-3">
          <span className="text-[#64748B]">Consommé</span>
          <strong className="tabular-nums">
            {unite(data.consumedQuantity, terms.rateUnit)} / {unite(terms.maxQuantity, terms.rateUnit)}
          </strong>
        </div>
        <div className="h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden" aria-hidden>
          <div
            className="h-full bg-[#008751] rounded-full transition-[width] duration-500"
            style={{ width: `${Math.min(100, (data.consumedQuantity / Math.max(terms.maxQuantity, 1)) * 100)}%` }}
          />
        </div>
        {actif && (
          <div className="flex justify-between gap-3">
            <span className="text-[#64748B]">Le séquestre couvre encore</span>
            <strong className={`tabular-nums ${data.funding.low ? "text-[#B91C1C]" : "text-[#008751]"}`}>
              {unite(data.funding.remainingUnits, terms.rateUnit)}
            </strong>
          </div>
        )}
      </div>

      {/* Alerte du §19 — prévenir AVANT l'arrêt du chantier, pas après. */}
      {actif && data.funding.low && (
        <div className="mt-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E] leading-relaxed">
          <strong>Financement bientôt épuisé.</strong> Le séquestre disponible ne couvre plus que{" "}
          {unite(data.funding.remainingUnits, terms.rateUnit)} de présence.{" "}
          {role === "client"
            ? "Complétez le financement depuis le compte du séquestre pour que le chantier ne s'arrête pas."
            : "Le client doit compléter le financement pour que le chantier ne s'arrête pas."}
        </div>
      )}

      {/* Délégation du constat — contrat par contrat, et révocable. */}
      {role === "client" && actif && (
        <div className="mt-3 rounded-xl border border-[#E2E8F0] p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[12.5px] text-[#64748B]">
              Responsable de chantier : <strong className="text-[#0f172a]">{manager ? manager.name : "vous-même"}</strong>
            </span>
            {manager && (
              <button
                onClick={() => designer(null)}
                disabled={busy === "manager"}
                className="h-8 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[11.5px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50"
              >
                Retirer
              </button>
            )}
          </div>
          {!manager && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                designer(managerInput);
              }}
              className="flex gap-2 mt-2"
            >
              <input
                id="attendance-manager"
                type="text"
                value={managerInput}
                onChange={(e) => setManagerInput(e.target.value)}
                placeholder="E-mail ou téléphone du responsable"
                className={`flex-1 ${inputCls}`}
              />
              <button
                type="submit"
                disabled={busy === "manager" || !managerInput.trim()}
                className="h-9 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50"
              >
                Désigner
              </button>
            </form>
          )}
        </div>
      )}

      {estTravailleur && actif && (
        <form onSubmit={declarer} className="mt-3 grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
          {terms.rateUnit === "month" ? (
            <label className="col-span-2 sm:col-span-2">
              <span className="block text-[11.5px] text-[#64748B] mb-1">Mois travaillé</span>
              <input id="attendance-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required className={inputCls} />
            </label>
          ) : terms.rateUnit === "day" ? (
            <>
              <label>
                <span className="block text-[11.5px] text-[#64748B] mb-1">Du</span>
                <input
                  id="attendance-from"
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (Date.parse(e.target.value) > Date.parse(to)) setTo(e.target.value);
                  }}
                  required
                  className={inputCls}
                />
              </label>
              <label>
                <span className="block text-[11.5px] text-[#64748B] mb-1">Au</span>
                <input id="attendance-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required className={inputCls} />
              </label>
            </>
          ) : (
            <label className="col-span-2 sm:col-span-2">
              <span className="block text-[11.5px] text-[#64748B] mb-1">Date</span>
              <input id="attendance-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required className={inputCls} />
            </label>
          )}
          <label>
            <span className="block text-[11.5px] text-[#64748B] mb-1">
              {terms.rateUnit === "hour" ? "Heures" : terms.rateUnit === "day" ? "Jours travaillés" : "Part du mois"}
            </span>
            <input
              id="attendance-quantity"
              type="number"
              step={terms.rateUnit === "month" ? "0.25" : "0.5"}
              min={terms.rateUnit === "month" ? "0.25" : "0.5"}
              max={terms.rateUnit === "month" ? "1" : terms.rateUnit === "day" ? String(joursDansPlage) : "24"}
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              required={terms.rateUnit === "hour"}
              placeholder={terms.rateUnit === "day" ? String(joursDansPlage) : terms.rateUnit === "month" ? "1" : "8"}
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={busy === "submit"}
            className="h-9 px-4 rounded-lg bg-[#0f172a] text-white text-[13px] font-semibold hover:bg-black transition-colors disabled:opacity-50"
          >
            {busy === "submit" ? "Envoi…" : "Déclarer"}
          </button>
          <p className="col-span-2 sm:col-span-4 text-[11px] text-[#94A3B8] tabular-nums">
            Valeur estimée :{" "}
            {attendanceAmount(
              terms,
              Number(quantite) || (terms.rateUnit === "day" ? joursDansPlage : terms.rateUnit === "month" ? 1 : 0)
            ).toLocaleString("fr-FR")}{" "}
            {d} — versée seulement après constat.
          </p>
        </form>
      )}

      {peutValider && enAttente.length > 0 && (
        <p className="mt-3 text-[12px] font-semibold text-[#92400E]">
          {enAttente.length} relevé{enAttente.length > 1 ? "s" : ""} en attente de décision
        </p>
      )}

      <div className="mt-3 rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
        {data.items.length === 0 && (
          <p className="px-3.5 py-4 text-[12.5px] text-[#94A3B8]">
            {estTravailleur ? "Déclarez votre première période travaillée ci-dessus." : "Aucun relevé pour l'instant."}
          </p>
        )}
        {data.items.map((item) => {
          const meta = STATUS_META[item.status] ?? STATUS_META.open;
          const valide = item.status === "approved";
          const ouverte = decision?.id === item.id ? decision : null;
          const previewQty = ouverte ? Number(ouverte.quantity) || 0 : 0;
          const preview = ouverte && ouverte.kind !== "reject"
            ? attendanceAmount(terms, previewQty, Number(ouverte.overtime) || 0)
            : 0;
          return (
            <div key={item.id} className="px-3.5 py-2.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong className="text-[12.5px]">{periodLabel(item, terms.rateUnit)}</strong>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.bg} ${meta.fg}`}>{meta.label}</span>
                  </div>
                  <div className="text-[11.5px] text-[#64748B] mt-0.5">
                    Déclaré : {unite(item.declaredQuantity, terms.rateUnit)}
                    {(valide || item.status === "disputed") && item.approvedQuantity !== null && item.approvedQuantity !== item.declaredQuantity && (
                      <> · constaté : {unite(item.approvedQuantity, terms.rateUnit)}</>
                    )}
                    {item.rejectionReason && <> · motif : {item.rejectionReason}</>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <strong className={`text-[12.5px] tabular-nums ${valide ? "text-[#008751]" : "text-[#64748B]"}`}>
                    {item.amount.toLocaleString("fr-FR")} {d}
                  </strong>
                  {/* Un relevé non validé affiche ce qu'il VAUDRAIT, jamais ce qu'il rapporte. */}
                  <div className="text-[10.5px] text-[#94A3B8] leading-tight">{valide ? "reconnu dû" : "valeur estimée"}</div>
                </div>
              </div>

              {peutValider && item.status === "submitted" && !ouverte && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => ouvrirDecision(item, "approve")}
                    className="flex-1 h-9 rounded-lg bg-[#008751] text-white text-[12.5px] font-semibold hover:bg-[#007a49] transition-colors"
                  >
                    Constater
                  </button>
                  <button
                    onClick={() => ouvrirDecision(item, "dispute")}
                    className="h-9 px-3.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] text-[12.5px] font-medium text-[#92400E] hover:bg-[#FEF3C7]"
                  >
                    Contester
                  </button>
                  <button
                    onClick={() => ouvrirDecision(item, "reject")}
                    className="h-9 px-3.5 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F8FAF9]"
                  >
                    Refuser
                  </button>
                </div>
              )}

              {/* Décision prise DANS la ligne : le montant libéré est visible avant de confirmer. */}
              {ouverte && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    confirmerDecision(item);
                  }}
                  className="mt-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAF9] p-2.5 space-y-2"
                >
                  {ouverte.kind !== "reject" && (
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="block text-[11px] text-[#64748B] mb-1">
                          {ouverte.kind === "dispute" ? "Part reconnue" : "Quantité constatée"} ({u.many})
                        </span>
                        <input
                          id={`decision-qty-${item.id}`}
                          type="number"
                          step="0.25"
                          min="0"
                          max={item.declaredQuantity}
                          value={ouverte.quantity}
                          onChange={(e) => setDecision({ ...ouverte, quantity: e.target.value })}
                          className={inputCls}
                          autoFocus
                        />
                      </label>
                      {ouverte.kind === "approve" && terms.overtimeAllowed && (
                        <label>
                          <span className="block text-[11px] text-[#64748B] mb-1">Dont heures sup.</span>
                          <input
                            id={`decision-overtime-${item.id}`}
                            type="number"
                            step="0.5"
                            min="0"
                            max={ouverte.quantity}
                            value={ouverte.overtime}
                            onChange={(e) => setDecision({ ...ouverte, overtime: e.target.value })}
                            className={inputCls}
                          />
                        </label>
                      )}
                    </div>
                  )}
                  {ouverte.kind !== "approve" && (
                    <label className="block">
                      <span className="block text-[11px] text-[#64748B] mb-1">
                        Motif {ouverte.kind === "reject" ? "du refus" : "de la contestation"} (visible par le prestataire)
                      </span>
                      <input
                        id={`decision-reason-${item.id}`}
                        type="text"
                        value={ouverte.reason}
                        onChange={(e) => setDecision({ ...ouverte, reason: e.target.value })}
                        required
                        className={inputCls}
                        autoFocus={ouverte.kind === "reject"}
                      />
                    </label>
                  )}
                  <p className="text-[11.5px] text-[#475569] tabular-nums">
                    {ouverte.kind === "reject"
                      ? "Rien ne sera versé ; le prestataire pourra corriger et redéclarer cette période."
                      : ouverte.kind === "dispute"
                        ? `${preview.toLocaleString("fr-FR")} ${d} libérés, ${attendanceAmount(terms, Math.max(0, item.declaredQuantity - previewQty)).toLocaleString("fr-FR")} ${d} gelés en attendant l'arbitrage.`
                        : `${preview.toLocaleString("fr-FR")} ${d} seront libérés au prestataire.`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy === item.id || (ouverte.kind !== "approve" && !ouverte.reason.trim())}
                      className={`flex-1 h-9 rounded-lg text-white text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
                        ouverte.kind === "reject" ? "bg-[#B91C1C] hover:bg-[#991B1B]" : "bg-[#008751] hover:bg-[#007a49]"
                      }`}
                    >
                      {busy === item.id
                        ? "Envoi…"
                        : ouverte.kind === "reject"
                          ? "Refuser le relevé"
                          : ouverte.kind === "dispute"
                            ? "Contester"
                            : "Constater et libérer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecision(null)}
                      className="h-9 px-3.5 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F1F5F9]"
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              )}

              {/* Litige ouvert : la part contestée est gelée — ni versée, ni rendue. */}
              {item.status === "disputed" && (
                <div className="mt-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-2.5">
                  <p className="text-[12px] text-[#92400E] leading-relaxed">
                    <strong>Part contestée gelée au séquestre.</strong>{" "}
                    {unite(item.declaredQuantity - (item.approvedQuantity ?? 0), terms.rateUnit)} en attente d&apos;arbitrage —
                    ces fonds ne sont ni versés, ni rendus.
                  </p>
                  {peutValider && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => arbitrer(item, true)}
                        disabled={busy === item.id}
                        className="flex-1 h-9 rounded-lg bg-[#008751] text-white text-[12.5px] font-semibold hover:bg-[#007a49] disabled:opacity-50"
                      >
                        Reconnaître et payer
                      </button>
                      <button
                        onClick={() => arbitrer(item, false)}
                        disabled={busy === item.id}
                        className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50"
                      >
                        Écarter
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {notice && (
        <div className="mt-3 rounded-xl border border-[#A7F3D0] bg-[#E6F4EE] p-3 text-[12.5px] text-[#00623A] leading-relaxed" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[12.5px] text-[#B91C1C] leading-relaxed" role="alert">
          {error}
        </div>
      )}

      {/* Clôture du chantier (§22) — le client seul, et jamais en silence : ce qui revient au
          client est annoncé avant la confirmation. Sur un chantier DÉJÀ clos (plafond atteint) dont
          un arbitrage a ensuite libéré des fonds, le même geste récupère ce solde tout de suite. */}
      {role === "client" && !data.suspended && (actif || data.available > 0) && (
        <div className="mt-4 border-t border-[#F1F5F9] pt-3">
          {!confirmClose ? (
            <button
              onClick={() => {
                setError(null);
                setConfirmClose(true);
              }}
              className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F8FAF9]"
            >
              {data.closed ? `Récupérer le solde non consommé (${data.available.toLocaleString("fr-FR")} ${d})` : "Clôturer le chantier"}
            </button>
          ) : (
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAF9] p-3 space-y-2">
              <p className="text-[12.5px] text-[#334155] leading-relaxed">
                {enAttente.length > 0 ? (
                  <>
                    {enAttente.length} relevé{enAttente.length > 1 ? "s attendent" : " attend"} encore votre décision :
                    traitez-{enAttente.length > 1 ? "les" : "le"} avant de clôturer.
                  </>
                ) : (
                  <>
                    Plus aucune présence ne pourra être déclarée. Le solde non consommé du séquestre, soit{" "}
                    <strong className="tabular-nums">{data.available.toLocaleString("fr-FR")} {d}</strong>, vous sera restitué.
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={cloturer}
                  disabled={busy === "close" || enAttente.length > 0}
                  className="flex-1 h-9 rounded-lg bg-[#0f172a] text-white text-[12.5px] font-semibold hover:bg-black disabled:opacity-50"
                >
                  {busy === "close" ? "Clôture…" : "Confirmer la clôture"}
                </button>
                <button
                  onClick={() => setConfirmClose(false)}
                  className="h-9 px-3.5 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F1F5F9]"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
