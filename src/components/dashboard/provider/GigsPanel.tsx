"use client";

import { GigManager } from "@/components/gig/GigManager";

// « Mes Gigs » — onglet de la rubrique Offres du tableau de bord prestataire. Depuis le
// 2026-11-08, même gestionnaire que la rubrique « Mes services » du profil (GigManager) :
// trois formules, visuel, mots-clés, publication / pause / clôture.
export default function GigsPanel() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[18px] font-extrabold text-[#0A1931]">Mes services (Gigs)</h2>
        <p className="text-[13px] text-gray-500 mt-1">
          Tes prestations à prix fixe, en trois formules. Le client choisit sa formule, signe en premier, tu contre-signes sous 24h.
        </p>
      </div>
      <GigManager />
    </div>
  );
}
