"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

// Confirmation affichée en arrivant sur « Mes missions » juste après une publication
// (?publiee=<id>, 2026-10-06) : depuis le formulaire de mission, ou depuis « Publier
// maintenant » sur le tableau de bord. À rendre sous <Suspense> (useSearchParams).
export function PublishedNotice() {
  const id = useSearchParams().get("publiee");
  const [closed, setClosed] = useState(false);
  if (!id || closed) return null;

  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-[16px] border border-[#BBF7D0] bg-[#F0FDF4] p-4">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#15803D]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[#14532D]">Mission publiée avec succès</p>
        <p className="mt-0.5 text-[13px] text-[#166534]">
          Elle est visible par les prestataires du métier, qui ont été notifiés et peuvent candidater.{" "}
          <Link href={`/missions/${id}`} className="font-semibold underline">
            Voir la mission
          </Link>
        </p>
      </div>
      <button type="button" onClick={() => setClosed(true)} aria-label="Fermer" className="rounded-full p-1 text-[#166534] transition hover:bg-[#DCFCE7]">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
