"use client";

// Éditeur « Portfolio et CV » (2026-11-08) — photos de réalisations, liens externes, CV PDF.
//
// Extrait de l'onglet Expérience, où il était le quatrième bloc d'un long formulaire : en
// modification de profil, personne ne le retrouvait. Il est désormais une RUBRIQUE à part de la
// vue « profil complet » (/profile), et reste aussi dans l'étape Expérience du parcours guidé.
//
// Chaque action s'enregistre aussitôt (POST /api/profile) : un fichier téléversé ne compte pour
// le profil qu'une fois sa référence enregistrée. Les fichiers sont servis par
// /api/profile/portfolio-file, qui contrôle l'accès.

import { useRef, useState } from "react";
import { btnSecondary, inputClass, type ProviderProfile } from "@/components/profile/profile-shared";

export const PORTFOLIO_MAX = 10;

export const isExternalLink = (u: string) => /^https?:\/\//i.test(u);
export const portfolioFileUrl = (relPath: string) => `/api/profile/portfolio-file?p=${encodeURIComponent(relPath)}`;
/** Nom lisible d'un fichier téléversé : « portfolio/<id>/<uuid>-chantier.png » → « chantier.png ». */
export const portfolioFileName = (relPath: string) => relPath.split("/").pop()?.replace(/^[0-9a-f-]{36}-/i, "") ?? relPath;

export function PortfolioEditor({ profile, onSaved }: { profile: ProviderProfile | null; onSaved: (p: ProviderProfile) => void }) {
  const [urls, setUrls] = useState<string[]>(profile?.portfolioUrls ?? []);
  const [cvUrl, setCvUrl] = useState<string | null>(profile?.cvUrl ?? null);
  const [linkDraft, setLinkDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLInputElement>(null);

  const photos = urls.filter((u) => !isExternalLink(u));
  const links = urls.filter(isExternalLink);
  const full = urls.length >= PORTFOLIO_MAX;

  async function save(nextUrls: string[], nextCv: string | null, okText: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolioUrls: nextUrls, cvUrl: nextCv }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setUrls(nextUrls);
      setCvUrl(nextCv);
      onSaved(await res.json());
      setMsg({ text: okText, ok: true });
      return true;
    }
    setMsg({ text: "Échec de l'enregistrement. Réessayez.", ok: false });
    return false;
  }

  async function upload(kind: "photo" | "cv", e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, kind === "photo" ? PORTFOLIO_MAX - urls.length : 1);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    const added: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", file);
      const res = await fetch("/api/profile/portfolio", { method: "POST", body: formData }).catch(() => null);
      if (res?.ok) added.push((await res.json()).relPath);
    }
    setBusy(false);
    if (!added.length) {
      setMsg({ text: "Échec de l'envoi : vérifiez le format (JPG, PNG, WEBP ou PDF) et la taille du fichier.", ok: false });
      return;
    }
    if (kind === "cv") await save(urls, added[0], "CV enregistré.");
    else await save([...urls, ...added].slice(0, PORTFOLIO_MAX), cvUrl, `${added.length} photo(s) ajoutée(s).`);
  }

  function addLink() {
    const url = linkDraft.trim();
    if (!isExternalLink(url)) {
      setMsg({ text: "Un lien doit commencer par https:// (ou http://).", ok: false });
      return;
    }
    void save([...urls, url].slice(0, PORTFOLIO_MAX), cvUrl, "Lien ajouté.").then((ok) => ok && setLinkDraft(""));
  }

  return (
    <div className="space-y-5">
      {/* Photos de réalisations */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-medium text-zinc-700">
            Photos de réalisations <span className="text-[12px] font-normal text-zinc-400">({urls.length}/{PORTFOLIO_MAX} éléments)</span>
          </p>
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => upload("photo", e)}
          />
          <button type="button" disabled={busy || full} className={`${btnSecondary} disabled:opacity-50`} onClick={() => photoRef.current?.click()}>
            + Ajouter des photos
          </button>
        </div>
        {photos.length > 0 ? (
          <ul className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {photos.map((p) => (
              <li key={p} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                {/* eslint-disable-next-line @next/next/no-img-element -- fichier servi par une route authentifiée */}
                <img src={portfolioFileUrl(p)} alt={portfolioFileName(p)} className="h-full w-full object-cover" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(urls.filter((u) => u !== p), cvUrl, "Photo retirée.")}
                  aria-label={`Retirer ${portfolioFileName(p)}`}
                  className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-red-600 shadow-sm hover:bg-white"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-400">Aucune photo pour l&apos;instant. JPG, PNG ou WEBP.</p>
        )}
      </div>

      {/* Liens externes */}
      <div>
        <p className="text-[14px] font-medium text-zinc-700">Liens (Behance, GitHub, site, vidéo…)</p>
        <div className="mt-2 flex gap-2">
          <input
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (linkDraft.trim() && !busy && !full) addLink();
              }
            }}
            maxLength={500}
            className={inputClass}
            placeholder="https://..."
            aria-label="Lien vers une réalisation"
          />
          <button
            type="button"
            disabled={busy || full || !linkDraft.trim()}
            className={`${btnSecondary} whitespace-nowrap disabled:opacity-50`}
            onClick={addLink}
          >
            Ajouter
          </button>
        </div>
        {links.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {links.map((url) => (
              <li key={url} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2">
                <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-[13px] text-[#008751] hover:underline">
                  {url}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(urls.filter((u) => u !== url), cvUrl, "Lien retiré.")}
                  className="shrink-0 text-[12px] text-red-500 hover:underline"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CV */}
      <div>
        <p className="text-[14px] font-medium text-zinc-700">CV (PDF)</p>
        <input ref={cvRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload("cv", e)} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {cvUrl ? (
            <>
              <a
                href={portfolioFileUrl(cvUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-[13px] text-[#0A1931] hover:underline"
              >
                📄 {portfolioFileName(cvUrl)}
              </a>
              <button type="button" disabled={busy} className={btnSecondary} onClick={() => cvRef.current?.click()}>
                Remplacer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(urls, null, "CV retiré.")}
                className="text-[12px] text-red-500 hover:underline"
              >
                Retirer le CV
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} className={btnSecondary} onClick={() => cvRef.current?.click()}>
              + Ajouter un CV
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-zinc-500">
          Visible des seuls utilisateurs connectés : un CV contient souvent votre adresse et votre téléphone.
        </p>
      </div>

      {msg && (
        <p role="status" className={`text-[12px] ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
