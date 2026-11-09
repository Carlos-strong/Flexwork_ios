"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { safeCallbackUrl, withCallbackUrl } from "@/lib/safe-callback";
import { signIn, getSession } from "next-auth/react";
import Link from "next/link";
import { KeyRound, ArrowRight, Info, Shield, Users, CreditCard, Mail, RefreshCw, PencilLine } from "lucide-react";
import { ROLE_DASHBOARD } from "@/lib/role-dashboard";
import { otpErrorView, otpScreenError, resendMessage, type OtpErrorView } from "@/lib/otp-messages";

// Vérification OTP — étape commune signup/login.
// Aligné sur formulaires-flexwork-tous-profils.html.
// Après signup → /kyc, après login → dashboard du rôle, résolu via getSession().
function VerifyOtpForm() {
  const params = useSearchParams();
  const router = useRouter();
  const identifier = params.get("identifier") ?? "";
  // Seuls deux usages existent ; toute autre valeur d'URL retombe sur la connexion.
  const purpose: "login" | "signup" = params.get("purpose") === "signup" ? "signup" : "login";
  // Inscription dont l'email de code n'est pas parti (/api/auth/signup → otpSent: false).
  const notSent = params.get("sent") === "0";

  const [code, setCode] = useState("");
  const [error, setError] = useState<OtpErrorView | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Renvoi du code (connexion) : compte à rebours anti-spam côté client, miroir du
  // rate-limit serveur (/api/auth/login/request-otp). Démarre à 30s — le code vient d'être
  // envoyé depuis /signin — puis « Renvoyer un code » se réactive à 0.
  const [resendIn, setResendIn] = useState(notSent ? 0 : 30);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<{ text: string; ok: boolean } | null>(
    notSent ? { text: "Le code n'a pas pu être envoyé. Cliquez sur « Renvoyer par email ».", ok: false } : null,
  );

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Soumission centralisée : utilisée par le formulaire ET par l'auto-submit à 6 chiffres.
  async function submitCode(value: string) {
    setError(null);
    setSubmitting(true);

    // L'id du provider est "otp" (src/auth.ts) — "credentials" est le type générique,
    // pas l'id ; signIn("credentials", …) cible un provider inexistant et NextAuth
    // renvoie vers /signin avec un callbackUrl pointant sur cette page elle-même.
    //
    // Erreurs PRÉCISES (2026-11-09) : le motif du refus arrive dans `result.code`
    // (src/auth.ts, OtpSigninError) — code faux, expiré, bloqué, compte désactivé… — et une
    // panne réseau n'est plus une promesse rejetée qui laissait le bouton sur « Vérification... ».
    let result: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      result = await signIn("otp", { identifier, code: value, purpose, redirect: false });
    } catch {
      setSubmitting(false);
      setError(otpErrorView("network", purpose));
      return;
    }

    setSubmitting(false);
    if (!result || result.error) {
      const view = otpErrorView(otpScreenError(result), purpose);
      setError(view);
      if (view.resendNow) setResendIn(0);
      // Le code refusé est effacé : on ressaisit dans des cases vides, depuis la première.
      setCode("");
      inputsRef.current[0]?.focus();
      return;
    }

    // Session ouverte : le cache du routeur client garde les pages rendues SANS session (porte
    // d'identification de /missions/new, 2026-11-09) — on l'invalide avant d'y retourner.
    router.refresh();

    if (purpose === "signup") {
      // Écran P4 — et non plus l'assistant KYC (2026-09-23, décision « Option C »).
      //
      // Le compte vient de s'ouvrir en CLIENT : P4 est exactement l'écran qui le dit
      // (« Vous êtes actuellement CLIENT par défaut ») et qui offre la seule action
      // explicite possible — ouvrir l'espace prestataire, ou continuer en client.
      //
      // L'ancien envoi direct vers /kyc faisait de la vérification d'identité une porte
      // d'entrée obligatoire, ce que le modèle refuse (§9 : le KYC ne conditionne QUE des
      // actions précises — publier, candidater). Il transformait aussi un écran de
      // déclaration en péage : l'utilisateur n'avait rien choisi qu'il puisse comprendre.
      //
      // La destination d'origine (bouton « Candidater » / « Commander » de l'accueil) suit :
      // /bienvenue y renvoie une fois l'usage choisi.
      router.push(withCallbackUrl("/bienvenue", params.get("callbackUrl")));
      return;
    }

    // Mesuré en réel (curl, à chaud, plusieurs passes) : GET /api/auth/session
    // (~170-220ms) est systématiquement plus rapide que de naviguer vers /dashboard, un
    // Server Component qui ne fait qu'auth()+redirect() (~245-290ms) — même en lisant le
    // JWT localement, cette page traverse tout le pipeline de résolution de route/RSC de
    // Next (résolution de module, correspondance de layout), plus lourd qu'un handler
    // d'API minimal. Et ça évite une double navigation visible (/dashboard puis
    // /dashboard/{role}) pour une seule transition directe vers l'URL finale.
    // Retour à la page d'origine (?callbackUrl=, relayé par /signin) avant le tableau de bord.
    const callbackUrl = safeCallbackUrl(params.get("callbackUrl"));
    if (callbackUrl) {
      router.push(callbackUrl);
      return;
    }

    const session = await getSession().catch(() => null);
    // Les admins ont role="client" en DB mais isAdmin=true — priorité à isAdmin, sinon
    // ils atterrissent sur /dashboard/client comme n'importe quel client (même correctif
    // que src/app/dashboard/page.tsx, dupliqué ici car cette page évite ce relais serveur).
    if (session?.user?.isAdmin) {
      router.push("/admin");
      return;
    }
    const role = session?.user?.role;
    router.push(role ? ROLE_DASHBOARD[role] ?? "/client/dashboard" : "/client/dashboard");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitCode(code);
  }

  // Saisie en SIX cases (2026-09-23), une par chiffre. La case unique précédente affichait
  // « 123456 » en `tracking-[0.5em]` : il fallait relire mentalement ce qu'on venait de taper,
  // et se tromper d'un chiffre ne se voyait qu'au rejet du code. Six cases se relisent d'un
  // coup d'œil, et la progression est automatique — plus besoin de viser la case suivante.
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Point d'entrée unique de la saisie : normalise, borne à 6, avance le focus, et déclenche
  // la vérification dès que les six chiffres sont là. Utilisé par la frappe, le collage et
  // l'effacement, pour qu'aucun chemin ne puisse produire un état incohérent.
  function commitDigits(next: string) {
    setCode(next);
    if (next.length === 6 && !submitting) {
      void submitCode(next);
      return;
    }
    inputsRef.current[Math.min(next.length, 5)]?.focus();
  }

  function handleDigitChange(index: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    if (typed.length === 0) {
      // Effacement : on retire le chiffre de cette case, sans toucher aux suivants.
      setCode((c) => c.slice(0, index) + c.slice(index + 1));
      return;
    }
    commitDigits((code.slice(0, index) + typed + code.slice(index + typed.length)).slice(0, 6));
  }

  function handleDigitKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // Retour arrière sur une case vide : reculer d'une case, comportement attendu d'un code.
    if (e.key === "Backspace" && !code[index] && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) inputsRef.current[index + 1]?.focus();
  }

  // Collage d'un code reçu par email : les six chiffres arrivent d'un bloc, on ne force pas
  // l'utilisateur à les retaper case par case.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    commitDigits(pasted);
  }

  async function handleResend() {
    if (resending || resendIn > 0) return;
    setResending(true);
    setResendMsg(null);
    let outcome: { ok: true } | { ok: false; error?: string | null };
    try {
      const res = await fetch("/api/auth/login/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `purpose` transmis (2026-09-23) : sans lui, un renvoi en inscription créait un code
        // `login` que la vérification (`purpose=signup`, src/auth.ts) ne trouvait jamais.
        body: JSON.stringify({ identifier, purpose }),
      });
      outcome = res.ok ? { ok: true } : { ok: false, error: (await res.json().catch(() => ({})))?.error };
    } catch {
      outcome = { ok: false, error: "network" };
    }
    setResending(false);
    setResendMsg(resendMessage(outcome));
    // Un nouveau code remplace l'erreur du précédent.
    if (outcome.ok) {
      setError(null);
      setCode("");
      inputsRef.current[0]?.focus();
    }
    setResendIn(30);
  }

  return (
    <div className="min-h-screen bg-[#FFF8F0] flex flex-col lg:flex-row">
      {/* ================================================================ */}
      {/* LEFT — Hero / Branding                                             */}
      {/* ================================================================ */}
      <div className="lg:w-[45%] xl:w-[42%] bg-[#0A1931] text-white flex flex-col justify-between p-6 md:p-10 lg:p-12 relative overflow-hidden">
        {/* Decorative orbs */}
        <div className="absolute top-[-15%] right-[-10%] w-[350px] h-[350px] rounded-full bg-[#FF7A00]/8 blur-[100px]" />
        <div className="absolute bottom-[-10%] left-[-15%] w-[250px] h-[250px] rounded-full bg-[#008751]/8 blur-[80px]" />

        <div className="relative z-10">
          {/* Logo */}
          <Link href="/signin" className="flex items-center gap-2 mb-10 md:mb-14">
            <div className="w-10 h-10 rounded-xl bg-[#FF7A00] flex items-center justify-center text-white font-extrabold text-[16px]">FW</div>
            <span className="text-white font-extrabold text-[20px] tracking-tight">FlexWork</span>
          </Link>

          {/* Country flags + tagline */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🇧🇯 🇳🇬 🇸🇳 🇨🇮</span>
            <span className="text-[11px] text-white/50 ml-1">+4 pays</span>
          </div>
          <h1 className="text-[26px] md:text-[32px] lg:text-[36px] font-extrabold leading-tight mb-3">
            Un code,<br />
            <span className="text-[#FF7A00]">et te voilà connecté</span>
          </h1>
          <p className="text-white/50 text-[14px] leading-relaxed max-w-[380px]">
            Vérifie ton identité en quelques secondes — aucune donnée sensible n&apos;est stockée.
          </p>
        </div>

        {/* Pas de chiffres inventés ici (« 500K+ », « 4.9/5 », « 100% ») : chaque case décrit
            un fait produit — KYC, Mobile Money FCFA, séquestre, OTP (même règle que le Hero). */}
        <div className="relative z-10 grid grid-cols-2 gap-3 mt-6">
          {[
            { icon: <Users className="w-4 h-4" />, value: "KYC", label: "Identité vérifiée" },
            { icon: <CreditCard className="w-4 h-4" />, value: "MoMo", label: "Paiement FCFA" },
            { icon: <Shield className="w-4 h-4" />, value: "Escrow", label: "Fonds séquestrés" },
            { icon: <Mail className="w-4 h-4" />, value: "OTP", label: "Connexion par code" },
          ].map((s, i) => (
            <div key={i} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.05]">
              <div className="text-[#FF7A00] mb-1">{s.icon}</div>
              <div className="text-[16px] font-bold">{s.value}</div>
              <div className="text-[10px] text-white/40">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="relative z-10 mt-6 text-[11px] text-white/25">
          © 2026 FlexWork • Talents vérifiés, zéro arnaque
        </div>
      </div>

      {/* ================================================================ */}
      {/* RIGHT — Saisie du code                                             */}
      {/* ================================================================ */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 lg:p-12">
        <div className="w-full max-w-[440px]">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#FFF0E0] border border-[#FF7A00]/20 flex items-center justify-center mb-4">
              <KeyRound className="w-7 h-7 text-[#FF7A00]" />
            </div>
            <h1 className="text-[24px] md:text-[28px] font-bold text-[#0A1931]">Vérification</h1>
            <p className="text-[13px] text-zinc-500 mt-1.5">
              Un code à 6 chiffres a été envoyé à{" "}
              <strong className="text-zinc-700">{identifier}</strong>.
            </p>
            {purpose !== "signup" && (
              <Link href="/signin" className="inline-flex items-center justify-center gap-1 mt-2 text-[12px] text-[#008751] font-semibold hover:underline">
                <PencilLine className="w-3.5 h-3.5" /> Modifier l&apos;identifiant
              </Link>
            )}
          </div>

          {/* Info hint */}
          <div className="mb-6 px-4 py-3 rounded-xl bg-[#eefaf4] border border-[#008751]/15 text-[12.5px] text-zinc-700 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[#008751] shrink-0 mt-0.5" />
            <span>Le code expire dans 5 minutes. Saisis-le ci-dessous pour valider, ou demandes-en un nouveau.</span>
          </div>

          {/* Error */}
          {!identifier && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              Lien incomplet : aucun email n&apos;est indiqué.{" "}
              <Link href="/signin" className="font-semibold underline hover:no-underline">Recommencer la connexion</Link>
            </div>
          )}

          {error && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              {error.message}
              {error.offerSignup && (
                <p className="mt-2 font-normal">
                  Pas encore de compte ?{" "}
                  <Link href={withCallbackUrl("/signup", params.get("callbackUrl"))} className="font-semibold underline hover:no-underline">Créer un compte</Link>
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Code input — six cases, voir commitDigits */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-2">Code reçu</label>
              <div className="flex justify-center gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputsRef.current[i] = el;
                    }}
                    value={code[i] ?? ""}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handlePaste : undefined}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={1}
                    required
                    autoFocus={i === 0}
                    aria-label={`Chiffre ${i + 1} sur 6`}
                    className="w-12 h-12 rounded-xl border border-[#E2E8F0] bg-white text-center text-[20px] font-bold text-[#0A1931] focus:outline-none focus:border-[#008751] focus:ring-2 focus:ring-[#008751]/20 transition"
                  />
                ))}
              </div>
              <p className="flex items-center justify-center gap-1 mt-2 text-[11px] text-zinc-400">
                <span className="text-[#008751]">✓</span> Code à usage unique • Jamais redemandé
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !identifier}
              className="w-full h-12 rounded-xl bg-[#FF7A00] text-white text-[15px] font-bold hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_4px_16px_rgba(255,122,0,0.3)] flex items-center justify-center gap-2"
            >
              {submitting ? (
                "Vérification..."
              ) : (
                <>
                  Valider le code
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Renvoi — le canal est l'email, pour l'inscription comme pour la connexion.
                Jusqu'ici l'inscription renvoyait vers « Contacter le support » alors que le
                serveur savait déjà émettre un nouveau code : elle laissait l'utilisateur
                sans recours pour une simple non-réception. */}
            <div className="text-center pt-1 space-y-1.5">
              {resendMsg && (
                <p role="status" className={`text-[12.5px] font-medium ${resendMsg.ok ? "text-[#008751]" : "text-red-700"}`}>
                  {resendMsg.text}
                </p>
              )}
              <button
                type="button"
                onClick={handleResend}
                disabled={resending || resendIn > 0 || !identifier}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#008751] hover:underline disabled:text-zinc-400 disabled:no-underline disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${resending ? "animate-spin" : ""}`} />
                {resending
                  ? "Envoi..."
                  : resendIn > 0
                    ? `Renvoyer par email (${resendIn}s)`
                    : "Renvoyer par email"}
              </button>
            </div>
          </form>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 mt-8 pt-6 border-t border-zinc-100">
            {[
              { icon: "👥", label: "Identité vérifiée (KYC)" },
              { icon: "💳", label: "Paiement sous séquestre" },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <span>{b.icon}</span> {b.label}
              </div>
            ))}
          </div>

          {/* Footer links */}
          <div className="flex items-center justify-center gap-4 mt-4">
            {/* Chemins explicites — même correctif que la page de connexion (2026-09-16). */}
            {[
              { label: "Confidentialité", href: "/confidentialite" },
              { label: "Conditions", href: "/cgu" },
              { label: "Support", href: "/contact" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="text-[11px] text-zinc-400 hover:text-zinc-600">{l.label}</Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center"><div className="text-[14px] text-zinc-500">Chargement...</div></div>}>
      <VerifyOtpForm />
    </Suspense>
  );
}
