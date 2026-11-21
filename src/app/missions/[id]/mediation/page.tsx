"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Mediation = {
  id: string;
  reason: string;
  proposedResolution: string | null;
  clientAccepted: boolean | null;
  providerAccepted: boolean | null;
  outcome: string | null;
};

// Médiation facultative — aligné sur formulaires-flexwork-tous-profils.html.
// Ouverture, proposition admin, acceptation/refus. La plateforme ne tranche jamais.
// Style harmonisé (2026-08-29) sur le système visuel de missions/[id]/page.tsx (Tailwind,
// palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
export default function MediationPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [mediations, setMediations] = useState<Mediation[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/missions/${missionId}/mediation`);
    if (res.ok) setMediations((await res.json()).items);
  }, [missionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function openMediation(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/mediation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      setReason("");
      load();
    } else {
      setError("Échec de l'ouverture de la médiation.");
    }
  }

  async function respond(mediationId: string, accept: boolean) {
    const res = await fetch(`/api/admin/mediations/${mediationId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept }),
    });
    if (res.ok) {
      setResult(
        accept
          ? "Vous avez accepté la proposition. En attente de l'accord de l'autre partie..."
          : "Vous avez refusé la proposition. Les fonds restent gelés selon les conditions du PSP. Vous pouvez saisir la juridiction compétente."
      );
      load();
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-doc [--fw:720px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#6B6478] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#191224]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#191224] font-medium">Médiation</span>
        </div>

        <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold">Médiation facultative</h1>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FFF6E3] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">Phase 6</span>
          </div>

          <div className="rounded-xl border border-[#FDE68A] bg-[#FFF6E3] p-3 text-[12.5px] text-[#92400E] leading-relaxed">
            Flexwork peut proposer une médiation, mais <strong>ne tranche pas</strong>. Sa proposition n&apos;est pas
            opposable.
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[13px] text-[#B42318]">{error}</div>}

          {mediations.length === 0 && (
            <form onSubmit={openMediation} className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[#4A4258] mb-1">Motif de contestation</label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E7E2F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                />
              </div>
              <button type="submit" className="h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] transition-colors">
                Ouvrir une médiation
              </button>
            </form>
          )}

          {mediations.map((m) => {
            const isClient = userId !== undefined;
            const alreadyResponded = isClient ? m.clientAccepted !== null : m.providerAccepted !== null;
            return (
              <div key={m.id} className="space-y-3">
                <div className="rounded-xl bg-[#F6F5FA] border border-[#E7E2F0] p-4 text-[13px]">
                  <p><strong className="text-[#191224]">Motif :</strong> <span className="text-[#4A4258]">{m.reason}</span></p>
                  {m.outcome && <p className="mt-1"><strong className="text-[#191224]">Issue :</strong> <span className="text-[#4A4258]">{m.outcome}</span></p>}
                </div>

                {m.proposedResolution ? (
                  <div className="rounded-xl border border-[#FDE68A] bg-[#FFF6E3] p-4">
                    <h3 className="text-[13px] font-semibold mb-2">Proposition de résolution (Admin Médiation)</h3>
                    <p className="text-[13px] text-[#4A4258] leading-relaxed mb-3">{m.proposedResolution}</p>
                    <p className="text-[12px] text-[#9A93A8]">
                      Cette proposition est facultative. Chaque partie peut l&apos;accepter ou la refuser librement.
                    </p>
                    {!alreadyResponded && !m.outcome && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                        <button onClick={() => respond(m.id, true)} className="h-10 rounded-lg bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] transition-colors">
                          ✓ J&apos;accepte la proposition
                        </button>
                        <button onClick={() => respond(m.id, false)} className="h-10 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium hover:bg-[#F6F5FA] transition-colors">
                          ✗ Je refuse la proposition
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-[#6B6478]">En attente d&apos;une proposition de l&apos;Admin Médiation.</p>
                )}
              </div>
            );
          })}

          {result && <div className="rounded-xl border border-[#BFDBFE] bg-[#EAF1FF] p-3 text-[13px] text-[#1D4ED8]">{result}</div>}
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[#6B6478] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
