"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Shield } from "lucide-react";
import { AuthHero } from "./auth-hero";

const PROVIDER_ROLES = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// Source unique pays ⇄ indicatif : le select "Pays" et le select "Indicatif
// téléphonique" partageaient auparavant deux listes divergentes (NG absent
// des pays, BF/NE absents des indicatifs) — on les dérive maintenant du
// même tableau pour qu'ils restent toujours synchronisés.
const COUNTRIES = [
  { code: "BJ", dial: "+229", flag: "🇧🇯", name: "Bénin" },
  { code: "TG", dial: "+228", flag: "🇹🇬", name: "Togo" },
  { code: "SN", dial: "+221", flag: "🇸🇳", name: "Sénégal" },
  { code: "CI", dial: "+225", flag: "🇨🇮", name: "Côte d'Ivoire" },
  { code: "BF", dial: "+226", flag: "🇧🇫", name: "Burkina Faso" },
  { code: "NE", dial: "+227", flag: "🇳🇪", name: "Niger" },
  { code: "NG", dial: "+234", flag: "🇳🇬", name: "Nigeria" },
];

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [error, setError] = useState<"account_exists" | "duplicate" | "generic" | "password_mismatch" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [country, setCountry] = useState("BJ");

  const isProvider = PROVIDER_ROLES.includes(role);
  // Le préfixe téléphonique n'est plus choisi séparément : il suit le pays sélectionné.
  const selectedCountry = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);

    // Le champ "Confirmer" n'était ni nommé ni comparé au mot de passe :
    // n'importe quelle confirmation (ou aucune) passait silencieusement.
    if (form.get("password") !== form.get("confirmPassword")) {
      setError("password_mismatch");
      return;
    }

    setSubmitting(true);

    const telRaw = (form.get("phone") as string || "").replace(/\s/g, "");
    const tel = telRaw.startsWith("+") ? telRaw : `${selectedCountry.dial}${telRaw}`;

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
      <AuthHero />

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
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px]">
              <div className="font-bold text-amber-800 mb-1">⚠️ Compte existant</div>
              <p className="text-zinc-700">Un compte existe déjà avec cet email ou ce téléphone.</p>
              <Link href="/signin" className="inline-flex items-center gap-1 mt-2 text-[#008751] font-semibold hover:underline">→ Se connecter</Link>
            </div>
          )}
          {error === "duplicate" && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              ⚠️ Une activité suspecte a été détectée. Veuillez contacter le support.
            </div>
          )}
          {error === "generic" && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              Impossible de créer le compte. Veuillez réessayer.
            </div>
          )}
          {error === "password_mismatch" && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              Les deux mots de passe ne correspondent pas.
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
                <label htmlFor="providerType" className="block text-[13px] font-semibold text-zinc-700 mb-2">Type de prestataire <span className="text-[#E8112D]">*</span></label>
                <select id="providerType" name="providerType" value={role} onChange={(e) => setRole(e.target.value)}
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
                <input type="text" name="lastname" required autoComplete="family-name" aria-label="Nom" placeholder="Adjovi" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                <input type="text" name="firstname" required autoComplete="given-name" aria-label="Prénom" placeholder="Koffi" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Email <span className="text-[#E8112D]">*</span></label>
              <input id="email" type="email" name="email" required autoComplete="email" placeholder="koffi@email.com" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>

            {/* Pays & Ville — le pays est choisi avant le téléphone : son indicatif en dépend juste en dessous */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="country" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pays <span className="text-[#E8112D]">*</span></label>
                <select id="country" name="country" required autoComplete="country" value={country} onChange={(e) => setCountry(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition">
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="city" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Ville <span className="text-[#E8112D]">*</span></label>
                <input id="city" type="text" name="city" required autoComplete="address-level2" placeholder="Cotonou" className="w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Téléphone — l'indicatif suit automatiquement le pays choisi ci-dessus, plus besoin de le resélectionner */}
            <div>
              <label htmlFor="phone" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Téléphone <span className="text-[#E8112D]">*</span></label>
              <div className="flex items-stretch h-11 rounded-xl border border-zinc-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-[#008751]/20 focus-within:border-[#008751] transition">
                <span className="flex items-center gap-1.5 pl-3 pr-2 border-r border-zinc-200 bg-zinc-50 text-[14px] font-medium text-zinc-600 shrink-0" title={`Indicatif ${selectedCountry.name}`}>
                  <span aria-hidden="true">{selectedCountry.flag}</span>
                  <span>{selectedCountry.dial}</span>
                </span>
                <input id="phone" type="tel" name="phone" required autoComplete="tel-national" placeholder="96 12 34 56" className="flex-1 min-w-0 h-full px-4 text-[14px] bg-transparent focus:outline-none" />
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">Indicatif {selectedCountry.dial} appliqué automatiquement d&apos;après le pays sélectionné.</p>
            </div>

            {/* Locality + Address (hidden by default, expandable) */}
            <input type="hidden" name="locality" value="" />
            <input type="hidden" name="address" value="" />

            {/* Password */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="password" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Mot de passe <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <input id="password" type={showPw ? "text" : "password"} name="password" required minLength={12} autoComplete="new-password" placeholder="••••••••" className="w-full h-11 px-4 pr-10 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                  <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Confirmer <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <input id="confirmPassword" type={showConfirm ? "text" : "password"} name="confirmPassword" required minLength={12} autoComplete="new-password" placeholder="••••••••" className="w-full h-11 px-4 pr-10 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} aria-label={showConfirm ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
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
              <input type="checkbox" name="cgvAccepted" required className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-[#008751] focus:ring-[#008751]" />
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
              Paiement sécurisé par séquestre (Escrow)
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
