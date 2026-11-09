"use client";

import { useState } from "react";

// Photos de profil déjà en échec de chargement (404, fichier disparu) — mémorisées au
// niveau module pour la durée de la page : un second <Avatar> (ex. navbar + bas de sidebar,
// qui affichent le même utilisateur) avec la même `src` ne relance pas une requête inutile
// et retombe immédiatement sur les initiales au lieu de dupliquer un 404 en console.
const failedAvatarSrcs = new Set<string>();

// Avatar réutilisé partout où une photo de profil doit apparaître (navbar, bas de sidebar,
// cartes de mission, cartes de candidature) : affiche la vraie photo si `src` est fourni et
// se charge, sinon retombe sur le cercle d'initiales existant — sans jamais casser
// l'affichage si l'utilisateur n'a pas encore de photo (cas le plus courant au lancement de
// cette fonctionnalité) ou si le fichier a disparu du stockage.
export function Avatar({
  src,
  initials,
  size = 32,
  gradient = "from-[#FF7A00] to-[#E8112D]",
  className = "",
}: {
  src?: string | null;
  initials: string;
  size?: number;
  gradient?: string;
  className?: string;
}) {
  // Un src déjà en échec (module) démarre directement sur les initiales.
  const [failed, setFailed] = useState(() => (src ? failedAvatarSrcs.has(src) : false));

  if (src && !failed) {
    return (
      // Source DYNAMIQUE authentifiée (/api/users/[id]/avatar) : next/image ferait récupérer
      // l'image par l'optimiseur côté serveur, sans les cookies du navigateur — la route
      // répondrait 401 (et le chemin de stockage, UUID compris, ne doit pas être exposé à un
      // tiers qui optimise). `next/image` vise les assets statiques, ce n'en est pas un.
      //
      // ⚠️ La directive doit être la ligne IMMÉDIATEMENT au-dessus du <img> : placée avant un
      // commentaire, elle ne désactive rien (elle visait la ligne du commentaire) et
      // l'avertissement revenait sans que rien ne l'explique.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={initials}
        onError={() => {
          if (src) failedAvatarSrcs.add(src);
          setFailed(true);
        }}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {initials}
    </div>
  );
}
