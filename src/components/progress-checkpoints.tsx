"use client";

// Historique des points d'étape confirmés ("validations partielles" — voir POST
// .../checkpoint) — partagé entre la vue client (ValidationClientView, qui les pose) et la
// vue prestataire (missions/[id]/deliverable, qui doit pouvoir les consulter : le prestataire
// a besoin de voir que le client a confirmé une étape, pas seulement le client qui l'a posée).
export type Checkpoint = {
  id: string;
  jalonId: string | null;
  jalonTitre: string | null;
  jalonOrdre: number | null;
  progress: number;
  validatedByName: string;
  createdAt: string;
};

// Le plus récent point d'étape confirmé — `checkpoints` est déjà trié desc par date côté
// serveur (GET .../checkpoints), donc le premier élément suffit.
export function latestCheckpointProgress(checkpoints: Checkpoint[]): number | null {
  return checkpoints[0]?.progress ?? null;
}

// Cumul CONFIRMÉ (monotone) pour l'affichage du taux de progression validé (en-tête de carte,
// bandeau récapitulatif) : le niveau le PLUS HAUT jamais confirmé par un point d'étape. Un
// point d'étape enregistre la progression constatée à un instant (cumul croissant) — si une
// confirmation arrive en baisse (régression, ex. test manuel : 65 % puis 15 %), le cumul ne
// doit PAS redescendre : le MAX des points d'étape fait foi. Signalé 2026-09-05 (« la valeur
// cumulée de l'en-tête ne s'est pas mise à jour par rapport au taux cumulé ») : l'en-tête
// restait bloqué sur le dernier point d'étape (15 %) au lieu du cumul réel (65 %).
export function cumulativeCheckpointProgress(checkpoints: Checkpoint[]): number | null {
  if (checkpoints.length === 0) return null;
  return Math.max(...checkpoints.map((c) => c.progress));
}

// Regroupe les points d'étape PAR JALON — un contrat à jalons peut avoir plusieurs jalons,
// chacun avec ses propres validations partielles ; les mélanger dans une seule liste ne dit
// pas à quelle tranche du contrat chaque confirmation se rapporte. jalonId null = mission
// sans jalon (un seul groupe). Trié par ordre du jalon (mission sans jalon en tête).
export function groupCheckpointsByJalon(checkpoints: Checkpoint[]): { jalonId: string | null; jalonTitre: string | null; items: Checkpoint[] }[] {
  const groups = new Map<string | null, { jalonId: string | null; jalonTitre: string | null; ordre: number; items: Checkpoint[] }>();
  for (const c of checkpoints) {
    const existing = groups.get(c.jalonId);
    if (existing) existing.items.push(c);
    else groups.set(c.jalonId, { jalonId: c.jalonId, jalonTitre: c.jalonTitre, ordre: c.jalonOrdre ?? -1, items: [c] });
  }
  return [...groups.values()].sort((a, b) => a.ordre - b.ordre).map(({ jalonId, jalonTitre, items }) => ({ jalonId, jalonTitre, items }));
}

// Barre de progression compacte pour la colonne "Statut" des tables récapitulatives (client
// ET prestataire) — reflète le dernier point d'étape CONFIRMÉ, pas le curseur en cours
// d'édition dans la modale. Rien à afficher tant qu'aucun point d'étape n'a été validé.
export function CheckpointProgressBar({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const progress = latestCheckpointProgress(checkpoints);
  if (progress === null) return null;
  return (
    <div className="mt-1.5 min-w-[90px]">
      <div className="flex items-center justify-between text-[10px] text-[#64748B] mb-0.5">
        <span>Progression confirmée</span><span className="font-semibold">{progress}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#F1F5F9] overflow-hidden">
        <div className="h-full rounded-full bg-[#008751]" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

// Historique en TABLE (une ligne par soumission de validation partielle) — pour les dropdowns
// posés directement sur une ligne de table récapitulative (ex. ValidationClientView), où le
// format tabulaire s'intègre mieux que la liste à puces de CheckpointHistory ci-dessous.
// Numérotation chronologique croissante (#1 = premier point confirmé) alors que `checkpoints`
// reste affiché du plus récent au plus ancien (même ordre que le reste de l'app).
export function CheckpointHistoryTable({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (checkpoints.length === 0) {
    return <p className="text-[12px] text-[#94A3B8] text-center py-3">Aucune soumission de validation partielle pour l&apos;instant.</p>;
  }
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-[#94A3B8]">
          <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">#</th>
          <th className="text-left font-semibold py-1.5 px-2">Progression constatée</th>
          <th className="text-left font-semibold py-1.5 px-2">Confirmé par</th>
          <th className="text-left font-semibold py-1.5 px-2 whitespace-nowrap">Date</th>
        </tr>
      </thead>
      <tbody>
        {checkpoints.map((c, i) => (
          <tr key={c.id} className="border-t border-[#F1F5F9]">
            <td className="py-1.5 px-2 text-[#94A3B8] font-mono">{String(checkpoints.length - i).padStart(2, "0")}</td>
            <td className="py-1.5 px-2 font-semibold text-[#0A1931]">{c.progress}%</td>
            <td className="py-1.5 px-2 text-[#475569]">{c.validatedByName}</td>
            <td className="py-1.5 px-2 text-[#94A3B8] whitespace-nowrap">{new Date(c.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CheckpointHistory({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (checkpoints.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-[#F1F5F9] space-y-1.5">
      <div className="text-[11px] font-semibold text-[#64748B]">Points d&apos;étape confirmés</div>
      <ul className="space-y-1">
        {checkpoints.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-[11.5px] text-[#475569]">
            <span>✓ {c.progress}% constatés par {c.validatedByName}</span>
            <span className="text-[#94A3B8]">{new Date(c.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
