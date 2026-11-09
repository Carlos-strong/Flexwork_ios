"use client";

import { useCallback, useEffect, useState } from "react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  btnPrimary,
  fetchJson,
  inputBase,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

type FeatureFlagEntry = { id: string; key: string; zone: string; enabled: boolean; note: string | null; updatedAt: string };

/**
 * Suivi des prérequis juridiques bloquants — repris de l'ancien écran « Prérequis ».
 *
 * C'est un DOCUMENT, pas une donnée : ces statuts ne sont stockés nulle part en base, ils
 * reflètent le §5 de `etat-consolide-Flexwork.md` et se mettent à jour en éditant ce fichier.
 * L'écran le dit en toutes lettres plutôt que de laisser croire à un suivi en temps réel.
 * Il vit ici parce que c'est lui qui conditionne l'activation d'une filière : on ne bascule
 * pas un interrupteur sans voir ce qu'il engage.
 */
const LEGAL_PREREQUISITES = [
  { n: "1", label: "Validation du statut d’intermédiaire par un avocat béninois", status: "En cours", pending: true, blocks: "Modèle entier" },
  { n: "2", label: "Opposabilité des clauses de responsabilité (CGU + contrat)", status: "En cours", pending: true, blocks: "Phase 4+" },
  { n: "3", label: "Montage PSP : plateforme jamais bénéficiaire des fonds", status: "Non traité", pending: false, blocks: "Phase 5 — séquestre" },
  { n: "4", label: "Statut de distribution de l’assurance à la mission", status: "Non traité", pending: false, blocks: "Phase 7 — risque élevé" },
  { n: "5", label: "Risque de requalification en relation de travail", status: "En cours", pending: true, blocks: "CGU Prestataire" },
  { n: "6", label: "Validité de la signature électronique entre tiers", status: "Non traité", pending: false, blocks: "US-403 — signature" },
  { n: "7", label: "Protection des données de pointage (déclaration APDP)", status: "Non traité", pending: false, blocks: "US-406 — pointage" },
];

export default function FilieresPage() {
  const canAct = useCanActIn("parametres", "parametres-filieres");

  const [flags, setFlags] = useState<FeatureFlagEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({ key: "", zone: "BJ", note: "" });

  const load = useCallback(async () => {
    const res = await fetchJson<{ items: FeatureFlagEntry[] }>("/api/admin/feature-flags");
    if (res.ok) setFlags(res.data.items);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key: string, zone: string, enabled: boolean, note?: string) {
    setBusy(`${key}:${zone}`);
    setFeedback(null);
    const res = await fetch("/api/admin/feature-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, zone, enabled, note: note || undefined }),
    });
    setBusy(null);
    if (!res.ok) {
      setFeedback({ ok: false, text: "La filière n’a pas pu être mise à jour." });
      return false;
    }
    setFeedback({ ok: true, text: `${key} (${zone}) : ${enabled ? "activée" : "désactivée"}. Le geste est journalisé.` });
    load();
    return true;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (draft.key.trim().length < 2 || draft.zone.trim().length < 2) return;
    // Une filière naît DÉSACTIVÉE : l'activer est un second geste, pris en connaissance des
    // prérequis ci-dessous. La créer ne doit pas l'ouvrir.
    if (await save(draft.key.trim(), draft.zone.trim().toUpperCase(), false, draft.note.trim())) {
      setDraft({ key: "", zone: "BJ", note: "" });
    }
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="⚙️"
        title="Paramètres — Filières & activation"
        subtitle="Une filière s’ouvre zone par zone, à la main, après confirmation du prérequis juridique correspondant. Jamais automatiquement."
        readOnly={!canAct}
      />

      {feedback && <AdminNotice tone={feedback.ok ? "green" : "red"}>{feedback.text}</AdminNotice>}

      <AdminCard title="Filières par zone" subtitle="FeatureFlag (clé × zone). Chaque bascule est tracée dans le journal d’audit avec son auteur." padded={false}>
        {flags === null ? (
          <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
        ) : flags.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucune filière enregistrée.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Clé</th>
                  <th className={tableHead}>Zone</th>
                  <th className={tableHead}>Note</th>
                  <th className={tableHead}>État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E0D9]">
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td className={`${tableCell} font-mono text-[12px]`}>{f.key}</td>
                    <td className={tableCell}>{f.zone}</td>
                    <td className={`${tableCell} text-[#5A5750]`}>{f.note ?? "—"}</td>
                    <td className={tableCell}>
                      {canAct ? (
                        <button
                          onClick={() => save(f.key, f.zone, !f.enabled, f.note ?? undefined)}
                          disabled={busy === `${f.key}:${f.zone}`}
                          className={`inline-flex h-8 items-center rounded-lg border px-3 text-[12px] font-semibold disabled:opacity-50 ${
                            f.enabled ? "border-[#9FD4B4] bg-[#E6F5EE] text-[#1A7A4A]" : "border-[#E2E0D9] bg-white text-[#5A5750]"
                          }`}
                        >
                          {f.enabled ? "● Activée" : "○ Désactivée"}
                        </button>
                      ) : (
                        <span className="text-[12.5px]">{f.enabled ? "● Activée" : "○ Désactivée"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {canAct && (
        <AdminCard title="Déclarer une filière" subtitle="Créée désactivée : l’ouvrir est un second geste.">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_120px_1.4fr_auto]">
            <input className={inputBase} placeholder="Clé (ex. signature_electronique)" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
            <input className={inputBase} placeholder="Zone" value={draft.zone} onChange={(e) => setDraft({ ...draft, zone: e.target.value })} />
            <input className={inputBase} placeholder="Note (prérequis, partenaire…)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            <button type="submit" className={btnPrimary}>
              Déclarer
            </button>
          </form>
        </AdminCard>
      )}

      <AdminCard
        title="Prérequis juridiques bloquants"
        subtitle="Suivi documentaire (§5 de l’état consolidé) — ces statuts ne sont pas stockés en base : ils se mettent à jour dans le code, avec le document."
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
              <tr>
                <th className={tableHead}>#</th>
                <th className={tableHead}>Prérequis</th>
                <th className={tableHead}>Statut</th>
                <th className={tableHead}>Bloque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E0D9]">
              {LEGAL_PREREQUISITES.map((r) => (
                <tr key={r.n}>
                  <td className={`${tableCell} text-[#9C9A95]`}>{r.n}</td>
                  <td className={tableCell}>{r.label}</td>
                  <td className={tableCell}>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        r.pending ? "border-[#FCD89A] bg-[#FEF3C7] text-[#B45309]" : "border-[#F5C2BE] bg-[#FDEDEC] text-[#B42318]"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className={`${tableCell} text-[#5A5750]`}>{r.blocks}</td>
                </tr>
              ))}
              <tr className="bg-[#FAFAF8]">
                <td className={`${tableCell} text-[#9C9A95]`}>—</td>
                <td className={tableCell}>
                  <strong>RC Pro propre à la plateforme</strong>
                </td>
                <td className={tableCell}>
                  <span className="inline-flex rounded-full border border-[#F5C2BE] bg-[#FDEDEC] px-2.5 py-0.5 text-[11px] font-semibold text-[#B42318]">
                    À souscrire
                  </span>
                </td>
                <td className={`${tableCell} text-[#5A5750]`}>Ouverture au public (§7 de l’état consolidé)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}
