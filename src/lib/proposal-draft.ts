// Brouillon local d'une candidature à prix fixe/taux en cours de saisie — même mécanisme
// que src/lib/devis-draft.ts (mode devis), pour le même cas : la candidature est bloquée par
// un profil incomplet (garant obligatoire manquant, assurance RC Pro manquante sur une
// mission à risque élevé, voir checkCandidatureEligibility dans src/lib/candidature-guard.ts).
// Plutôt que de perdre la saisie du prestataire, on la conserve côté navigateur : il complète
// son profil sur /profile, puis revient sur la mission où son montant/message est restauré.
export type ProposalDraft = {
  montant: number;
  // Contre-proposition : délai proposé (jours) — optionnel, restauré avec le reste.
  delaiPropose?: number;
  message: string;
  savedAt: string;
};

function draftKey(missionId: string): string {
  return `flexwork:proposal-draft:${missionId}`;
}

export function saveProposalDraft(missionId: string, draft: Omit<ProposalDraft, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(missionId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Stockage plein ou désactivé (navigation privée) : le brouillon est un confort, pas
    // une garantie — on ne bloque jamais la candidature pour autant.
  }
}

export function loadProposalDraft(missionId: string): ProposalDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(missionId));
    return raw ? (JSON.parse(raw) as ProposalDraft) : null;
  } catch {
    return null;
  }
}

export function clearProposalDraft(missionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(missionId));
  } catch {
    // idem : rien à faire si le stockage est indisponible.
  }
}
