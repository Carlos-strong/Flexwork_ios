"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Shield, ArrowRight, Users, CreditCard } from "lucide-react";

const COUNTRY_CODES = [
  { value: "+229", label: "+229", flag: "🇧🇯" },
  { value: "+234", label: "+234", flag: "🇳🇬" },
  { value: "+221", label: "+221", flag: "🇸🇳" },
  { value: "+225", label: "+225", flag: "🇨🇮" },
];

export default function SigninPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"email" | "phone">("email");
  const [countryCode, setCountryCode] = useState("+229");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const emailVal = (form.get("email") as string)?.trim();
    const phoneVal = (form.get("phone") as string)?.replace(/\s/g, "");

    const identifier = loginMethod === "email"
      ? emailVal
      : phoneVal.startsWith("+") ? phoneVal : `${countryCode}${phoneVal}`;

    const res = await fetch("/api/auth/login/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "too_many_requests"
        ? "Trop de demandes — réessayez dans quelques minutes."
        : "Une erreur est survenue. Réessayez.");
      return;
    }

    router.push(`/verify-otp?identifier=${encodeURIComponent(identifier)}&purpose=login`);
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
          <div className="flex items-center gap-2 mb-10 md:mb-14">
            <div className="w-10 h-10 rounded-xl bg-[#FF7A00] flex items-center justify-center text-white font-extrabold text-[16px]">FW</div>
            <span className="text-white font-extrabold text-[20px] tracking-tight">FlexWork</span>
          </div>

          {/* Country flags + tagline */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🇧🇯 🇳🇬 🇸🇳 🇨🇮</span>
            <span className="text-[11px] text-white/50 ml-1">+4 pays</span>
          </div>
          <h1 className="text-[26px] md:text-[32px] lg:text-[36px] font-extrabold leading-tight mb-3">
            Talents vérifiés,<br />
            <span className="text-[#FF7A00]">zéro arnaque</span>
          </h1>
          <p className="text-white/50 text-[14px] leading-relaxed max-w-[380px]">
            La première plateforme ouest-africaine avec vérification d&apos;identité obligatoire.
          </p>
        </div>

        {/* Stats */}
        <div className="relative z-10 grid grid-cols-2 gap-3 mt-6">
          {[
            { icon: <Users className="w-4 h-4" />, value: "500K+", label: "Talents vérifiés" },
            { icon: <CreditCard className="w-4 h-4" />, value: "MoMo", label: "Paiement sécurisé" },
            { icon: <Shield className="w-4 h-4" />, value: "100%", label: "Escrow protégé" },
            { icon: <Mail className="w-4 h-4" />, value: "4.9/5", label: "Satisfaction" },
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
      {/* RIGHT — Login Form                                                 */}
      {/* ================================================================ */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 lg:p-12">
        <div className="w-full max-w-[440px]">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-1.5 mb-3">
              <span className="text-lg">🇧🇯</span>
              <span className="text-lg">🇳🇬</span>
              <span className="text-lg">🇸🇳</span>
              <span className="text-lg">🇨🇮</span>
            </div>
            <h1 className="text-[24px] md:text-[28px] font-bold text-[#0A1931]">Connexion</h1>
            <p className="text-[13px] text-zinc-500 mt-1.5">
              {loginMethod === "email"
                ? "Un code de vérification sera envoyé à votre email."
                : "Un code de vérification sera envoyé par SMS."}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Login method toggle */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
            <button
              type="button"
              onClick={() => setLoginMethod("email")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                loginMethod === "email"
                  ? "bg-white text-[#0A1931] shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <Mail className="w-4 h-4" /> Email
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod("phone")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
                loginMethod === "phone"
                  ? "bg-white text-[#0A1931] shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <span className="text-base">📱</span> Téléphone
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email input */}
            {loginMethod === "email" && (
              <div className="animate-[fadeIn_150ms_ease-out]">
                <label className="block text-[13px] font-semibold text-zinc-700 mb-2">Adresse email</label>
                <div className="flex items-center gap-2 p-1.5 rounded-2xl border-2 border-gray-100 bg-white focus-within:border-[#FF7A00] focus-within:shadow-[0_0_0_4px_rgba(255,122,0,0.08)] transition-all">
                  <div className="pl-2.5 shrink-0">
                    <Mail className="w-4 h-4 text-zinc-400" />
                  </div>
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="koffi@exemple.bj"
                    className="flex-1 h-10 px-2 bg-transparent text-[14px] placeholder:text-zinc-400 focus:outline-none"
                    autoComplete="email"
                  />
                </div>
                <p className="flex items-center gap-1 mt-2 text-[11px] text-zinc-400">
                  <span className="text-[#008751]">✓</span> Protégé par chiffrement • Aucun spam
                </p>
              </div>
            )}

            {/* Phone input */}
            {loginMethod === "phone" && (
              <div className="animate-[fadeIn_150ms_ease-out]">
                <label className="block text-[13px] font-semibold text-zinc-700 mb-2">Numéro de téléphone</label>
                <div className="flex items-center gap-2 p-1.5 rounded-2xl border-2 border-gray-100 bg-white focus-within:border-[#FF7A00] focus-within:shadow-[0_0_0_4px_rgba(255,122,0,0.08)] transition-all">
                  <div className="relative shrink-0">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="appearance-none bg-gray-50 rounded-lg pl-2.5 pr-7 py-2 text-[12px] font-semibold text-zinc-600 cursor-pointer focus:outline-none"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.value} value={c.value}>{c.flag} {c.label}</option>
                      ))}
                    </select>
                    <ArrowRight className="w-3 h-3 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
                  </div>
                  <input
                    type="tel"
                    name="phone"
                    required
                    placeholder="97 00 00 00"
                    className="flex-1 h-10 px-2 bg-transparent text-[14px] placeholder:text-zinc-400 focus:outline-none"
                    autoComplete="tel"
                  />
                </div>
                <p className="flex items-center gap-1 mt-2 text-[11px] text-zinc-400">
                  <span className="text-[#008751]">✓</span> SMS sécurisé • Code à 6 chiffres
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl bg-[#FF7A00] text-white text-[15px] font-bold hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_4px_16px_rgba(255,122,0,0.3)] flex items-center justify-center gap-2"
            >
              {submitting ? (
                "Envoi du code..."
              ) : (
                <>
                  Recevoir un code de connexion
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-200" /></div>
              <div className="relative flex justify-center"><span className="px-3 bg-[#FFF8F0] text-[12px] text-zinc-400">Ou continuer avec</span></div>
            </div>

            {/* Social buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="h-11 rounded-xl border border-zinc-200 bg-white text-[13px] font-semibold text-zinc-600 hover:bg-gray-50 flex items-center justify-center gap-2">
                <span className="text-[16px] font-bold text-blue-600">G</span> Google
              </button>
              <button type="button" className="h-11 rounded-xl border border-zinc-200 bg-white text-[13px] font-semibold text-zinc-600 hover:bg-gray-50 flex items-center justify-center gap-2">
                <span className="text-[16px] font-bold text-blue-700">f</span> Facebook
              </button>
            </div>

            {/* Signup link */}
            <p className="text-center text-[13px] text-zinc-500 pt-2">
              Pas encore de compte ?{" "}
              <Link href="/signup" className="text-[#008751] font-semibold hover:underline">Créer un compte</Link>
            </p>
          </form>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 mt-8 pt-6 border-t border-zinc-100">
            {[
              { icon: "👥", label: "500K+ talents vérifiés" },
              { icon: "💳", label: "Paiement MoMo sécurisé" },
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
