"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROVIDER_ROLES = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

const PAYS = [
  { value: "BJ", label: "Bénin" },
  { value: "TG", label: "Togo" },
  { value: "CI", label: "Côte d'Ivoire" },
  { value: "BF", label: "Burkina Faso" },
  { value: "NE", label: "Niger" },
  { value: "SN", label: "Sénégal" },
];

// US-101/US-102 (Phase 1) — inscription multi-profils alignée sur
// formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : mot de passe (12 car. min), localité, téléphone avec
// indicatif pays, double opt-in email, pays élargis.
export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [error, setError] = useState<"account_exists" | "duplicate" | "generic" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isProvider = PROVIDER_ROLES.includes(role);
  const blocksLabel = role === "client"
    ? "la PUBLICATION d'une mission"
    : "la CANDIDATURE aux missions";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const payload = {
      firstname: form.get("firstname") || undefined,
      lastname: form.get("lastname") || undefined,
      email: form.get("email"),
      tel: form.get("phone"),
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
      if (data.error === "account_already_exists") {
        setError("account_exists");
      } else if (data.error === "duplicate_account_suspected") {
        setError("duplicate");
      } else {
        setError("generic");
      }
      return;
    }

    router.push(
      `/verify-otp?identifier=${encodeURIComponent(String(payload.email))}&purpose=signup`
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[640px]">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-zinc-100">
            <h1 className="text-[18px] font-bold text-zinc-900">Créer un compte</h1>
            <p className="text-[13px] text-zinc-500 mt-1">
              Le KYC ne bloque <strong>jamais</strong> l&apos;inscription. Il conditionne uniquement{" "}
              <strong>{blocksLabel}</strong>.
            </p>
          </div>

          {error === "account_exists" && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#FEF9C3] border border-[#FCD116] text-[13px]">
              <div className="font-bold text-[#854d0e] mb-1">⚠️ Compte existant</div>
              <p className="text-zinc-700">Un compte existe déjà avec cet email ou ce téléphone.</p>
              <a href="/signin" className="inline-flex items-center gap-1 mt-2 text-[#008751] font-semibold hover:underline">
                → Se connecter
              </a>
            </div>
          )}

          {error === "duplicate" && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              ⚠️ Une activité suspecte a été détectée sur ce compte. Veuillez contacter le support.
            </div>
          )}

          {error === "generic" && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
              Impossible de créer le compte. Veuillez réessayer.
            </div>
          )}

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
            {/* Type de profil */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">
                Type de profil <span className="text-[#E8112D]">*</span>
              </label>
              <select name="role" required value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition">
                <option value="">Sélectionner</option>
                <option value="client">Client</option>
                <option value="expert_digital">Expert Digital</option>
                <option value="expert_btp_autres">Expert BTP / Autres</option>
                <option value="artisan">Artisan</option>
                <option value="manoeuvre">Manœuvre</option>
              </select>
              <p className="text-[11px] text-zinc-400 mt-1">Stocké dans <code className="bg-zinc-100 px-1 py-0.5 rounded text-[11px]">users.role</code></p>
            </div>

            {/* Identité */}
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Identité</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Nom <span className="text-[#E8112D]">*</span></label>
                <input type="text" name="lastname" required placeholder="Adjovi" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Prénom <span className="text-[#E8112D]">*</span></label>
                <input type="text" name="firstname" required placeholder="Koffi" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            {/* Contact */}
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Contact</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pays <span className="text-[#E8112D]">*</span></label>
                <select name="country" required defaultValue="BJ" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition">
                  {PAYS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Ville <span className="text-[#E8112D]">*</span></label>
                <input type="text" name="city" required placeholder="Cotonou" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Localité</label>
              <input type="text" name="locality" placeholder="Quartier / Arrondissement" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Adresse</label>
              <textarea name="address" rows={2} placeholder="Carré 123, Akpakpa" className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Téléphone <span className="text-[#E8112D]">*</span></label>
                <input type="tel" name="phone" required placeholder="+229 97 00 00 00" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                <p className="text-[11px] text-zinc-400 mt-1">1 seul compte par numéro <span className="inline-flex px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 font-medium text-[10px]">MVP</span></p>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Email <span className="text-[#E8112D]">*</span></label>
                <input type="email" name="email" required placeholder="nom@email.com" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                <p className="text-[11px] text-zinc-400 mt-1">Double opt-in</p>
              </div>
            </div>

            {/* Sécurité */}
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Sécurité</div>
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Mot de passe <span className="text-[#E8112D]">*</span></label>
              <input type="password" name="password" required minLength={12} placeholder="••••••••••••" className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
              <p className="text-[11px] text-zinc-400 mt-1">12 caractères minimum · hachage bcrypt/Argon2</p>
            </div>

            {isProvider && (
              <div className="px-4 py-3 rounded-xl bg-[#FEF9C3] border border-[#FCD116] text-[13px] text-zinc-700">
                Une fois votre compte créé, complétez votre profil (domaine, tarif) puis vos qualifications et expériences.
              </div>
            )}

            {/* CGU */}
            <div className="flex items-start gap-2">
              <input type="checkbox" required className="mt-0.5" />
              <span className="text-[13px] text-zinc-600">
                J&apos;accepte les{" "}
                <a href="/terms" className="text-[#008751] underline font-medium">Conditions Générales</a>{" "}
                de FlexWork, la charte de confiance, et les règles de vérification.
              </span>
            </div>

            <button type="submit" disabled={submitting}
              className="w-full h-11 rounded-full bg-[#008751] text-white text-[14px] font-semibold hover:bg-[#006e43] disabled:opacity-50 disabled:cursor-not-allowed transition">
              {submitting ? "Création en cours..." : "Créer le compte"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
