"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type CheckInEvent = { id: string; type: "arrivee" | "depart"; occurredAt: string; gpsLat: number | null; gpsLng: number | null };

// Pointage de présence — aligné sur formulaires-flexwork-tous-profils.html.
// Opt-in indépendant, GPS, purge automatique. La plateforme ne lit jamais ces données.
// Style harmonisé (2026-08-29) sur le système visuel de missions/[id]/page.tsx (Tailwind,
// palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
export default function CheckinPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const [optedIn, setOptedIn] = useState(false);
  const [active, setActive] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CheckInEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents() {
    const contractRes = await fetch(`/api/missions/${missionId}/contract`);
    if (!contractRes.ok) return;
    const contract = await contractRes.json();
    const isActive = Boolean(contract.clientOptedInCheckIn && contract.providerOptedInCheckIn);
    setActive(isActive);
    setOptedIn(Boolean(contract.clientOptedInCheckIn || contract.providerOptedInCheckIn));

    if (isActive) {
      const res = await fetch(`/api/missions/${missionId}/contract/checkin/events`);
      if (res.ok) setEvents((await res.json()).items);
    }
  }

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function handleOptIn() {
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/contract/checkin/opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optIn: true }),
    });
    if (res.ok) {
      setOptedIn(true);
      loadEvents();
    } else {
      setError("Échec de l'activation.");
    }
  }

  async function checkIn(type: "arrivee" | "depart") {
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/contract/checkin/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (res.ok) {
      loadEvents();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "checkin_tool_not_active" ? "Les deux parties doivent activer le pointage avant tout horodatage." : "Échec de l'enregistrement.");
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[520px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">Pointage</span>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold">Pointage de présence</h1>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] text-[11px] font-semibold">Opt-in</span>
          </div>

          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3 text-[12.5px] text-[#475569] leading-relaxed">
            <strong className="text-[#0f172a]">Outil optionnel.</strong> Ce pointage sert de preuve de présence entre vous et le client. Flexwork
            ne consulte, n&apos;agrège et n&apos;utilise jamais ces données pour une décision.
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}

          {active === false && !optedIn && (
            <div>
              <p className="mb-3 text-[13px] text-[#64748B] leading-relaxed">
                Le pointage n&apos;est pas encore actif — activez votre consentement. Il ne s&apos;activera réellement
                qu&apos;une fois l&apos;autre partie également consentante, sans aucune conséquence si elle refuse.
              </p>
              <button onClick={handleOptIn} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">
                Activer le pointage de mon côté
              </button>
            </div>
          )}

          {active === false && optedIn && (
            <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">
              En attente du consentement de l&apos;autre partie.
            </div>
          )}

          {active === true && (
            <>
              <div className="rounded-xl bg-[#f0fdf4] p-3.5">
                <strong className="text-[#166534] text-[13px]">✓ Outil activé</strong>
                <p className="text-[12.5px] text-[#64748B] mt-1">
                  Vous et le client avez tous deux consenti à l&apos;activation.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => checkIn("arrivee")} className="h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">
                  📍 Arrivée
                </button>
                <button onClick={() => checkIn("depart")} className="h-10 rounded-lg bg-[#0f172a] text-white text-[13px] font-semibold hover:bg-black transition-colors">
                  🏁 Départ
                </button>
              </div>

              <div>
                <h4 className="text-[13px] font-semibold mb-2">
                  Historique (visible uniquement par les deux parties)
                </h4>
                <div className="space-y-1.5">
                  {events.map((ev) => (
                    <div key={ev.id} className="text-[12.5px] text-[#64748B] px-2.5 py-2 bg-[#F8FAF9] border border-[#E2E8F0] rounded-lg">
                      <strong className="text-[#0f172a]">{ev.type === "arrivee" ? "Arrivée" : "Départ"}</strong> — {new Date(ev.occurredAt).toLocaleString("fr-FR")}
                      {ev.gpsLat && ev.gpsLng ? ` — GPS: ${ev.gpsLat}, ${ev.gpsLng}` : ""}
                    </div>
                  ))}
                  {events.length === 0 && <p className="text-[12.5px] text-[#94A3B8]">Aucun pointage enregistré.</p>}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[11.5px] text-[#92400E] leading-relaxed">
          <strong>Protection des données :</strong> Ces horodatages sont conservés pendant la durée de la mission + 7
          jours, puis purgés automatiquement. Aucun admin Flexwork n&apos;y a accès. Ils ne sont utilisés dans aucun
          score, classement ou décision de litige.
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
