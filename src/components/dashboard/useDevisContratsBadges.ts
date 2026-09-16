"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { onBadgesShouldRefresh } from "@/lib/badge-sync";

export type DevisContratsCounts = {
  brouillon: number;
  negociation: number;
  valide: number;
  rejete: number;
  /** Devis clos (mission `cloturee`) — distinct de `cloture`, qui compte les CONTRATS clôturés. */
  devisCloture: number;
  enCours: number;
  cloture: number;
};

const EMPTY: DevisContratsCounts = { brouillon: 0, negociation: 0, valide: 0, rejete: 0, devisCloture: 0, enCours: 0, cloture: 0 };

// Compteurs du bloc sidebar "Documents Contractuels" (Mes Devis / Contrats Signés) —
// même cadence et même robustesse (échec silencieux, on garde la valeur précédente) que
// useSidebarBadges. Partage la même URL que la page "Devis & Contrats" via fetchDedupe :
// pas de double appel réseau quand le bloc sidebar et la page sont montés en même temps.
/**
 * @param enabled Faux : aucune requête, aucun sondage, compteurs à zéro.
 *
 * Ajouté pour le tableau de bord du responsable de chantier (2026-09-14), qui n'affiche pas le
 * bloc « Documents Contractuels » : il n'a ni devis ni contrat. Sans ce drapeau, son écran
 * interrogeait `/api/devis-contrats` toutes les trente secondes, indéfiniment, pour des
 * compteurs que personne ne regardait.
 */
export function useDevisContratsBadges(enabled = true): DevisContratsCounts {
  const [counts, setCounts] = useState<DevisContratsCounts>(EMPTY);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await fetchDedupe("/api/devis-contrats");
      if (r.ok) {
        const d = await r.json();
        setCounts(d.counts ?? EMPTY);
      }
    } catch {
      /* réseau indisponible — on garde la valeur précédente */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Resynchronisation immédiate après une action locale (devis rejeté, révision
    // demandée…) — voir src/lib/badge-sync.ts.
    const unsubscribe = onBadgesShouldRefresh(refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh, enabled]);

  return counts;
}
