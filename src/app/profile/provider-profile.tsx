"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { hasRequiredGarants } from "@/lib/garant-rules";

type Identity = { firstname: string | null; lastname: string | null; fullName: string; avatarUrl: string | null };

function initialsOf(firstname: string | null, lastname: string | null): string {
  const a = firstname?.trim()?.charAt(0) ?? "";
  const b = lastname?.trim()?.charAt(0) ?? "";
  return (`${a}${b}`.toUpperCase()) || "?";
}

type Profile = {
  mainDomain: string;
  subSpecialty?: string | null;
  secondaryDomain?: string | null;
  indicativeRate?: number | null;
  portfolioUrls?: string[];
  cvUrl?: string | null;
};

type Garant = { id: string; nom: string; tel: string; obligatoire: boolean };

// Raisons d'échec renvoyées par POST /api/profile (voir ce fichier pour le détail de
// chacune) — remplace le générique "Échec de l'enregistrement." qui ne disait jamais au
// prestataire QUOI corriger.
const PROFILE_SAVE_ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "Votre session a expiré — reconnectez-vous puis réessayez.",
  invalid_payload: "Le domaine principal doit contenir au moins 2 caractères, et le tarif indicatif (si renseigné) doit être positif.",
  profile_below_minimum_age: "Ce profil ne peut pas être activé : l'âge minimum requis pour ce type de mission n'est pas atteint.",
  not_found: "Compte introuvable — reconnectez-vous puis réessayez.",
};

// Raisons d'échec pour l'ajout/la modification d'un garant.
const GARANT_ERROR_MESSAGES: Record<string, string> = {
  duplicate_garant_tel: "Ce numéro est déjà utilisé par un autre de vos garants.",
  max_garants_reached: "Maximum 3 garants (1 obligatoire + 2 optionnelles) atteint.",
  invalid_payload: "Nom et téléphone sont requis (téléphone : 8 à 20 caractères).",
  profile_required: "Complétez d'abord le domaine d'intervention ci-dessus.",
  not_found: "Ce garant n'existe plus — la liste a été actualisée.",
};

// Profil prestataire aligné sur formulaires-flexwork-tous-profils.html.
// Secteur (BTP / AUTRES) et mode de devis BTP retirés (2026-08-29) : le sélecteur de mode
// n'avait jamais été relié à un champ réel (ni Profile.modeDevis en base, ni profileSchema
// — silencieusement jeté par le parsing zod à chaque enregistrement, donc jamais persisté).
// Profile.sector existe toujours en base mais n'est plus exposé dans ce formulaire.
export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [garants, setGarants] = useState<Garant[]>([]);
  const [garantMsg, setGarantMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editingGarantId, setEditingGarantId] = useState<string | null>(null);
  const [editNom, setEditNom] = useState("");
  const [editTel, setEditTel] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  // Portfolio (photos de chantiers) + CV — téléversés dans le bucket "portfolio", référencés
  // par leur relPath dans Profile.portfolioUrls / Profile.cvUrl, servis par
  // GET /api/profile/portfolio-file. Sauvegardés avec le reste du profil (POST /api/profile).
  const [portfolioUrls, setPortfolioUrls] = useState<string[]>([]);
  const [cvUrl, setCvUrl] = useState<string | null>(null);
  const [portfolioMsg, setPortfolioMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [portfolioUploading, setPortfolioUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);

  // Présent quand on arrive ici depuis une candidature bloquée par un profil incomplet
  // (garant obligatoire ou assurance manquante, voir DevisForm) — lu via window.location
  // plutôt que useSearchParams pour rester un simple useEffect, sans exiger de Suspense
  // boundary pour cette seule lecture ponctuelle.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  }, []);

  // Retour automatique vers la candidature dès que la condition qui bloquait (garant
  // obligatoire manquant) est satisfaite — plus besoin de cliquer sur le bouton une fois le
  // garant ajouté. Se redéclenche à chaque changement de `garants` (donc aussi si la liste
  // était déjà valide au chargement, ex. retour sur cette page après coup). Un court délai
  // (pas une redirection instantanée) laisse le temps de voir le message de confirmation
  // plutôt qu'un bond de page immédiat et déroutant. Ne couvre que le garant : l'assurance
  // RC Pro (autre motif de blocage possible) n'a pas encore de section dédiée sur cette page.
  //
  // ⚠️ Le garde anti-relance est un useRef, PAS le state `autoReturning` mis dans les deps :
  // en dépendances, `setAutoReturning(true)` redéclenchait CET EFFET LUI-MÊME, dont le
  // nettoyage (clearTimeout) s'exécutait avant la ré-invocation — annulant le minuteur
  // qu'on venait juste de programmer, avant même qu'il n'ait eu la moindre chance de se
  // déclencher. Résultat vérifié : la bannière passait bien à l'état "en cours" (masquant
  // le bouton manuel), mais aucune redirection n'avait jamais lieu — ni automatique, ni
  // via le bouton, devenu invisible entre-temps. Un ref ne fait pas partie des
  // dépendances : le modifier ne redéclenche jamais l'effet.
  const [autoReturning, setAutoReturning] = useState(false);
  const redirectStartedRef = useRef(false);
  useEffect(() => {
    if (!returnTo || redirectStartedRef.current || !hasRequiredGarants(garants)) return;
    redirectStartedRef.current = true;
    setAutoReturning(true);
    const timer = setTimeout(() => router.push(returnTo), 1500);
    return () => clearTimeout(timer);
  }, [returnTo, garants, router]);

  // Photo de profil — affichée ensuite dans la navbar, le bas de la sidebar, et les cartes
  // de mission/candidature (voir src/components/avatar.tsx).
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        setProfile(p);
        setPortfolioUrls(p?.portfolioUrls ?? []);
        setCvUrl(p?.cvUrl ?? null);
      })
      .finally(() => setLoading(false));
    fetch("/api/profile/garants")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setGarants(d.items ?? []));
    fetch("/api/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setIdentity);
  }, []);

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de resélectionner le même fichier ensuite si besoin
    if (!file) return;
    setAvatarUploading(true);
    setAvatarMsg(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/profile/avatar", { method: "POST", body: formData });
    setAvatarUploading(false);
    if (res.ok) {
      const data = await res.json();
      setIdentity((prev) => (prev ? { ...prev, avatarUrl: data.avatarUrl } : prev));
      setAvatarMsg({ text: "Photo de profil mise à jour.", ok: true });
    } else {
      const data = await res.json().catch(() => ({}));
      const text =
        data.error === "unsupported_file_type" ? "Format non supporté — JPG, PNG ou WEBP uniquement."
        : data.error === "file_too_large" ? "Fichier trop volumineux — 2 Mo maximum."
        : "Échec de l'envoi de la photo.";
      setAvatarMsg({ text, ok: false });
    }
  }

  async function handleAvatarRemove() {
    setAvatarUploading(true);
    setAvatarMsg(null);
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    setAvatarUploading(false);
    if (res.ok) {
      setIdentity((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
      setAvatarMsg({ text: "Photo de profil retirée.", ok: true });
    } else {
      setAvatarMsg({ text: "Échec de la suppression.", ok: false });
    }
  }

  function portfolioFileUrl(relPath: string): string {
    return `/api/profile/portfolio-file?p=${encodeURIComponent(relPath)}`;
  }

  async function handlePortfolioPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setPortfolioUploading(true);
    setPortfolioMsg(null);
    const newPaths: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("kind", "photo");
      formData.append("file", file);
      const res = await fetch("/api/profile/portfolio", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        newPaths.push(data.relPath);
      } else {
        const d = await res.json().catch(() => ({}));
        setPortfolioMsg({
          text:
            d.error === "file_too_large"
              ? "Photo trop volumineuse — 5 Mo maximum."
              : d.error === "unsupported_file_type"
              ? "Format non supporté — JPG, PNG ou WEBP uniquement."
              : "Échec de l'envoi d'une photo.",
          ok: false,
        });
      }
    }
    setPortfolioUploading(false);
    if (newPaths.length) {
      setPortfolioUrls((prev) => [...prev, ...newPaths].slice(0, 10));
      setPortfolioMsg({ text: `${newPaths.length} photo(s) ajoutée(s) — pensez à enregistrer le profil.`, ok: true });
    }
  }

  async function handleCvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPortfolioUploading(true);
    setPortfolioMsg(null);
    const formData = new FormData();
    formData.append("kind", "cv");
    formData.append("file", file);
    const res = await fetch("/api/profile/portfolio", { method: "POST", body: formData });
    setPortfolioUploading(false);
    if (res.ok) {
      const data = await res.json();
      setCvUrl(data.relPath);
      setPortfolioMsg({ text: "CV ajouté — pensez à enregistrer le profil.", ok: true });
    } else {
      const d = await res.json().catch(() => ({}));
      setPortfolioMsg({
        text: d.error === "file_too_large" ? "CV trop volumineux — 10 Mo maximum." : "Échec de l'envoi du CV (PDF uniquement).",
        ok: false,
      });
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      mainDomain: form.get("mainDomain"),
      subSpecialty: form.get("subSpecialty") || undefined,
      secondaryDomain: form.get("secondaryDomain") || undefined,
      indicativeRate: form.get("indicativeRate")
        ? Number(form.get("indicativeRate"))
        : undefined,
      // Portfolio & CV : relPaths téléversés (ou URLs externes conservées) — persistés avec
      // le reste du profil.
      portfolioUrls: portfolioUrls.length ? portfolioUrls : undefined,
      cvUrl: cvUrl ?? undefined,
    };
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setMsg({ text: "Profil enregistré.", ok: true });
      // Seul mécanisme de redirection post-enregistrement : returnTo (voir le useEffect
      // ci-dessus), qui ramène l'utilisateur vers SA candidature bloquée une fois le garant
      // obligatoire satisfait. Pas de redirection fixe vers une mission arbitraire.
      return;
    }
    const data = await res.json().catch(() => ({}));
    const text =
      PROFILE_SAVE_ERROR_MESSAGES[data.error]
      ?? (res.status >= 500 ? "Erreur serveur inattendue — réessayez dans un instant." : "Échec de l'enregistrement.");
    setMsg({ text, ok: false });
  }

  async function handleAddGarant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Capturé AVANT le await : React vide `e.currentTarget` (le remet à null) une fois la
    // phase synchrone du gestionnaire d'événement terminée — après un `await`, e.currentTarget
    // vaut donc déjà null et `.reset()` dessus levait "null is not an object". La référence
    // DOM elle-même capturée ici reste valide même si le formulaire est démonté entre-temps
    // (ex. 3ᵉ garant ajouté → la carte d'ajout disparaît) : .reset() sur un nœud détaché ne
    // fait simplement rien, sans lever d'erreur.
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const res = await fetch("/api/profile/garants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: form.get("nom"), tel: form.get("tel") }),
    });
    if (res.ok) {
      const garant = await res.json();
      setGarants((prev) => [...prev, garant]);
      setGarantMsg(null);
      formEl.reset();
    } else {
      const data = await res.json().catch(() => ({}));
      setGarantMsg({ text: GARANT_ERROR_MESSAGES[data.error] ?? "Échec de l'ajout du garant.", ok: false });
    }
  }

  function startEditGarant(g: Garant) {
    setGarantMsg(null);
    setEditingGarantId(g.id);
    setEditNom(g.nom);
    setEditTel(g.tel);
  }

  function cancelEditGarant() {
    setEditingGarantId(null);
  }

  async function saveEditGarant(id: string) {
    setGarantMsg(null);
    const res = await fetch(`/api/profile/garants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: editNom.trim(), tel: editTel.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setGarants((prev) => prev.map((g) => (g.id === id ? updated : g)));
      setEditingGarantId(null);
    } else {
      const data = await res.json().catch(() => ({}));
      setGarantMsg({ text: GARANT_ERROR_MESSAGES[data.error] ?? "Échec de la modification.", ok: false });
    }
  }

  async function deleteGarant(g: Garant) {
    if (!window.confirm(`Supprimer le garant « ${g.nom} » ?`)) return;
    setGarantMsg(null);
    const res = await fetch(`/api/profile/garants/${g.id}`, { method: "DELETE" });
    if (res.ok) {
      // Réactualisé depuis le serveur plutôt qu'un simple filter local : la suppression du
      // garant obligatoire promeut automatiquement le plus ancien restant côté serveur (voir
      // DELETE dans src/app/api/profile/garants/[id]/route.ts) — un filter local laisserait
      // l'UI afficher un état "obligatoire" périmé jusqu'au prochain rechargement.
      const list = await fetch("/api/profile/garants").then((r) => (r.ok ? r.json() : { items: [] }));
      setGarants(list.items ?? []);
    } else {
      const data = await res.json().catch(() => ({}));
      setGarantMsg({ text: GARANT_ERROR_MESSAGES[data.error] ?? "Échec de la suppression.", ok: false });
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <div className="text-[14px] text-zinc-500">Chargement...</div>
    </div>
  );

  const inputClass = "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition";
  const btnSecondary = "h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 transition";

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[700px] space-y-5">
        {returnTo && (
          autoReturning ? (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-[13px] text-emerald-900">
              <p className="font-semibold">✓ Garant ajouté — retour à votre candidature...</p>
              <p className="mt-1">Votre devis vous attend, restauré tel quel.</p>
              {/* Filet de sécurité, toujours cliquable : ne dépend pas du minuteur de
                  redirection automatique ci-dessus au cas où il échouerait. */}
              <Link href={returnTo} className="mt-3 inline-block rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700">
                Y aller maintenant
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
              <p className="font-semibold">Complétez votre profil pour reprendre votre candidature.</p>
              <p className="mt-1">
                Ajoutez au moins un garant obligatoire ci-dessous (et une assurance déclarée si la mission l&apos;exige) :
                vous serez ramené automatiquement à votre candidature dès que le garant obligatoire est enregistré. Votre
                devis a été conservé comme brouillon et vous attend.
              </p>
              <Link href={returnTo} className="mt-3 inline-block rounded-full bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-amber-700">
                Retourner à ma candidature maintenant
              </Link>
            </div>
          )
        )}

        {/* Photo de profil */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100">
            <h2 className="text-[15px] font-bold text-zinc-900">Photo de profil</h2>
          </div>
          {avatarMsg && (
            <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-[13px] font-medium ${avatarMsg.ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {avatarMsg.text}
            </div>
          )}
          <div className="px-6 py-5 flex items-center gap-5">
            <Avatar
              src={identity?.avatarUrl}
              initials={identity ? initialsOf(identity.firstname, identity.lastname) : "?"}
              size={72}
              gradient="from-[#008751] to-[#FCD116]"
            />
            <div className="flex-1 space-y-2">
              <p className="text-[12px] text-zinc-500">
                Visible dans le menu, les cartes de mission et de candidature. JPG, PNG ou WEBP — 2 Mo max.
              </p>
              <div className="flex items-center gap-3">
                <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarSelect} className="hidden" />
                <button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} className={btnSecondary + " disabled:opacity-50 disabled:cursor-not-allowed"}>
                  {avatarUploading ? "Envoi..." : identity?.avatarUrl ? "Changer la photo" : "Ajouter une photo"}
                </button>
                {identity?.avatarUrl && (
                  <button type="button" disabled={avatarUploading} onClick={handleAvatarRemove} className="text-[13px] font-medium text-red-600 hover:underline disabled:opacity-50">
                    Retirer
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Domaine d'intervention */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Domaine d&apos;intervention</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaratif</span>
          </div>
          {msg && (
            <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-[13px] font-medium ${msg.ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {msg.text}
            </div>
          )}
          <form id="profile-form" onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Domaine principal <span className="text-[#E8112D]">*</span></label>
              <input type="text" name="mainDomain" required defaultValue={profile?.mainDomain ?? ""} placeholder="Plomberie, Développement web..." className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Sous-spécialité</label>
                <input type="text" name="subSpecialty" defaultValue={profile?.subSpecialty ?? ""} placeholder="Ex : Chauffage / Sanitaire" className={inputClass} />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Domaine secondaire</label>
                <input type="text" name="secondaryDomain" defaultValue={profile?.secondaryDomain ?? ""} placeholder="Ex : Électricité" className={inputClass} />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Tarif indicatif (XOF / jour)</label>
              <input type="number" name="indicativeRate" defaultValue={profile?.indicativeRate ?? ""} className={inputClass} />
            </div>
          </form>
        </div>

        {/* Portfolio & CV — photos de chantiers + CV téléversés (bucket "portfolio"), servis
            par GET /api/profile/portfolio-file. Déclaratif : visible sur le profil public,
            non vérifié par la plateforme. */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Portfolio & CV</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaratif</span>
          </div>
          {portfolioMsg && (
            <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-[13px] font-medium ${portfolioMsg.ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {portfolioMsg.text}
            </div>
          )}
          <div className="px-6 py-5 space-y-5">
            <div>
              <p className="text-[13px] font-semibold text-zinc-700 mb-1.5">Photos de chantiers / réalisations</p>
              <p className="text-[12px] text-zinc-500 mb-3">JPG, PNG ou WEBP — 5 Mo max par photo, jusqu&apos;à 10 éléments. Visible par les clients sur votre profil public.</p>
              {portfolioUrls.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-3">
                  {portfolioUrls.map((rel) => (
                    <div key={rel} className="relative aspect-[4/3] rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100">
                      {/* eslint-disable-next-line @next/next/no-img-element -- source authentifiée (relPath du bucket portfolio), pas un asset optimisable */}
                      <img src={portfolioFileUrl(rel)} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPortfolioUrls((prev) => prev.filter((x) => x !== rel))}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-[12px] flex items-center justify-center hover:bg-black/80"
                        aria-label="Retirer la photo"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handlePortfolioPhotos} className="hidden" />
              <button type="button" disabled={portfolioUploading} onClick={() => photoInputRef.current?.click()} className={btnSecondary + " disabled:opacity-50 disabled:cursor-not-allowed"}>
                {portfolioUploading ? "Envoi..." : "Ajouter des photos"}
              </button>
            </div>

            <div className="border-t border-zinc-100 pt-5">
              <p className="text-[13px] font-semibold text-zinc-700 mb-1.5">CV</p>
              <p className="text-[12px] text-zinc-500 mb-3">PDF uniquement — 10 Mo max.</p>
              {cvUrl ? (
                <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <span className="text-[13px] font-medium text-zinc-700">📄 CV enregistré</span>
                  <a href={portfolioFileUrl(cvUrl)} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-[#008751] hover:underline">Voir</a>
                  <button type="button" onClick={() => setCvUrl(null)} className="text-[13px] font-medium text-red-600 hover:underline">Retirer</button>
                </div>
              ) : (
                <>
                  <input ref={cvInputRef} type="file" accept="application/pdf" onChange={handleCvUpload} className="hidden" />
                  <button type="button" disabled={portfolioUploading} onClick={() => cvInputRef.current?.click()} className={btnSecondary + " disabled:opacity-50 disabled:cursor-not-allowed"}>
                    {portfolioUploading ? "Envoi..." : "Ajouter un CV"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Garants */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Personnes ressources (garants)</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">1 obligatoire + 2 optionnelles</span>
          </div>
          <div className="px-6 py-5 space-y-4">
            {garantMsg && (
              <div className={`px-4 py-3 rounded-xl text-[13px] font-medium ${garantMsg.ok ? "bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]" : "bg-red-50 border border-red-200 text-red-700"}`}>
                {garantMsg.text}
              </div>
            )}
            {garants.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="bg-zinc-50 text-zinc-500 text-[11px] font-semibold uppercase tracking-wider"><th className="text-left px-4 py-2.5">Nom</th><th className="text-left px-4 py-2.5">Téléphone</th><th className="text-left px-4 py-2.5">Statut</th><th className="text-left px-4 py-2.5">Actions</th></tr></thead>
                  <tbody>
                    {garants.map((g) => {
                      const isEditing = editingGarantId === g.id;
                      return (
                        <tr key={g.id} className="border-t border-zinc-100">
                          {isEditing ? (
                            <>
                              <td className="px-4 py-2"><input value={editNom} onChange={(e) => setEditNom(e.target.value)} className={inputClass + " h-9"} /></td>
                              <td className="px-4 py-2"><input type="tel" value={editTel} onChange={(e) => setEditTel(e.target.value)} className={inputClass + " h-9"} /></td>
                              <td className="px-4 py-2.5">
                                <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${g.obligatoire ? "bg-[#f0fdf4] text-[#166534]" : "bg-zinc-100 text-zinc-500"}`}>
                                  {g.obligatoire ? "Obligatoire" : "Optionnelle"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex gap-3">
                                  <button type="button" onClick={() => saveEditGarant(g.id)} className="text-[13px] font-semibold text-[#008751] hover:underline">Enregistrer</button>
                                  <button type="button" onClick={cancelEditGarant} className="text-[13px] font-medium text-zinc-500 hover:underline">Annuler</button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-2.5">{g.nom}</td>
                              <td className="px-4 py-2.5">{g.tel}</td>
                              <td className="px-4 py-2.5">
                                <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${g.obligatoire ? "bg-[#f0fdf4] text-[#166534]" : "bg-zinc-100 text-zinc-500"}`}>
                                  {g.obligatoire ? "Obligatoire" : "Optionnelle"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex gap-3">
                                  <button type="button" onClick={() => startEditGarant(g)} className="text-[13px] font-medium text-zinc-600 hover:underline">Modifier</button>
                                  <button type="button" onClick={() => deleteGarant(g)} className="text-[13px] font-medium text-red-600 hover:underline">Supprimer</button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Un garant est rattaché au Profile (Garant.profileId, non nullable) — tant que
                "Domaine d'intervention" n'a jamais été enregistré (aucun Profile en base
                pour ce compte), POST /api/profile/garants renvoie 409 "profile_required"
                (message affiché via garantMsg ci-dessus). On l'annonce ici, avant la
                tentative, plutôt que de laisser un prestataire remplir nom/téléphone pour
                découvrir la dépendance seulement après un échec. Même code couleur (ambre)
                que le blocage profil incomplet sur la page mission
                (src/app/missions/[id]/page.tsx, blockedByProfile). */}
            {!profile?.mainDomain ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
                Complétez et enregistrez d&apos;abord le domaine d&apos;intervention ci-dessus pour pouvoir ajouter un garant.
              </div>
            ) : garants.length < 3 && (
              <form onSubmit={handleAddGarant} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Nom</label>
                    <input type="text" name="nom" required className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Téléphone</label>
                    <input type="tel" name="tel" required className={inputClass} />
                  </div>
                </div>
                <button type="submit" className={btnSecondary}>Ajouter</button>
              </form>
            )}
          </div>
        </div>

        {/* Rattaché au formulaire "Domaine d'intervention" via l'attribut HTML form= (pas de
            JS supplémentaire) : peut être positionné n'importe où dans le DOM, ici en bas de
            page, tout en soumettant bien ce formulaire-là au clic. */}
        <div className="flex justify-end">
          <button type="submit" form="profile-form" className={btnPrimary}>Enregistrer les modifications</button>
        </div>
      </div>
    </div>
  );
}
