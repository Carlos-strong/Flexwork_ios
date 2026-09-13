// Brouillon local d'un devis en cours de saisie — utilisé quand la candidature est bloquée
// par un profil incomplet (garant obligatoire manquant, assurance RC Pro manquante sur une
// mission à risque élevé, voir checkCandidatureEligibility dans src/lib/candidature-guard.ts).
// Plutôt que de perdre la saisie du prestataire, on la conserve côté navigateur (aucune
// donnée serveur/brouillon persistant nécessaire pour ce cas transitoire) : il complète son
// profil sur une autre page, puis revient sur la mission où son devis est restauré tel quel.
export type DevisDraft = {
  lineItems: { description: string; quantity: number; unit: string; unitPrice: number; echeance?: string }[];
  delay: string;
  // Date de début souhaitée (format `yyyy-mm-dd` du champ natif). OPTIONNELLE dans le type,
  // alors que le formulaire l'exige : les brouillons enregistrés avant 2026-09-10 sont déjà
  // dans le localStorage des prestataires sans ce champ, et doivent continuer à se relire.
  // Sans elle, un brouillon restauré revenait complet mais laissait le bouton « Soumettre »
  // grisé sur le seul champ non restauré, sans que rien ne le désigne.
  dateDebut?: string;
  notes: string;
  tvaRate: number;
  laborCost: number;
  savedAt: string;
};

function draftKey(missionId: string): string {
  return `flexwork:devis-draft:${missionId}`;
}

export function saveDevisDraft(missionId: string, draft: Omit<DevisDraft, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(missionId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Stockage plein ou désactivé (navigation privée) : le brouillon est un confort, pas
    // une garantie — on ne bloque jamais la candidature pour autant.
  }
}

export function loadDevisDraft(missionId: string): DevisDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(missionId));
    return raw ? (JSON.parse(raw) as DevisDraft) : null;
  } catch {
    return null;
  }
}

export function clearDevisDraft(missionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(missionId));
  } catch {
    // idem : rien à faire si le stockage est indisponible.
  }
}

/**
 * Ce que le formulaire doit faire de la date de début d'un brouillon.
 *
 * Une date déjà passée n'est pas restaurée : un brouillon peut dormir des semaines, et cette
 * date repart telle quelle dans le message envoyé au client (`notesWithStartDate`, page devis)
 * sans que le prestataire l'ait reconfirmée.
 *
 * `expired` distingue les deux façons d'obtenir un champ vide — brouillon sans date (rien à
 * signaler) et date écartée parce que passée (à signaler explicitement). Sans cette
 * distinction, la seconde était indiscernable de la première : le champ revenait vide, le
 * bouton restait grisé, et rien ne disait au prestataire QUE sa date avait été écartée ni
 * POURQUOI — il n'avait plus qu'une liste générique de trois causes possibles à parcourir.
 *
 * Comparaison de chaînes `yyyy-mm-dd` : le format natif de l'input date est ordonnable
 * lexicographiquement, ce qui évite un `new Date(...)` dont le fuseau déciderait du résultat
 * à la frontière de minuit.
 */
export type RestorableDateDebut = {
  // Valeur à mettre dans le champ — `""` si rien n'est restaurable.
  value: string;
  // Vrai uniquement si le brouillon PORTAIT une date et qu'elle a été écartée car passée.
  expired: boolean;
  // La date écartée, pour pouvoir la rappeler dans l'avertissement.
  expiredValue?: string;
};

export function restorableDateDebut(
  draft: Pick<DevisDraft, "dateDebut">,
  today: string = new Date().toISOString().slice(0, 10)
): RestorableDateDebut {
  if (!draft.dateDebut) return { value: "", expired: false };
  if (draft.dateDebut >= today) return { value: draft.dateDebut, expired: false };
  return { value: "", expired: true, expiredValue: draft.dateDebut };
}
