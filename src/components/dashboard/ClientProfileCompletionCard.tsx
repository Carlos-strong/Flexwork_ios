"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// Bouton « Compléter mon profil » du tableau de bord client (2026-11-11) — remplace l'ancienne
// carte « Profil complété » (écran S5 des wireframes) pour garder la page minimale : il se pose
// dans l'en-tête, juste à gauche de « Créer une annonce ».
//
// Le pourcentage vient du serveur (GET /api/profile/client → src/lib/client-profile-
// completion.ts). Il n'est pas recalculé ici : la page /profile/client affiche le même
// barème, et deux calculs parallèles finiraient par diverger.
//
// Le bouton disparaît à 100 % — et reste absent pendant le chargement, pour ne pas clignoter
// chez un client dont le profil est déjà complet.

type Completion = { percent: number; missing: { key: string; label: string }[] };

export function ClientProfileCompletionButton() {
  const [completion, setCompletion] = useState<Completion | null>(null);

  useEffect(() => {
    fetch("/api/profile/client")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCompletion(d?.completion ?? null))
      .catch(() => setCompletion(null));
  }, []);

  if (!completion || completion.percent >= 100) return null;

  const missing = completion.missing.map((m) => m.label.toLowerCase()).join(", ");
  return (
    <Link
      href="/profile/client"
      title={missing ? `Il reste à renseigner : ${missing}.` : undefined}
      aria-label={`Compléter mon profil — profil complété à ${completion.percent} %`}
      className="inline-flex items-center gap-2 rounded-full px-4 py-3 text-[14px] font-bold bg-[#FFF6E3] text-[#B45309] border border-[#F5DFAE] hover:border-[#B45309] transition"
      style={{ textDecoration: "none" }}
    >
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
      Compléter mon profil
      <span className="rounded-full bg-white px-2 py-0.5 text-[12px] font-extrabold" aria-hidden>
        {completion.percent} %
      </span>
    </Link>
  );
}
