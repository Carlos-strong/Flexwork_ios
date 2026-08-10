"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Connexion par OTP uniquement (email → code → vérification).
export default function SigninPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const identifier = form.get("identifier") as string;

    const res = await fetch("/api/auth/login/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });

    setSubmitting(false);
    if (!res.ok) {
      // La route renvoie toujours 200 même si le compte n'existe pas (anti-énumération,
      // voir /api/auth/login/request-otp) — un échec ici signifie donc un vrai problème
      // (payload invalide, ou trop de demandes), jamais "compte introuvable".
      const data = await res.json().catch(() => ({}));
      setError(data.error === "too_many_requests" ? "Trop de demandes — réessayez dans quelques minutes." : "Une erreur est survenue. Réessayez.");
      return;
    }

    router.push(
      `/verify-otp?identifier=${encodeURIComponent(identifier)}&purpose=login`
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-20 px-4">
      <div className="mx-auto max-w-[420px]">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-zinc-100">
            <h1 className="text-[18px] font-bold text-zinc-900">Connexion</h1>
            <p className="text-[13px] text-zinc-500 mt-1">
              Un code de vérification sera envoyé à votre email.
            </p>
          </div>
          {error && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Email ou téléphone</label>
              <input type="text" name="identifier" required placeholder="koffi@exemple.bj ou +229 97 00 00 00"
                className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>
            <button type="submit" disabled={submitting}
              className="w-full h-11 rounded-full bg-[#008751] text-white text-[14px] font-semibold hover:bg-[#006e43] disabled:opacity-50 disabled:cursor-not-allowed transition">
              {submitting ? "Envoi du code..." : "Recevoir un code de connexion"}
            </button>
            <p className="text-center text-[13px] text-zinc-500">
              <a href="/signup" className="text-[#008751] hover:underline font-medium">Pas encore de compte ?</a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
