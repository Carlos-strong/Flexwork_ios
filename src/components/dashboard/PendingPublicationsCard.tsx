"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, ShieldCheck, Send } from "lucide-react";

// Carte « brouillons de missions » du tableau de bord client (2026-10-06) — le SEUL endroit
// où un brouillon apparaît : la gestion des missions ne montre que des missions publiées.
//
//  - Arrivée depuis le formulaire de mission (?publication=kyc) : le client a cliqué « Publier »
//    sans identité vérifiée. On lui dit pourquoi la mission n'est pas en ligne, que rien n'est
//    perdu, et comment débloquer — vérifier son identité.
//  - Ensuite, tant qu'il reste des missions dont il a demandé la publication : identité non
//    vérifiée → rappel ; identité vérifiée → « Publier maintenant », en un clic, sans ressaisie
//    (POST /api/missions/[id]/publish, qui revérifie toutes les conditions de publication).
//
// À rendre sous <Suspense> : useSearchParams l'exige dans l'App Router.

// `publicationRequestedAt` : le client a cliqué « Publier » avant que son identité soit
// vérifiée ; `null` : brouillon enregistré volontairement.
type Pending = { id: string; titre: string; domaine: string; publicationRequestedAt: string | null; createdAt: string };
type State = { kycVerified: boolean; kycStatus: string | null; missions: Pending[] };

const PUBLISH_ERRORS: Record<string, string> = {
  kyc_not_verified: "Votre identité doit être vérifiée avant de publier une mission.",
  budget_required_to_publish: "Cette mission n'a pas de budget : elle ne peut pas être publiée en l'état.",
  time_terms_required_to_publish: "Le tarif et la quantité maximale sont requis pour publier une mission au temps.",
  financing_mode_unavailable: "Le mode de financement choisi n'est pas encore disponible à la publication.",
  mission_not_draft: "Cette mission a déjà été publiée.",
};

export function PendingPublicationsCard() {
  const router = useRouter();
  const params = useSearchParams();
  const fromWizard = params.get("publication") === "kyc";
  const [state, setState] = useState<State | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/missions/pending-publication")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function publish(id: string) {
    setError(null);
    setPublishing(id);
    const res = await fetch(`/api/missions/${id}/publish`, { method: "POST" });
    if (res.ok) {
      router.push(`/client/missions?publiee=${encodeURIComponent(id)}`);
      return;
    }
    setPublishing(null);
    const body = await res.json().catch(() => ({}));
    setError(
      body.error === "financing_mode_unavailable" && body.reason
        ? body.reason
        : (PUBLISH_ERRORS[body.error] ?? "La publication a échoué. Réessayez dans un instant."),
    );
    load();
  }

  const missions = state?.missions ?? [];
  if (!fromWizard && missions.length === 0) return null;
  const verified = state?.kycVerified === true;
  const anyRequested = fromWizard || missions.some((m) => m.publicationRequestedAt);
  // Trois tons : identité à vérifier (ambre), publication demandée et désormais possible
  // (vert), simples brouillons d'un compte vérifié (neutre).
  const tone = !verified ? "amber" : anyRequested ? "green" : "neutral";
  const TONES = {
    amber: { box: "border-[#FDE68A] bg-[#FFFBEB]", icon: "bg-[#FEF3C7] text-[#B45309]", title: "text-[#78350F]", text: "text-[#92400E]" },
    green: { box: "border-[#BBF7D0] bg-[#F0FDF4]", icon: "bg-[#DCFCE7] text-[#15803D]", title: "text-[#14532D]", text: "text-[#166534]" },
    neutral: { box: "border-gray-100 bg-white", icon: "bg-gray-100 text-zinc-600", title: "text-[#0A1931]", text: "text-zinc-500" },
  }[tone];

  return (
    <div role="status" className={`mb-6 rounded-[16px] border p-4 md:p-5 ${TONES.box}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${TONES.icon}`}>
          {verified ? <ShieldCheck className="h-5 w-5" aria-hidden /> : <ShieldAlert className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          {!verified ? (
            <>
              <p className={`text-[14px] font-semibold ${TONES.title}`}>Votre identité doit être vérifiée avant de publier une mission.</p>
              <p className={`mt-0.5 text-[13px] ${TONES.text}`}>
                {anyRequested
                  ? "Votre mission est enregistrée en brouillon : rien n'est perdu. Dès la vérification, vous pourrez la publier en un clic depuis ce tableau de bord."
                  : "Vos brouillons ne sont pas visibles des prestataires. Ils pourront être publiés en un clic dès la vérification."}
              </p>
            </>
          ) : anyRequested ? (
            <>
              <p className={`text-[14px] font-semibold ${TONES.title}`}>Votre identité est vérifiée — vos missions sont prêtes à être publiées</p>
              <p className={`mt-0.5 text-[13px] ${TONES.text}`}>Publiez-les en un clic : rien n&apos;est à ressaisir.</p>
            </>
          ) : (
            <>
              <p className={`text-[14px] font-semibold ${TONES.title}`}>Brouillons de missions</p>
              <p className={`mt-0.5 text-[13px] ${TONES.text}`}>Non visibles des prestataires tant qu&apos;ils ne sont pas publiés.</p>
            </>
          )}

          {missions.length > 0 && (
            <ul className="mt-3 divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5 bg-white">
              {missions.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/missions/${m.id}`} className="block truncate text-[13px] font-semibold text-[#0A1931] hover:underline">
                      {m.titre}
                    </Link>
                    <p className="text-[12px] text-zinc-500">
                      {m.domaine} ·{" "}
                      {m.publicationRequestedAt
                        ? `publication demandée le ${new Date(m.publicationRequestedAt).toLocaleDateString("fr-FR")}`
                        : `brouillon du ${new Date(m.createdAt).toLocaleDateString("fr-FR")}`}
                    </p>
                  </div>
                  {verified ? (
                    <button
                      type="button"
                      onClick={() => publish(m.id)}
                      disabled={publishing !== null}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#008751] px-4 text-[13px] font-semibold text-white transition hover:bg-[#006e43] disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      {publishing === m.id ? "Publication…" : "Publier maintenant"}
                    </button>
                  ) : (
                    <span className="inline-flex h-7 shrink-0 items-center self-start rounded-full bg-[#FEF3C7] px-3 text-[11px] font-semibold text-[#92400E] sm:self-auto">
                      En attente de vérification
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-3 text-[13px] font-medium text-red-700">{error}</p>}

          {!verified && (
            <Link
              href="/kyc"
              className="mt-3 inline-flex h-9 items-center rounded-full bg-[#0A1931] px-4 text-[13px] font-semibold text-white transition hover:bg-[#13284a]"
              style={{ textDecoration: "none" }}
            >
              {state?.kycStatus === "en_attente" ? "Suivre ma vérification" : "Vérifier mon identité"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
