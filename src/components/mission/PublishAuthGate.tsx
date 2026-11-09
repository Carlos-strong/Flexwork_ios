"use client";

// Porte d'entrée de la publication d'une mission pour un visiteur NON connecté (2026-11-09).
//
// Avant, /missions/new s'ouvrait à tout le monde : le visiteur remplissait les quatre étapes,
// puis la publication échouait (401) et tout était à refaire. Désormais, on lui demande d'abord
// son email ou son téléphone, et on vérifie s'il a déjà un compte :
//   - compte existant → code de connexion envoyé, /verify-otp, puis retour sur CETTE page
//     (même métier pré-rempli, même prestataire invité : toute l'URL suit en `callbackUrl`) ;
//   - aucun compte    → inscription, l'email déjà saisi, puis code, /bienvenue (usage
//     « client » présélectionné) et retour ici pour publier.
//
// Le KYC ne bloque pas la publication (src/lib/kyc-policy.ts) : un compte tout neuf publie
// tout de suite ; la vérification d'identité est exigée plus tard, pour retenir un prestataire,
// signer et verser les fonds.
//
// L'existence du compte est révélée par /api/auth/login/request-otp (404 `account_not_found`),
// déjà le cas sur /signin depuis 2026-11-07 : aucune information nouvelle n'est exposée, et le
// rate-limit par identifiant et par IP de cette route s'applique.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Shield, UserCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { withCallbackUrl } from "@/lib/safe-callback";

export function PublishAuthGate() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Lus après le montage : l'URL n'existe pas pendant le rendu serveur.
  const [destination, setDestination] = useState("/missions/new");
  const [invitedName, setInvitedName] = useState<string | null>(null);

  // Filet de sécurité : si cette porte est resservie depuis le cache alors que la session est
  // ouverte (retour arrière après connexion…), on redemande la page au serveur → le tunnel.
  const { status } = useSession();
  useEffect(() => {
    if (status === "authenticated") router.refresh();
  }, [status, router]);

  useEffect(() => {
    setDestination(window.location.pathname + window.location.search);
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("pour")) setInvitedName(sp.get("nom")?.slice(0, 80) || null);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const raw = identifier.trim();
    const value = raw.includes("@") ? raw.toLowerCase() : raw.replace(/\s/g, "");
    if (value.length < 3) {
      setError("Saisissez votre adresse email ou votre numéro de téléphone.");
      return;
    }
    if (!value.includes("@") && !value.startsWith("+")) {
      setError("Saisissez le numéro avec l'indicatif du pays, par exemple +229 97 00 00 00.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/auth/login/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: value }),
    }).catch(() => null);

    if (res?.ok) {
      // Compte existant : le code est parti, on le saisit puis on revient ici.
      router.push(withCallbackUrl(`/verify-otp?identifier=${encodeURIComponent(value)}&purpose=login`, destination));
      return;
    }

    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.status === 404 && data.error === "account_not_found") {
      // Pas encore de compte : inscription, l'email déjà saisi.
      const signup = value.includes("@") ? `/signup?email=${encodeURIComponent(value)}` : "/signup?nouveau=1";
      router.push(withCallbackUrl(signup, destination));
      return;
    }

    setSubmitting(false);
    setError(
      data.error === "too_many_requests"
        ? "Trop de demandes — réessayez dans quelques minutes."
        : data.error === "account_inactive"
          ? "Ce compte est désactivé. Contactez le support."
          : data.error === "otp_send_failed"
            ? "Le code n'a pas pu être envoyé. Réessayez."
            : "Une erreur est survenue. Réessayez.",
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAF9] flex items-start md:items-center justify-center p-4 pt-8 md:p-8">
      <div className="w-full max-w-[480px]">
        <Link href="/" className="inline-flex items-center gap-2 mb-6">
          <span className="w-9 h-9 rounded-xl bg-[#FF7A00] flex items-center justify-center text-white font-extrabold text-[14px]">FW</span>
          <span className="text-[#0A1931] font-extrabold text-[18px] tracking-tight">FlexWork</span>
        </Link>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 md:p-8">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E6F4EE] text-[#008751] text-[11px] font-semibold">
            <UserCheck className="w-3.5 h-3.5" /> Étape préalable
          </span>
          <h1 className="mt-3 text-[22px] md:text-[24px] font-bold text-[#0A1931] leading-tight">Publier une mission</h1>
          <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed">
            {invitedName ? (
              <>
                Pour proposer votre mission à <span className="font-semibold text-[#0A1931]">{invitedName}</span>, identifiez-vous.
              </>
            ) : (
              <>Pour publier votre mission, identifiez-vous.</>
            )}{" "}
            Si vous avez déjà un compte, vous recevrez un code de connexion ; sinon, vous créerez votre compte en deux étapes.
          </p>

          {error && (
            <div role="alert" className="mt-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <label htmlFor="publish-identifier" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">
                Email ou numéro de téléphone
              </label>
              <input
                id="publish-identifier"
                name="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
                placeholder="koffi@exemple.bj ou +229 97 00 00 00"
                className="w-full h-11 rounded-xl border border-[#E2E8F0] px-3.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl bg-[#FF7A00] text-white text-[14px] font-bold hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? "Vérification…" : (
                <>
                  Continuer <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12.5px] text-amber-900 leading-relaxed">
            <Shield className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Nouveau sur FlexWork ? Vous pourrez publier votre mission dès la création du compte. La vérification
              d&apos;identité (KYC) sera demandée ensuite pour retenir un prestataire, signer le contrat et verser les fonds.
            </span>
          </div>

          <p className="mt-5 text-center text-[13px] text-zinc-500">
            Pas encore de compte ?{" "}
            <Link href={withCallbackUrl("/signup?nouveau=1", destination)} className="font-semibold text-[#008751] hover:underline">
              Créer un compte
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
