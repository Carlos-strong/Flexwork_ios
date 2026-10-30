"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import { CURRENT_TERMS } from "@/lib/terms";

// ── Écrans d'inscription P1 (accueil) et P2 (identité) — 2026-09-23 ───────────────────────
//
// Deux écrans dans une seule route, comme le demande le parcours arbitré :
//   P1 — l'accueil de l'inscription : ce que la plateforme garantit, et un seul bouton.
//   P2 — « Étape 1/2 — Identité » : l'identité, le contact, le consentement.
//
// L'écran P3 (« Étape 2/2 — Vérification ») vit sur /verify-otp, et P4 (choix de l'usage) sur
// /bienvenue : trois routes, parce qu'un rechargement de page au milieu d'un tunnel ne doit
// pas faire perdre ce qui a été saisi.
//
// Ce qui a changé par rapport à l'ancien formulaire, et pourquoi :
//
//  1. **Plus de champ mot de passe.** Déjà retiré côté champs, mais l'écran le dit maintenant
//     (« Sans mot de passe • OTP uniquement ») : l'utilisateur qui cherche où le saisir
//     comprend qu'il n'y en a pas, au lieu de croire à un oubli.
//  2. **Le consentement porte une VERSION et une DATE.** « J'accepte les CGU » ne dit pas quel
//     texte a été accepté ; l'écran affiche donc la version en vigueur et sa date d'entrée en
//     application, lues depuis `CURRENT_TERMS` — la même source que celle qui alimente le
//     consentement chaîné enregistré côté serveur (src/lib/terms.ts).
//  3. **Les deux boutons « Google » et « Facebook » ont été retirés.** Ils étaient affichés et
//     inertes : `src/auth.ts` n'a qu'un provider, `otp`. Un bouton de connexion sociale qui ne
//     connecte à rien est un mensonge d'interface — il reviendra quand le provider existera.
//  4. **L'avertissement « email grand public » ne bloque pas.** Il conseille une adresse
//     professionnelle (un donneur d'ordre se méfie d'un contact gratuit) et accepte au second
//     clic : bloquer sur le domaine de messagerie écarterait la majorité des artisans, sans
//     rien protéger.

type Screen = "splash" | "identite";
type ErrorKind = "account_exists" | "duplicate" | "generic" | null;

// Domaines grand public signalés — jamais refusés. Liste volontairement courte : elle sert à
// CONSEILLER, pas à filtrer, donc une liste incomplète ne coûte qu'un conseil non donné.
const PUBLIC_EMAIL_DOMAINS = ["gmail.com", "yahoo.fr", "yahoo.com", "hotmail.fr", "hotmail.com", "outlook.fr", "outlook.com", "live.fr"];

const fieldClass =
  "mt-1.5 w-full h-11 rounded-xl border border-[#E2E8F0] px-3.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
const labelClass = "text-[12px] font-medium text-zinc-700";

export function InscriptionScreens() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("splash");
  const [error, setError] = useState<ErrorKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [country, setCountry] = useState("BJ");
  const [email, setEmail] = useState("");
  // Deuxième clic sur « Continuer avec cet email » = acceptation explicite.
  const [publicEmailAccepted, setPublicEmailAccepted] = useState(false);

  const selectedCountry = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];
  const isPublicEmail = PUBLIC_EMAIL_DOMAINS.some((d) => email.trim().toLowerCase().endsWith(`@${d}`));
  const showsProEmailNudge = isPublicEmail && !publicEmailAccepted;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Le premier clic sur une adresse grand public n'envoie RIEN : il explique et propose de
    // continuer. Le clic suivant part réellement — c'est la logique « accepté au 2e clic »,
    // et elle évite qu'un utilisateur découvre après coup pourquoi on lui a conseillé autre
    // chose.
    if (showsProEmailNudge) {
      setPublicEmailAccepted(true);
      return;
    }

    const form = new FormData(e.currentTarget);
    setSubmitting(true);

    const telRaw = ((form.get("phone") as string) || "").replace(/\s/g, "");
    const tel = telRaw.startsWith("+") ? telRaw : `${selectedCountry.dial}${telRaw}`;

    const payload = {
      firstname: form.get("firstname") || undefined,
      lastname: form.get("lastname") || undefined,
      email: form.get("email"),
      tel,
      // Pas de `role` : le compte s'ouvre en CLIENT (défaut de la base). L'usage se déclare
      // sur /bienvenue, une fois le compte vérifié.
      country: form.get("country") || undefined,
      city: form.get("city") || undefined,
      locality: form.get("locality") || undefined,
      address: form.get("address") || undefined,
      // Lu depuis la case, jamais écrit en dur : le serveur l'exige (signupSchema) et
      // horodate l'acceptation.
      cgvAccepted: form.get("cgvAccepted") === "on",
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

  // ── P1 — Accueil de l'inscription ───────────────────────────────────────────────────────
  if (screen === "splash") {
    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 lg:p-12">
        <div className="w-full max-w-[520px]">
          <span className="inline-flex px-2.5 py-1 rounded-full bg-[#E6F4EE] text-[#008751] text-[11px] font-semibold">
            Inscription en 2 étapes • Sans mot de passe
          </span>

          <h1 className="mt-4 text-[28px] md:text-[32px] leading-[1.05] font-bold tracking-tight text-[#0A1931]">
            Proposez vos services,
            <br />
            trouvez vos missions.
          </h1>

          <p className="mt-3 text-[14px] leading-6 text-zinc-600">
            Un compte unique : vous commencez en client, et vous ouvrez votre espace prestataire
            quand vous voulez — sans créer de second compte, sans repartir de zéro.
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
            {[
              { titre: "Paliers", detail: "20 % explorer → 100 % mise en avant" },
              { titre: "Métiers", detail: "domaine → métier → compétences" },
              { titre: "Séquestre", detail: "fonds libérés après votre validation" },
            ].map((b) => (
              <div key={b.titre} className="rounded-xl border border-[#E2E8F0] p-3 bg-white">
                <div className="font-semibold text-[#0A1931]">{b.titre}</div>
                <div className="text-zinc-500 mt-0.5 leading-4">{b.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => {
                setEmail("");
                setError(null);
                setScreen("identite");
              }}
              className="h-11 px-5 rounded-xl bg-[#008751] text-white text-sm font-semibold hover:bg-[#006e42] transition"
            >
              Créer un compte
            </button>
            <Link
              href="/signin"
              className="h-11 px-5 inline-flex items-center justify-center rounded-xl bg-white border border-[#E2E8F0] text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Se connecter
            </Link>
          </div>

          <p className="mt-4 text-[11px] text-zinc-500">
            En continuant, vous acceptez les{" "}
            <Link href="/cgu" className="underline">
              conditions générales
            </Link>{" "}
            — version {CURRENT_TERMS.version}, acceptation horodatée et enregistrée.
          </p>
        </div>
      </div>
    );
  }

  // ── P2 — Étape 1/2 : identité ───────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex items-center justify-center p-4 md:p-8 lg:p-12">
      <div className="w-full max-w-[560px] bg-white border border-[#E2E8F0] rounded-xl p-6 md:p-8">
        <div className="flex items-center justify-between mb-6 gap-3">
          <h2 className="text-[18px] font-semibold text-[#0A1931]">Étape 1/2 — Identité</h2>
          <span className="shrink-0 text-[11px] px-2 py-1 rounded-full bg-slate-100 text-zinc-600">
            Sans mot de passe • OTP uniquement
          </span>
        </div>

        {error === "account_exists" && (
          <div role="alert" className="mb-5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px]">
            <div className="font-bold text-amber-800 mb-1">⚠️ Compte existant</div>
            <p className="text-zinc-700">Un compte existe déjà avec cet email ou ce téléphone.</p>
            <Link href="/signin" className="inline-flex items-center gap-1 mt-2 text-[#008751] font-semibold hover:underline">
              → Se connecter
            </Link>
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

        <form onSubmit={handleSubmit}>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstname" className={labelClass}>Prénom <span className="text-[#E8112D]">*</span></label>
              <input id="firstname" name="firstname" type="text" required autoComplete="given-name" placeholder="Koffi" className={fieldClass} />
            </div>
            <div>
              <label htmlFor="lastname" className={labelClass}>Nom <span className="text-[#E8112D]">*</span></label>
              <input id="lastname" name="lastname" type="text" required autoComplete="family-name" placeholder="Adjovi" className={fieldClass} />
            </div>
            <div>
              <label htmlFor="country" className={labelClass}>Pays <span className="text-[#E8112D]">*</span></label>
              <select
                id="country"
                name="country"
                required
                autoComplete="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className={fieldClass}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="city" className={labelClass}>Ville <span className="text-[#E8112D]">*</span></label>
              <input id="city" name="city" type="text" required autoComplete="address-level2" placeholder="Cotonou" className={fieldClass} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="phone" className={labelClass}>Téléphone <span className="text-[#E8112D]">*</span></label>
              <div className="mt-1.5 flex items-stretch h-11 rounded-xl border border-[#E2E8F0] bg-white overflow-hidden focus-within:ring-2 focus-within:ring-[#008751]/20 focus-within:border-[#008751] transition">
                <span
                  className="flex items-center gap-1.5 pl-3.5 pr-2.5 border-r border-[#E2E8F0] bg-[#F8FAF9] text-sm font-medium text-zinc-600 shrink-0"
                  title={`Indicatif ${selectedCountry.name}`}
                >
                  <span aria-hidden="true">{selectedCountry.flag}</span>
                  <span>{selectedCountry.dial}</span>
                </span>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel-national"
                  placeholder="96 12 34 56"
                  className="flex-1 min-w-0 h-full px-3.5 text-sm bg-transparent focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">
                L&apos;indicatif {selectedCountry.dial} suit le pays sélectionné.
              </p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="email" className={labelClass}>Email <span className="text-[#E8112D]">*</span></label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="prenom@entreprise.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setPublicEmailAccepted(false);
                }}
                className={fieldClass}
              />
              {showsProEmailNudge && (
                <div className="mt-2 rounded-lg bg-[#FEF3C7] border border-amber-200 p-2.5 text-[11px] flex items-start justify-between gap-2">
                  <span className="text-zinc-700">
                    ⚠️ Une adresse professionnelle inspire davantage confiance aux donneurs d&apos;ordre.
                    Vous pouvez continuer avec celle-ci.
                  </span>
                  <button
                    type="button"
                    onClick={() => setPublicEmailAccepted(true)}
                    className="shrink-0 px-2 py-1 rounded-lg bg-[#0f172a] text-white text-[10px]"
                  >
                    Continuer avec cet email
                  </button>
                </div>
              )}
              {isPublicEmail && publicEmailAccepted && (
                <p className="mt-2 text-[11px] text-[#008751]">✓ Adresse acceptée — vous pourrez la changer plus tard.</p>
              )}
            </div>
          </div>

          <input type="hidden" name="locality" value="" />
          <input type="hidden" name="address" value="" />

          <label className="mt-5 flex items-start gap-2 cursor-pointer">
            <input type="checkbox" name="cgvAccepted" required className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-[#008751] focus:ring-[#008751]" />
            <span className="text-[12px] text-zinc-500 leading-relaxed">
              J&apos;accepte les{" "}
              <Link href="/cgu" className="text-[#008751] underline font-medium">conditions générales</Link>{" "}
              et la{" "}
              <Link href="/confidentialite" className="text-[#008751] underline font-medium">politique de confidentialité</Link>
              {" "}— version {CURRENT_TERMS.version}, en vigueur depuis le{" "}
              {new Date(CURRENT_TERMS.effectiveAt).toLocaleDateString("fr-FR")}.
            </span>
          </label>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setScreen("splash")}
              className="h-11 px-4 rounded-xl border border-[#E2E8F0] text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Retour
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-11 px-6 rounded-xl bg-[#008751] text-white text-sm font-semibold hover:bg-[#006e42] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Création en cours…" : showsProEmailNudge ? "Continuer avec cet email" : "Créer un compte → OTP"}
            </button>
          </div>
        </form>

        {/* Où va l'utilisateur ensuite — dit une fois, honnêtement, plutôt que découvert. */}
        <div className="mt-6 rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] p-4 text-[11px] leading-5 text-zinc-600">
          <div className="font-semibold text-[#0A1931]">Ce qui suit</div>
          <ul className="mt-1 list-disc ml-4 space-y-0.5">
            <li>Un code à 6 chiffres part par email — étape 2/2, il expire en 5 minutes.</li>
            <li>Le compte s&apos;ouvre en client : publier une mission ne demande rien de plus.</li>
            <li>Pour proposer vos services, vous compléterez votre profil progressivement.</li>
            <li>La vérification d&apos;identité n&apos;est exigée que pour candidater ou publier.</li>
          </ul>
        </div>

        <div className="flex items-center justify-center gap-2 pt-5 mt-5 border-t border-zinc-100 text-[11px] text-zinc-400">
          <Shield className="w-3.5 h-3.5 text-[#008751]" />
          Paiement sécurisé par séquestre — les fonds ne sont libérés qu&apos;après validation
        </div>
      </div>
    </div>
  );
}
