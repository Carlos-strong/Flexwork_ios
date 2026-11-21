"use client";

import { useCallback, useEffect, useState } from "react";
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

  const loadEvents = useCallback(async () => {
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
  }, [missionId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-form [--fw:520px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#6B6478] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#191224]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#191224] font-medium">Pointage</span>
        </div>

        <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold">Pointage de présence</h1>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#EFEAF8] text-[#6B6478] text-[11px] font-semibold">Opt-in</span>
          </div>

          <div className="rounded-xl border border-[#E7E2F0] bg-[#F6F5FA] p-3 text-[12.5px] text-[#4A4258] leading-relaxed">
            <strong className="text-[#191224]">Outil optionnel.</strong> Ce pointage sert de preuve de présence entre vous et le client. Flexwork
            ne consulte, n&apos;agrège et n&apos;utilise jamais ces données pour une décision.
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[13px] text-[#B42318]">{error}</div>}

          {active === false && !optedIn && (
            <div>
              <p className="mb-3 text-[13px] text-[#6B6478] leading-relaxed">
                Le pointage n&apos;est pas encore actif — activez votre consentement. Il ne s&apos;activera réellement
                qu&apos;une fois l&apos;autre partie également consentante, sans aucune conséquence si elle refuse.
              </p>
              <button onClick={handleOptIn} className="h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] transition-colors">
                Activer le pointage de mon côté
              </button>
            </div>
          )}

          {active === false && optedIn && (
            <div className="rounded-xl border border-[#FDE68A] bg-[#FFF6E3] p-3 text-[13px] text-[#92400E]">
              En attente du consentement de l&apos;autre partie.
            </div>
          )}

          {active === true && (
            <>
              <div className="rounded-xl bg-[#E7F7EF] p-3.5">
                <strong className="text-[#047857] text-[13px]">✓ Outil activé</strong>
                <p className="text-[12.5px] text-[#6B6478] mt-1">
                  Vous et le client avez tous deux consenti à l&apos;activation.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => checkIn("arrivee")} className="h-10 rounded-lg bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] transition-colors">
                  📍 Arrivée
                </button>
                <button onClick={() => checkIn("depart")} className="h-10 rounded-lg bg-[#191224] text-white text-[13px] font-semibold hover:bg-black transition-colors">
                  🏁 Départ
                </button>
              </div>

              <div>
                <h4 className="text-[13px] font-semibold mb-2">
                  Historique (visible uniquement par les deux parties)
                </h4>
                <div className="space-y-1.5">
                  {events.map((ev) => (
                    <div key={ev.id} className="text-[12.5px] text-[#6B6478] px-2.5 py-2 bg-[#F6F5FA] border border-[#E7E2F0] rounded-lg">
                      <strong className="text-[#191224]">{ev.type === "arrivee" ? "Arrivée" : "Départ"}</strong> — {new Date(ev.occurredAt).toLocaleString("fr-FR")}
                      {ev.gpsLat && ev.gpsLng ? ` — GPS: ${ev.gpsLat}, ${ev.gpsLng}` : ""}
                    </div>
                  ))}
                  {events.length === 0 && <p className="text-[12.5px] text-[#9A93A8]">Aucun pointage enregistré.</p>}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-[#FDE68A] bg-[#FFF6E3] p-3 text-[11.5px] text-[#92400E] leading-relaxed">
          <strong>Protection des données :</strong> Ces horodatages sont conservés pendant la durée de la mission + 7
          jours, puis purgés automatiquement. Aucun admin Flexwork n&apos;y a accès. Ils ne sont utilisés dans aucun
          score, classement ou décision de litige.
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[#6B6478] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
