"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Shield, Zap, Users } from "lucide-react";

const PROVIDER_ROLES = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

const COUNTRY_CODES = [
  { value: "+229", label: "BJ +229", flag: "🇧🇯" },
  { value: "+234", label: "NG +234", flag: "🇳🇬" },
  { value: "+221", label: "SN +221", flag: "🇸🇳" },
  { value: "+225", label: "CI +225", flag: "🇨🇮" },
  { value: "+228", label: "TG +228", flag: "🇹🇬" },
];

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [error, setError] = useState<"account_exists" | "duplicate" | "generic" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [countryCode, setCountryCode] = useState("+229");

  const isProvider = PROVIDER_ROLES.includes(role);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const telRaw = (form.get("phone") as string || "").replace(/\s/g, "");
    const tel = telRaw.startsWith("+") ? telRaw : `${countryCode}${telRaw}`;

    const payload = {
      firstname: form.get("firstname") || undefined,
      lastname: form.get("lastname") || undefined,
      email: form.get("email"),
      tel,
      password: form.get("password"),
      role: form.get("role") || undefined,
      country: form.get("country") || undefined,
      city: form.get("city") || undefined,
      locality: form.get("locality") || undefined,
      address: form.get("address") || undefined,
      cgvAccepted: true,
    };

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === "account_already_exists") setError("account_exists");
      else if (data.error === "duplicate_account_suspected") setError("duplicate");
      else setError("generic");
      return;
    }
    router.push(`/verify-otp?identifier=${encodeURIComponent(String(payload.email))}&purpose=signup`);
  }

  return (
    <div className="min-h-screen bg-[#FFF8F0] flex flex-col lg:flex-row">
      {/* ================================================================ */}
      {/* LEFT — Hero / Branding                                             */}
      {/* ================================================================ */}
      <div className="lg:w-[45%] xl:w-[42%] bg-[#0A1931] text-white flex flex-col justify-between p-6 md:p-10 lg:p-12 relative overflow-hidden">
        {/* Decorative gradient orbs */}
        <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-[#FF7A00]/10 blur-[80px]" />
        <div className="absolute bottom-[-10%] left-[-20%] w-[300px] h-[300px] rounded-full bg-[#008751]/10 blur-[60px]" />

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-12 md:mb-16">
            <div className="w-10 h-10 rounded-xl bg-[#FF7A00] flex items-center justify-center text-white font-extrabold text-[16px]">AF</div>
            <div>
              <span className="text-white font-extrabold text-[18px] tracking-tight">afrilance</span>
              <span className="text-[#FF7A00] font-extrabold text-[18px]">.</span>
              <span className="ml-2 px-1.5 py-0.5 rounded-md bg-white/10 text-[10px] font-bold text-[#FCD116]">BETA</span>
            </div>
          </div>

          <h1 className="text-[28px] md:text-[34px] lg:text-[38px] font-extrabold leading-tight mb-4">
            Rejoins <span className="text-[#FF7A00]">500K+</span><br />
            talents <span className="text-[#FCD116]">africains</span>
          </h1>
          <p className="text-white/60 text-[14px] md:text-[15px] leading-relaxed max-w-[420px] mb-8">
            La plateforme #1 pour freelancers et entreprises en Afrique de l&apos;Ouest.
          </p>

          {/* Feature pills */}
          <div className="space-y-4">
            {[
              { icon: <Zap className="w-4 h-4" />, label: "Paiement Mobile Money FCFA", sub: "MTN, Orange, Moov, Wave — retrait instantané" },
              { icon: <Shield className="w-4 h-4" />, label: "Missions Escrow sécurisées", sub: "Ton paiement bloqué jusqu'à validation" },
              { icon: <Users className="w-4 h-4" />, label: "Support Wolof / Fon / Français", sub: "Assistance locale 7j/7 en 4 langues" },
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.05] border border-white/[0.06]">
                <div className="w-8 h-8 rounded-full bg-[#FF7A00]/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[#FF7A00]">{f.icon}</span>
                </div>
                <div>
                  <div className="text-[13px] font-semibold">{f.label}</div>
                  <div className="text-[11px] text-white/50 mt-0.5">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div className="relative z-10 mt-8 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF7A00] to-[#E8112D] flex items-center justify-center text-white text-[11px] font-bold">AB</div>
            <div>
              <div className="text-[12px] font-semibold">Aïcha B.</div>
              <div className="text-[10px] text-white/50">Designer UI • Cotonou, BJ</div>
            </div>
            <div className="ml-auto flex text-[#FCD116] text-[12px]">★★★★★</div>
          </div>
          <p className="text-[12px] text-white/70 italic leading-relaxed">
            &ldquo;Grâce à AfriLance j&rsquo;ai doublé mes revenus. Paiement MoMo en 2h !&rdquo;
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 mt-6 flex items-center gap-2 text-[11px] text-white/30">
          <span>© 2026 AfriLance</span> <span>•</span> <span>500K+ membres</span> <span>•</span> <span>⭐ 4.9/5</span>
        </div>
      </div>

      {/* ================================================================ */}
      {/* RIGHT — Registration Form                                          */}
      {/* ================================================================ */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 lg:p-12">
        <div className="w-full max-w-[480px]">
          <div className="mb-6 md:mb-8">
            <h2 className="text-[22px] md:text-[26px] font-bold text-[#0A1931]">Créer ton compte</h2>
            <p className="text-[13px] text-zinc-500 mt-1">Rejoins la communauté en 30 secondes</p>
          </div>

          {/* Error states */}
          {error === "account_exists" && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px]">
              <div className="font-bold text-amber-800 mb-1">⚠️ Compte existant</div>
              <p className="text-zinc-700">Un compte existe déjà avec cet email ou ce téléphone.</p>
              <Link href="/signin" className="inline-flex items-center gap-1 mt-2 text-[#008751] font-semibold hover:underline">→ Se connecter</Link>
            </div>
          )}
          {error === "duplicate" && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              ⚠️ Une activité suspecte a été détectée. Veuillez contacter le support.
            </div>
          )}
          {error === "generic" && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              Impossible de créer le compte. Veuillez réessayer.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Role selector — cards */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-2">Je suis...</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole("client")}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all text-left ${
                    role === "client"
                      ? "border-[#FF7A00] bg-[#FFF8F0] shadow-[0_0_0_4px_rgba(255,122,0,0.1)]"
                      : "border-gray-100 bg-white hover:border-gray-200"
                  }`}
                >
                  <span className="text-2xl">🛒</span>
                  <span className="text-[13px] font-bold text-[#0A1931]">Client</span>
                  <span className="text-[10px] text-zinc-400">Je cherche un talent</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole("expert_digital")}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition-all text-left ${
                    isProvider
                      ? "border-[#008751] bg-[#f0faf5] shadow-[0_0_0_4px_rgba(0,135,81,0.1)]"
                      : "border-gray-100 bg-white hover:border-gray-200"
                  }`}
                >
                  <span className="text-2xl">💼</span>
                  <span className="text-[13px] font-bold text-[#0A1931]">Prestataire</span>
                  <span className="text-[10px] text-zinc-400">Je propose mes services</span>
                </button>
              </div>
              <input type="hidden" name="role" value={role} />
            </div>

            {/* Provider type selector (shown when prestataire selected) */}
            {isProvider && (
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-2">Type de prestataire <span className="text-[#E8112D]">*</span></label>
                <select name="providerType" value={role} onChange={(e) => setRole(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition">
                  <option value="expert_digital">Expert Digital</option>
                  <option value="expert_btp_autres">Expert BTP / Autres</option>
                  <option value="artisan">Artisan</option>
                  <option value="manoeuvre">Manœuvre</option>
                </select>
              </div>
            )}

            {/* Nom complet */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Nom complet <span className="text-[#E8112D]">*</span></label>
              <div className="grid grid-cols-2 gap-3">
                <input type="text" name="lastname" required placeholder="Adjovi" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                <input type="text" name="firstname" required placeholder="Koffi" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Email <span className="text-[#E8112D]">*</span></label>
              <input type="email" name="email" required placeholder="koffi@email.com" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>

            {/* Téléphone avec code pays */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Téléphone <span className="text-[#E8112D]">*</span></label>
              <div className="flex gap-2">
                <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
                  className="h-11 px-2 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition shrink-0">
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.value} value={c.value}>{c.flag} {c.label}</option>
                  ))}
                </select>
                <input type="tel" name="phone" required placeholder="96 12 34 56" className="flex-1 h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Pays & Ville */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pays <span className="text-[#E8112D]">*</span></label>
                <select name="country" required defaultValue="BJ" className="w-full h-11 px-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition">
                  <option value="BJ">🇧🇯 Bénin</option>
                  <option value="TG">🇹🇬 Togo</option>
                  <option value="SN">🇸🇳 Sénégal</option>
                  <option value="CI">🇨🇮 Côte d'Ivoire</option>
                  <option value="BF">🇧🇫 Burkina Faso</option>
                  <option value="NE">🇳🇪 Niger</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Ville <span className="text-[#E8112D]">*</span></label>
                <input type="text" name="city" required placeholder="Cotonou" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Locality + Address (hidden by default, expandable) */}
            <input type="hidden" name="locality" value="" />
            <input type="hidden" name="address" value="" />

            {/* Password */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Mot de passe <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <input type={showPw ? "text" : "password"} name="password" required minLength={12} placeholder="••••••••" className="w-full h-11 px-4 pr-10 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Confirmer</label>
                <input type={showConfirm ? "text" : "password"} placeholder="••••••••" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Provider info banner */}
            {isProvider && (
              <div className="px-4 py-3 rounded-xl bg-[#FEF9C3] border border-[#FCD116] text-[13px] text-zinc-700">
                Une fois ton compte créé, complète ton profil (domaine, tarif) puis tes qualifications et expériences.
              </div>
            )}

            {/* CGU */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" required className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-[#008751] focus:ring-[#008751]" />
              <span className="text-[12px] text-zinc-500 leading-relaxed">
                J&rsquo;accepte les <Link href="/terms" className="text-[#008751] underline font-medium">CGU</Link> et la <Link href="/privacy" className="text-[#008751] underline font-medium">politique de confidentialité</Link>
              </span>
            </label>

            {/* Submit */}
            <button type="submit" disabled={submitting || !role}
              className="w-full h-12 rounded-xl bg-[#FF7A00] text-white text-[15px] font-bold hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_16px_rgba(255,122,0,0.3)]">
              {submitting ? "Création en cours..." : "S'inscrire — Gratuit"}
            </button>

            {/* Social login */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-200" /></div>
              <div className="relative flex justify-center"><span className="px-3 bg-[#FFF8F0] text-[12px] text-zinc-400">Ou avec</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="h-11 rounded-xl border border-zinc-200 bg-white text-[13px] font-semibold text-zinc-600 hover:bg-gray-50 flex items-center justify-center gap-2">
                <span className="text-[16px] font-bold text-blue-600">G</span> Google
              </button>
              <button type="button" className="h-11 rounded-xl border border-zinc-200 bg-white text-[13px] font-semibold text-zinc-600 hover:bg-gray-50 flex items-center justify-center gap-2">
                <span className="text-[16px] font-bold text-blue-700">f</span> Facebook
              </button>
            </div>

            <p className="text-center text-[13px] text-zinc-500">
              Déjà membre ?{" "}
              <Link href="/signin" className="text-[#008751] font-semibold hover:underline">Connexion</Link>
            </p>

            {/* Trust badge */}
            <div className="flex items-center justify-center gap-2 pt-3 border-t border-zinc-100 text-[11px] text-zinc-400">
              <Shield className="w-3.5 h-3.5 text-[#008751]" />
              Paiement sécurisé par AfriLance Escrow
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
