"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn, getSession } from "next-auth/react";
import Link from "next/link";
import { KeyRound, ArrowRight, Info, Shield, Users, CreditCard, Mail, RefreshCw, PencilLine } from "lucide-react";
import { ROLE_DASHBOARD } from "@/lib/role-dashboard";

// Vérification OTP — étape commune signup/login.
// Aligné sur formulaires-flexwork-tous-profils.html.
// Après signup → /kyc, après login → dashboard du rôle, résolu via getSession().
function VerifyOtpForm() {
  const params = useSearchParams();
  const router = useRouter();
  const identifier = params.get("identifier") ?? "";
  const purpose = params.get("purpose") ?? "login";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Renvoi du code (connexion) : compte à rebours anti-spam côté client, miroir du
  // rate-limit serveur (/api/auth/login/request-otp). Démarre à 30s — le code vient d'être
  // envoyé depuis /signin — puis « Renvoyer un code » se réactive à 0.
  const [resendIn, setResendIn] = useState(30);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

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
    const result = await signIn("otp", { identifier, code: value, purpose, redirect: false });

    setSubmitting(false);
    if (!result || result.error) {
      // Message volontairement ambigu en connexion : un code invalide/expiré et un
      // identifiant qui n'a jamais reçu de code (compte inexistant, voir
      // /api/auth/login/request-otp) produisent la même erreur ici. Distinguer les deux cas
      // explicitement ("vous n'êtes pas inscrit") permettrait d'énumérer les comptes
      // enregistrés en testant des identifiants un par un — exactement ce que la réponse
      // identique de request-otp (timing + rate-limit inclus) est censée empêcher. Le lien
      // vers /signup couvre le cas légitime (utilisateur pas encore inscrit) sans confirmer
      // son hypothèse côté serveur.
      setError(
        purpose === "signup"
          ? "Code invalide ou expiré."
          : "Code invalide, expiré, ou aucun compte associé à cet identifiant."
      );
      return;
    }

    if (purpose === "signup") {
      router.push("/kyc");
      return;
    }

    // Mesuré en réel (curl, à chaud, plusieurs passes) : GET /api/auth/session
    // (~170-220ms) est systématiquement plus rapide que de naviguer vers /dashboard, un
    // Server Component qui ne fait qu'auth()+redirect() (~245-290ms) — même en lisant le
    // JWT localement, cette page traverse tout le pipeline de résolution de route/RSC de
    // Next (résolution de module, correspondance de layout), plus lourd qu'un handler
    // d'API minimal. Et ça évite une double navigation visible (/dashboard puis
    // /dashboard/{role}) pour une seule transition directe vers l'URL finale.
    const session = await getSession();
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

  // Auto-submit : dès que 6 chiffres sont saisis, la vérification part immédiatement —
  // l'utilisateur n'a pas à cliquer « Valider ». Les non-chiffres sont ignorés.
  function handleCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !submitting) void submitCode(digits);
  }

  async function handleResend() {
    if (resending || resendIn > 0) return;
    setResending(true);
    setResendMsg(null);
    const res = await fetch("/api/auth/login/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    setResending(false);
    setResendMsg(
      res.ok ? "Un nouveau code a été envoyé." : "Trop de demandes — réessayez dans quelques minutes."
    );
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
            <span>Le code expire dans 10 minutes. Saisis-le ci-dessous pour valider.</span>
          </div>

          {/* Error */}
          {error && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              {error}
              {purpose !== "signup" && (
                <p className="mt-2 font-normal">
                  Pas encore de compte ?{" "}
                  <Link href="/signup" className="font-semibold underline hover:no-underline">Créer un compte</Link>
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Code input */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-2">Code reçu</label>
              <div className="p-1.5 rounded-2xl border-2 border-gray-100 bg-white focus-within:border-[#FF7A00] focus-within:shadow-[0_0_0_4px_rgba(255,122,0,0.08)] transition-all">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  autoComplete="one-time-code"
                  autoFocus
                  className="w-full h-12 bg-transparent text-center text-[22px] font-bold tracking-[0.5em] text-[#0A1931] placeholder:text-zinc-300 focus:outline-none"
                />
              </div>
              <p className="flex items-center gap-1 mt-2 text-[11px] text-zinc-400">
                <span className="text-[#008751]">✓</span> Code à usage unique • Jamais redemandé
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
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

            {/* Resend / help — le renvoi se fait ICI (connexion), plus besoin de passer
                par une page « mot de passe oublié » : la connexion est 100% par code. */}
            <div className="text-center pt-1 space-y-1.5">
              {purpose === "signup" ? (
                <p className="text-[12.5px] text-zinc-500">
                  Code non reçu ?{" "}
                  <Link href="/contact" className="text-[#008751] font-semibold hover:underline">Contacter le support</Link>
                </p>
              ) : (
                <>
                  {resendMsg && <p className="text-[12.5px] text-[#008751] font-medium">{resendMsg}</p>}
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending || resendIn > 0}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#008751] hover:underline disabled:text-zinc-400 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${resending ? "animate-spin" : ""}`} />
                    {resending
                      ? "Envoi..."
                      : resendIn > 0
                        ? `Renvoyer le code (${resendIn}s)`
                        : "Renvoyer un code"}
                  </button>
                </>
              )}
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
            {["Confidentialité", "Conditions", "Support"].map((l) => (
              <Link key={l} href={`/${l.toLowerCase()}`} className="text-[11px] text-zinc-400 hover:text-zinc-600">{l}</Link>
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
