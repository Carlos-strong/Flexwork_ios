"use client";

// Récapitulatif du choix — maquette (2026-11-11), ouvert par « Choisir ce prestataire » sur la
// page Candidatures reçues. Le client relit ce qu'il s'apprête à retenir, puis « Passer au
// contrat » effectue le VRAI choix :
//   - prix fixe / au temps : POST .../proposals/[proposalId]/accept ;
//   - devis               : POST .../proposals/[proposalId]/devis/validate ;
// exactement les appels d'AcceptFixedPrice / ValidateDevis (src/components/devis/devis-panel.tsx),
// avec la même suite : l'engagement créé pour ce prestataire s'ouvre sur son étape contrat.
//
// Ce que dit le pied de page est ce que fait le serveur (src/lib/accept-proposal.ts) : retenir
// un prestataire ne ferme pas l'annonce. Les autres candidatures restent ouvertes jusqu'à la
// date limite, et celles qui ne sont pas retenues sont refusées à la clôture — on n'écrit donc
// « Non retenu » que si ce choix remplit la dernière place.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { authorDisplayName, type DevisProposalPayload } from "@/components/devis/types";
import { ActionFailureNotice, readActionFailure, type ActionFailure } from "@/components/devis/devis-panel";

const fmt = (n: number, currency: string) => `${Math.round(n).toLocaleString("fr-FR")} ${currency === "XOF" ? "FCFA" : currency}`;

type Props = {
  missionId: string;
  proposal: DevisProposalPayload;
  others: DevisProposalPayload[];
  isQuote: boolean;
  currency: string;
  missionBudget: number | null;
  delayLabel: string;
  price: number | null;
  avatarGradient: string;
  /** Places encore libres sur l'annonce AVANT ce choix. */
  placesLeft: number;
  onClose: () => void;
  onDone: () => void;
};

export function ChoiceRecap({ missionId, proposal: p, others, isQuote, currency, missionBudget, delayLabel, price, avatarGradient, placesLeft, onClose, onDone }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const name = authorDisplayName(p.provider);
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
  const lastPlace = placesLeft <= 1;
  // Une candidature à prix fixe est stockée comme un devis d'UNE ligne (le message tient lieu de
  // libellé, POST /api/missions/[id]/proposals) : ce n'est pas un découpage en jalons. Seuls un
  // devis, ou un prix fixe réellement découpé en plusieurs lignes, en affichent.
  const lines = p.devisData?.lineItems ?? [];
  const jalons = isQuote || lines.length > 1 ? lines : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function confirm() {
    setPending(true);
    setFailure(null);
    const url = isQuote
      ? `/api/missions/${missionId}/proposals/${p.id}/devis/validate`
      : `/api/missions/${missionId}/proposals/${p.id}/accept`;
    const res = await fetch(url, { method: "POST" });
    if (res.ok) {
      const { engagementId } = (await res.json().catch(() => ({}))) as { engagementId?: string };
      setDone(true);
      onDone();
      setTimeout(() => router.push(`/missions/${engagementId ?? missionId}/contract`), 1200);
      return;
    }
    setPending(false);
    setFailure(await readActionFailure(res, isQuote ? "La validation du devis a échoué." : "L'acceptation a échoué. Réessayez."));
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="choice-recap-title">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !pending && onClose()} />
      <div className="relative mx-auto my-8 w-[calc(100%-32px)] max-w-[760px] space-y-3 pop">
        <section className="rounded-3xl border border-[#E7E2F0] bg-white p-6 md:p-7 text-center">
          <div className="flex justify-center">
            <Avatar src={p.provider.avatarPath ? `/api/users/${p.provider.id}/avatar` : null} initials={initials} size={64} gradient={avatarGradient} />
          </div>
          <p className="kicker mt-3">Récapitulatif du choix</p>
          <h2 id="choice-recap-title" className="font-display font-extrabold text-[#191224] mt-1" style={{ fontSize: "clamp(24px, 3.4vw, 32px)" }}>
            Vous avez choisi {name}
          </h2>
          <p className="mt-1 text-[15px] text-[#6B6478]">
            {p.averageRating != null ? `${p.averageRating.toFixed(1)}/5` : "Pas encore noté"} • {p.missionsCompleted ?? 0} mission{(p.missionsCompleted ?? 0) > 1 ? "s" : ""} • {delayLabel}
          </p>

          <div className="mt-5 grid sm:grid-cols-3 gap-2 text-left">
            {[
              { l: isQuote ? "Devis retenu (TTC)" : "Prix retenu", v: price != null ? fmt(price, currency) : "—" },
              { l: "Budget mission", v: missionBudget ? fmt(missionBudget, currency) : "Sur devis" },
              { l: "Délai", v: delayLabel },
            ].map((t) => (
              <div key={t.l} className="rounded-2xl bg-[#EFEAF8] px-4 py-3">
                <p className="text-[13px] text-[#6B6478]">{t.l}</p>
                <p className="font-extrabold text-[16px] text-[#191224]">{t.v}</p>
              </div>
            ))}
          </div>

          {/* Jalons : ceux du devis du prestataire. Une candidature à prix fixe n'en porte pas —
              le découpage, s'il y en a un, se fixe au contrat. */}
          {jalons.length > 0 ? (
            <ol className="mt-3 space-y-2 text-left">
              {jalons.map((j, i) => (
                <li key={i} className="rounded-2xl border border-[#E7E2F0] px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-[15px] text-[#191224]">Jalon {i + 1} — {j.description}</p>
                    <p className="text-[13px] text-[#6B6478]">
                      {j.quantity} {j.unit} × {fmt(j.unitPrice, currency)}{j.echeance ? ` • ${j.echeance}` : ""}
                    </p>
                  </div>
                  <span className="font-extrabold text-[15px] text-[#191224] whitespace-nowrap">{fmt(j.total, currency)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 rounded-2xl border border-[#E7E2F0] px-4 py-3 text-left text-[14px] text-[#6B6478]">
              Prix proposé sans découpage en jalons : le calendrier de paiement sera fixé au contrat.
            </p>
          )}

          {p.message && (
            <p className="mt-3 rounded-2xl bg-[#F6F5FA] px-4 py-3 text-left text-[14px] text-[#191224] whitespace-pre-wrap">« {p.message} »</p>
          )}

          {failure && <div className="text-left"><ActionFailureNotice failure={failure} /></div>}
          {done && (
            <p role="status" className="mt-3 rounded-2xl bg-[#E7F7EF] px-4 py-3 text-[14px] font-semibold text-[#047857]">
              {name} est retenu(e) — ouverture de l&apos;étape contrat…
            </p>
          )}

          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="w-full sm:w-auto px-5 py-3 rounded-full border border-[#E7E2F0] text-[15px] font-bold text-[#191224] hover:border-[#4C1D95] disabled:opacity-40"
            >
              Changer de prestataire
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#4C1D95] text-white text-[15px] font-bold hover:bg-[#3B1578] disabled:opacity-60"
            >
              {pending ? "Confirmation…" : <>Passer au contrat <ArrowRight className="w-4 h-4" aria-hidden /></>}
            </button>
          </div>
          <p className="mt-3 text-[12px] text-[#6B6478]">
            {others.length === 0
              ? "Ce prestataire ouvrira avec vous l'étape contrat."
              : lastPlace
                ? "Une fois confirmé, les autres candidats ne pourront plus être retenus : ils passeront en « Non retenu » à la clôture de l'annonce."
                : `Une fois confirmé, il vous restera ${placesLeft - 1} place${placesLeft - 1 > 1 ? "s" : ""} : les autres candidats restent en lice jusqu'à la date limite.`}
          </p>
        </section>

        {others.length > 0 && (
          <ul className="grid sm:grid-cols-2 gap-3">
            {others.map((o) => {
              const op = isQuote ? o.devisData?.totalTTC : o.montant;
              return (
                <li key={o.id} className="rounded-2xl border border-[#E7E2F0] bg-white px-4 py-3 flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[15px]">
                    <b className="text-[#191224]">{authorDisplayName(o.provider)}</b>
                    {op != null && <span className="text-[13px] text-[#6B6478]"> • {fmt(op, currency)}</span>}
                  </span>
                  <span className={`shrink-0 text-[12px] font-bold px-2.5 py-1 rounded-full ${lastPlace ? "bg-[#FEECEB] text-[#B42318]" : "bg-[#EFEAF8] text-[#6B6478]"}`}>
                    {lastPlace ? "Non retenu" : "Toujours en lice"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
