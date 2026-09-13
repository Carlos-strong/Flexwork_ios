"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { DevisData, DevisLineItemInput } from "@/lib/devis";
import { computeDevisData } from "@/lib/devis";
import { saveDevisDraft, loadDevisDraft, clearDevisDraft } from "@/lib/devis-draft";
import { candidaturesHrefForRole, type Role } from "@/lib/role-dashboard";

type EditableItem = DevisLineItemInput & { id: string };

const UNITS = ["forfait", "m2", "ml", "u", "h", "jour"];

// Formulaire de devis BTP (jalons détaillés + délai + notes). Réutilise computeDevisData
// (src/lib/devis.ts) pour l'aperçu des totaux — la même fonction que le serveur, aucun
// double calcul. Montants dans la devise de la mission, jamais de centimes.
export function DevisForm({
  missionId,
  maxRounds,
  initial,
  onSubmitted,
}: {
  missionId: string;
  maxRounds: number;
  initial?: DevisData | null;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const role = (useSession().data?.user as { role?: Role } | undefined)?.role;
  const [items, setItems] = useState<EditableItem[]>(() =>
    initial?.lineItems?.length
      ? initial.lineItems.map((i, idx) => ({
          id: String(idx),
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
        }))
      : [{ id: "1", description: "", quantity: 1, unit: "forfait", unitPrice: 0 }]
  );
  const [delay, setDelay] = useState(initial?.delay ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [tvaRate, setTvaRate] = useState(initial?.tvaRate ?? 0);
  // Rubrique Main d'œuvre — forfait distinct des jalons ci-dessus, additionné au sous-total
  // avant TVA (voir le principe de calcul documenté dans computeDevisData).
  const [laborCost, setLaborCost] = useState(initial?.laborCost ?? 0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  // Blocage par profil incomplet (garant/assurance manquant) — distinct de `feedback` : il
  // ne se contente pas de signaler une erreur, il enregistre un brouillon et redirige vers
  // l'action à faire (compléter le profil), voir submit() plus bas.
  const [blockedByProfile, setBlockedByProfile] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);

  // Restaure un brouillon local sauvegardé lors d'un précédent blocage — uniquement pour une
  // toute première soumission (jamais pour une révision d'un devis déjà réel côté serveur,
  // où `initial` prévaut). Dans un useEffect (pas l'initialiseur de useState) pour éviter
  // toute divergence serveur/client à l'hydratation : localStorage n'existe pas côté serveur.
  useEffect(() => {
    if (initial) return;
    const draft = loadDevisDraft(missionId);
    if (!draft) return;
    setItems(draft.lineItems.map((i, idx) => ({ id: String(idx), ...i })));
    setDelay(draft.delay);
    setNotes(draft.notes);
    setTvaRate(draft.tvaRate);
    setLaborCost(draft.laborCost);
    setRestoredFromDraft(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit tourner qu'au montage
  }, []);

  const totals = computeDevisData(
    items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice })),
    delay,
    notes,
    tvaRate,
    laborCost
  );
  const itemsSubtotal = totals.lineItems.reduce((sum, i) => sum + i.total, 0);

  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), description: "", quantity: 1, unit: "forfait", unitPrice: 0 },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== id) : prev));
  }

  function updateItem(id: string, field: keyof DevisLineItemInput, value: string | number) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  async function submit() {
    if (items.some((i) => !i.description.trim() || i.quantity <= 0 || i.unitPrice < 0)) {
      setFeedback({ ok: false, msg: "Veuillez remplir tous les jalons avec un prix valide." });
      return;
    }
    if (!delay.trim()) {
      setFeedback({ ok: false, msg: "Veuillez indiquer un délai de réalisation." });
      return;
    }

    const lineItemsPayload = items.map((i) => ({
      description: i.description.trim(),
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
    }));

    setPending(true);
    setFeedback(null);
    setBlockedByProfile(null);
    const res = await fetch(`/api/missions/${missionId}/devis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineItems: lineItemsPayload,
        delay: delay.trim(),
        notes: notes || undefined,
        tvaRate: Number(tvaRate) || 0,
        laborCost: Number(laborCost) || 0,
      }),
    });
    setPending(false);

    if (res.ok) {
      clearDevisDraft(missionId);
      setFeedback({ ok: true, msg: "Devis soumis — redirection vers vos candidatures..." });
      onSubmitted?.();
      // Court délai pour laisser voir la confirmation avant de quitter la page, plutôt
      // qu'un bond de page instantané (même principe que le retour auto sur /profile).
      setTimeout(() => router.push(candidaturesHrefForRole(role)), 1200);
      return;
    }

    const d = await res.json().catch(() => ({}));
    // Profil incomplet (garant obligatoire manquant pour une mission présentiel/hybride, ou
    // assurance RC Pro manquante sur une mission à risque élevé — checkCandidatureEligibility
    // dans src/lib/candidature-guard.ts) : le devis n'est PAS perdu, on l'enregistre en
    // brouillon local et on oriente vers l'action à faire plutôt que d'afficher une simple
    // erreur que le candidat ne saurait pas résoudre depuis cette page.
    if (d.error === "garant_required" || d.error === "insurance_required") {
      saveDevisDraft(missionId, {
        lineItems: lineItemsPayload,
        delay: delay.trim(),
        notes,
        tvaRate: Number(tvaRate) || 0,
        laborCost: Number(laborCost) || 0,
      });
      setBlockedByProfile(d.message ?? "Votre profil doit être complété avant de candidater à cette mission.");
      return;
    }

    // Gardes de sécurité (vagues 1-2) : auto-attribution et contrôle d'âge A13 (filière
    // chantier) — messages explicites au lieu du fallback générique.
    if (d.error === "self_dealing_forbidden") {
      setFeedback({ ok: false, msg: "Vous ne pouvez pas soumettre un devis à votre propre mission." });
      return;
    }
    if (d.error === "age_under_minimum") {
      setFeedback({ ok: false, msg: "Vous devez avoir l'âge minimum requis (18 ans) pour candidater à cette mission de chantier." });
      return;
    }
    if (d.error === "kyc_required_for_age") {
      setFeedback({ ok: false, msg: "Votre identité (KYC) doit être vérifiée avant de candidater à une mission de chantier." });
      return;
    }

    setFeedback({ ok: false, msg: d.message ?? d.error ?? "Échec de la soumission." });
  }

  return (
    <div className="space-y-4">
      {restoredFromDraft && !blockedByProfile && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Brouillon restauré — reprenez votre devis là où vous l&apos;aviez laissé avant de compléter votre profil.
        </div>
      )}

      {blockedByProfile && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
          <p className="font-semibold">{blockedByProfile}</p>
          <p>
            Votre devis a été enregistré comme brouillon sur cet appareil — complétez votre profil, puis revenez sur
            cette page pour le retrouver tel quel et valider votre candidature.
          </p>
          <Link
            href={`/profile?returnTo=${encodeURIComponent(`/missions/${missionId}`)}`}
            className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          >
            Compléter mon profil
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <span>
          Révisions autorisées : <span className="font-mono font-semibold text-emerald-700">{maxRounds}</span>
        </span>
        <span>
          Total TTC :{" "}
          <span className="font-mono font-bold text-zinc-900">
            {totals.totalTTC.toLocaleString("fr-FR")}
          </span>
        </span>
      </div>

      <div className="space-y-2">
        {/* Libellés des colonnes — alignés sur les mêmes largeurs (col-span) que les lignes
            ci-dessous, masqués sur mobile où la grille de saisie devient illisible en colonnes. */}
        <div className="hidden sm:grid grid-cols-12 gap-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 text-center">
          <div className="col-span-4">Description du jalon</div>
          <div className="col-span-2">Quantité</div>
          <div className="col-span-2">Unité</div>
          <div className="col-span-2">Prix unitaire</div>
          <div className="col-span-1">Montant</div>
          <div className="col-span-1" />
        </div>
        {items.map((item) => (
          <div key={item.id} className="grid grid-cols-12 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="col-span-4">
              <input
                value={item.description}
                onChange={(e) => updateItem(item.id, "description", e.target.value)}
                placeholder="Description"
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="col-span-2">
              <input
                type="number"
                min={0}
                value={item.quantity}
                onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value) || 0)}
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-right"
              />
            </div>
            <div className="col-span-2">
              <select
                value={item.unit}
                onChange={(e) => updateItem(item.id, "unit", e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <input
                type="number"
                min={0}
                step={0.01}
                value={item.unitPrice || ""}
                onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-right"
              />
            </div>
            <div className="col-span-1 flex items-center justify-end font-mono text-xs text-zinc-600">
              {(item.quantity * item.unitPrice).toLocaleString("fr-FR")}
            </div>
            <div className="col-span-1 flex items-center justify-end">
              <button
                onClick={() => removeItem(item.id)}
                disabled={items.length <= 1}
                className="rounded p-1 text-zinc-400 hover:text-red-600 disabled:opacity-30"
                aria-label="Supprimer le jalon"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addItem}
        className="rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-emerald-600 hover:text-emerald-700"
      >
        + Ajouter un jalon
      </button>

      {/* Rubrique Main d'œuvre — distincte des jalons matériaux/prestations ci-dessus,
          additionnée au sous-total avant TVA (voir computeDevisData, src/lib/devis.ts). */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">Main d&apos;œuvre</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={0.01}
            value={laborCost || ""}
            onChange={(e) => setLaborCost(parseFloat(e.target.value) || 0)}
            placeholder="0"
            className="w-full max-w-[220px] rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-right"
          />
          <span className="text-sm text-zinc-500">Coût forfaitaire de la main d&apos;œuvre, ajouté au total avant TVA.</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">Délai</label>
          <input
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
            placeholder="Ex. 3 semaines"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Conditions particulières..."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">TVA (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={tvaRate}
            onChange={(e) => setTvaRate(parseFloat(e.target.value) || 0)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-4">
        <div className="space-y-1 text-sm text-zinc-600">
          <div className="flex justify-between gap-8">
            <span>Sous-total jalons</span>
            <span className="font-mono">{itemsSubtotal.toLocaleString("fr-FR")}</span>
          </div>
          <div className="flex justify-between gap-8">
            <span>Main d&apos;œuvre</span>
            <span className="font-mono">{totals.laborCost.toLocaleString("fr-FR")}</span>
          </div>
          <div className="flex justify-between gap-8">
            <span>Total HT</span>
            <span className="font-mono">{totals.totalHT.toLocaleString("fr-FR")}</span>
          </div>
          <div className="flex justify-between gap-8">
            <span>TVA ({tvaRate}%)</span>
            <span className="font-mono">{totals.tva.toLocaleString("fr-FR")}</span>
          </div>
          <div className="flex justify-between gap-8 font-bold text-zinc-900">
            <span>Total TTC</span>
            <span className="font-mono text-emerald-700">{totals.totalTTC.toLocaleString("fr-FR")}</span>
          </div>
        </div>
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-emerald-700 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Envoi..." : "Soumettre le devis"}
        </button>
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.msg}</p>
      )}
    </div>
  );
}
