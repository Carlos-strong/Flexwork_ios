"use client";

import { AuthHero } from "./auth-hero";
import { InscriptionScreens } from "@/components/auth/InscriptionScreens";

// ── Inscription SANS choix de rôle (2026-09-23, décision « Option C ») ─────────────────
//
// Le sélecteur de rôle (client / prestataire / responsable chantier) a été RETIRÉ. Il
// contredisait le principe arbitré : tout compte s'ouvre en CLIENT, et l'usage se déclare
// explicitement une fois le compte vérifié (écran P4, /devenir-prestataire).
//
// Ce que la suppression corrige concrètement : un formulaire d'inscription qui demandait
// « qui êtes-vous ? » avant de savoir ce que la personne venait faire, et deux parcours
// divergents dès la première seconde (un client ne voyait ni les mêmes étapes ni les mêmes
// champs qu'un prestataire) alors que l'identité, le contact et le consentement sont
// rigoureusement les mêmes pour tout le monde.
//
// `responsable_chantier` reste en SOURDINE : le rôle existe toujours en base et les API qui
// le concernent (désignation sur un contrat, constat de présence) sont intactes — il n'est
// simplement plus proposé ici, faute de modèle d'inscription propre. Il sera sollicité par
// API quand un client le désignera, ce qui est précisément la condition de son implication.
//
// Source unique pays ⇄ indicatif téléphonique : le select "Pays" et l'indicatif affiché
// partageaient auparavant deux listes divergentes (NG absent des pays, BF/NE absents des
// indicatifs) — on les dérive maintenant du même tableau. Déplacé dans src/lib/countries.ts
// (2026-09-23) pour que le profil client lise la même liste au lieu d'en recopier une troisième.

// Les deux écrans (P1 accueil, P2 identité) vivent dans InscriptionScreens — cette page ne
// fait que composer le chrome. Le commentaire d'origine sur la décision « Option C » est
// conservé dans le composant, au plus près du code qu'il justifie.
//
// Le formulaire n'a plus de champ mot de passe : l'authentification est 100 % OTP (src/auth.ts
// n'a qu'un provider, `otp`). Le champ était affiché, haché et stocké, mais ne servait à rien —
// on ne pouvait pas s'en servir pour se connecter. Le principe d'inscription ne demande que ce
// dont le compte a besoin aujourd'hui : l'identité, le contact et le consentement.
//
// `responsable_chantier` reste en SOURDINE : le rôle existe toujours en base et les API qui le
// concernent (désignation sur un contrat, constat de présence) sont intactes — il n'est
// simplement plus proposé ici, faute de modèle d'inscription propre. Il sera sollicité par API
// quand un client le désignera, ce qui est précisément la condition de son implication.
export default function SignupPage() {
  return (
    <div className="min-h-screen bg-[#FFF8F0] flex flex-col lg:flex-row">
      <AuthHero />
      <InscriptionScreens />
    </div>
  );
}

