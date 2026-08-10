"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn, getSession } from "next-auth/react";
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // L'id du provider est "otp" (src/auth.ts) — "credentials" est le type générique,
    // pas l'id ; signIn("credentials", …) cible un provider inexistant et NextAuth
    // renvoie vers /signin avec un callbackUrl pointant sur cette page elle-même.
    const result = await signIn("otp", { identifier, code, purpose, redirect: false });

    setSubmitting(false);
    if (!result || result.error) {
      setError("Code invalide ou expiré.");
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
    router.push(role ? ROLE_DASHBOARD[role] ?? "/dashboard/client" : "/dashboard/client");
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-20 px-4">
      <div className="mx-auto max-w-[420px]">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-zinc-100">
            <h1 className="text-[18px] font-bold text-zinc-900">Vérification</h1>
          </div>
          <div className="px-6 py-4">
            <p className="text-[13px] text-zinc-600">
              Un code a été envoyé à <strong>{identifier}</strong>.
            </p>
          </div>
          {error && (
            <div className="mx-6 mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Code reçu</label>
              <input type="text" inputMode="numeric" required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>
            <button type="submit" disabled={submitting}
              className="w-full h-11 rounded-full bg-[#008751] text-white text-[14px] font-semibold hover:bg-[#006e43] disabled:opacity-50 disabled:cursor-not-allowed transition">
              {submitting ? "Vérification..." : "Valider"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 flex items-center justify-center"><div className="text-[14px] text-zinc-500">Chargement...</div></div>}>
      <VerifyOtpForm />
    </Suspense>
  );
}
