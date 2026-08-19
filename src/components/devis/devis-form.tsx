"use client";

import { useState } from "react";
import type { DevisData, DevisLineItemInput } from "@/lib/devis";
import { computeDevisData } from "@/lib/devis";

type EditableItem = DevisLineItemInput & { id: string };

const UNITS = ["forfait", "m2", "ml", "u", "h", "jour"];

// Formulaire de devis BTP (postes détaillés + délai + notes). Réutilise computeDevisData
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
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const totals = computeDevisData(
    items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice })),
    delay,
    notes,
    tvaRate
  );

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
      setFeedback({ ok: false, msg: "Veuillez remplir tous les postes avec un prix valide." });
      return;
    }
    if (!delay.trim()) {
      setFeedback({ ok: false, msg: "Veuillez indiquer un délai de réalisation." });
      return;
    }

    setPending(true);
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/devis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineItems: items.map((i) => ({
          description: i.description.trim(),
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
        })),
        delay: delay.trim(),
        notes: notes || undefined,
        tvaRate: Number(tvaRate) || 0,
      }),
    });
    setPending(false);

    if (res.ok) {
      setFeedback({ ok: true, msg: "Devis soumis." });
      onSubmitted?.();
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback({ ok: false, msg: d.message ?? d.error ?? "Échec de la soumission." });
    }
  }

  return (
    <div className="space-y-4">
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
                aria-label="Supprimer le poste"
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
        + Ajouter un poste
      </button>

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
