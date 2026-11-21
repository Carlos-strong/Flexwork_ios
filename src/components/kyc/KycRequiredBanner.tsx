"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

// Bandeau « identité à vérifier » en tête de page (2026-11-10), pour les étapes qui exigent un
// KYC vérifié (src/lib/kyc-policy.ts) — ici, retenir un prestataire. Affiché D'EMBLÉE quand le
// compte n'est pas vérifié, plutôt que de laisser le client cliquer « Accepter » pour découvrir
// un refus sous le bouton.
//
// Les boutons d'action (AcceptFixedPrice, ValidateDevis) signalent un 403 KYC par l'événement
// KYC_REQUIRED_EVENT : si un bandeau est présent sur la page, il l'intercepte (preventDefault),
// remonte en vue et se met en évidence — le bouton n'affiche alors rien de plus. Sans bandeau
// sur la page, le bouton garde son message sous lui.

export const KYC_REQUIRED_EVENT = "flexwork:kyc-required";

/** Signale un refus KYC ; `true` si un bandeau de la page l'a pris en charge. */
export function announceKycRequired(): boolean {
  if (typeof window === "undefined") return false;
  return !window.dispatchEvent(new CustomEvent(KYC_REQUIRED_EVENT, { cancelable: true }));
}

type Status = { kycStatus: "en_attente" | "verifie" | "rejete"; documentsSubmitted?: boolean };

export function KycRequiredBanner({
  title = "Votre identité doit être vérifiée avant de retenir un prestataire et de conclure un contrat.",
  enabled = true,
}: {
  title?: string;
  /** Faux quand l'étape n'est plus d'actualité (prestataire déjà retenu…) : rien n'est affiché. */
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pulse, setPulse] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/kyc/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => alive && setStatus(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);

  const visible = enabled && !!status && status.kycStatus !== "verifie";

  useEffect(() => {
    if (!visible) return;
    function onRequired(e: Event) {
      e.preventDefault();
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPulse(true);
      window.setTimeout(() => setPulse(false), 1600);
    }
    window.addEventListener(KYC_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(KYC_REQUIRED_EVENT, onRequired);
  }, [visible]);

  if (!visible || !status) return null;

  const rejected = status.kycStatus === "rejete";
  const inReview = !rejected && status.documentsSubmitted;
  const detail = rejected
    ? "Votre précédente vérification a été refusée : renvoyez vos justificatifs pour pouvoir accepter une candidature."
    : inReview
      ? "Vos justificatifs sont en cours d'examen : vous pourrez accepter dès leur validation."
      : "Envoyez vos justificatifs d'identité : vous pourrez accepter une candidature dès leur validation.";

  return (
    <div
      ref={ref}
      role="status"
      className={`scroll-mt-4 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4 transition-shadow ${
        rejected ? "border-[#FECACA] bg-[#FEECEB]" : "border-[#FDE68A] bg-[#FFF6E3]"
      } ${pulse ? "ring-4 ring-[#F59E0B]/40" : ""}`}
    >
      <span
        aria-hidden
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${rejected ? "bg-[#FEECEB] text-[#B42318]" : "bg-[#FFF6E3] text-[#B45309]"}`}
      >
        <ShieldAlert className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug text-[#191224]">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-[#4A4258]">{detail}</p>
      </div>
      {!inReview && (
        <Link
          href="/kyc"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-[#191224] px-4 text-[13px] font-semibold text-white hover:bg-[#191224]"
          style={{ textDecoration: "none" }}
        >
          {rejected ? "Renvoyer mes justificatifs" : "Vérifier mon identité"}
        </Link>
      )}
      {inReview && (
        <span className="inline-flex h-8 shrink-0 items-center self-start rounded-full border border-[#FDE68A] bg-white px-3 text-[12px] font-semibold text-[#B45309] sm:self-center">
          En cours d&apos;examen
        </span>
      )}
    </div>
  );
}
