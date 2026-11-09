"use client";

// Éditeur de Gig (2026-11-08) — création et modification, partagé par le profil (/profile,
// rubrique « Mes services ») et la rubrique Offres du tableau de bord.
//
// Il suit le guide de rédaction d'un Gig, affiché en checklist à côté du formulaire :
//   titre « Je vais + bénéfice » · 3 formules à prix progressifs (inclus, délai, révisions) ·
//   description claire · visuel (couverture ou vidéo) · mots-clés.
// Les règles sont celles du serveur (src/lib/gig-rules.ts) : la checklist dit ce que l'API
// refusera, avant l'envoi.
//
// L'image de couverture se téléverse sur un Gig existant (elle a besoin de son id) : pour un
// nouveau Gig, elle est choisie ici, puis envoyée juste après la création.

import { useMemo, useRef, useState } from "react";
import {
  GIG_IMAGES_MAX,
  GIG_IMAGE_MAX_BYTES,
  GIG_IMAGE_TYPES,
  GIG_DESCRIPTION_MAX,
  GIG_DESCRIPTION_MIN,
  GIG_PACKAGE_DESCRIPTION_MAX,
  GIG_REVISIONS_MAX,
  GIG_TAGS_MAX,
  GIG_TIER_LABELS,
  GIG_TIERS,
  GIG_TITLE_MAX,
  GIG_TITLE_PREFIX,
  gigInputSchema,
  normalizeGigTags,
  publishChecklist,
  videoEmbedUrl,
  type GigTier,
} from "@/lib/gig-rules";
import type { GigView } from "@/lib/gig-serialize";

type PackageDraft = { tier: GigTier; titre: string; description: string; prix: string; delaiJours: string; revisions: string };

const INPUT =
  "w-full h-10 px-3 rounded-xl border border-zinc-200 bg-white text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
const TEXTAREA =
  "w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
const LABEL = "block text-[13px] font-semibold text-zinc-700 mb-1.5";

const PACKAGE_PLACEHOLDERS: Record<GigTier, { titre: string; description: string }> = {
  basique: { titre: "Ex. Logo simple", description: "Ex. 1 proposition, fichier PNG haute définition." },
  standard: { titre: "Ex. Logo + charte", description: "Ex. 2 propositions, charte couleurs, PNG et SVG." },
  premium: { titre: "Ex. Identité complète", description: "Ex. 3 propositions, charte, cartes de visite, réseaux sociaux." },
};

function initialPackages(gig?: GigView | null): PackageDraft[] {
  return GIG_TIERS.map((tier) => {
    const p = gig?.packages.find((x) => x.tier === tier);
    return {
      tier,
      titre: p?.titre ?? "",
      description: p?.description ?? "",
      prix: p ? String(p.prix) : "",
      delaiJours: p ? String(p.delaiJours) : "",
      revisions: p ? String(p.revisions) : tier === "basique" ? "1" : tier === "standard" ? "2" : "3",
    };
  });
}

export function GigEditor({
  gig,
  defaultDomaine,
  onSaved,
  onCancel,
}: {
  gig?: GigView | null;
  defaultDomaine?: string | null;
  onSaved: (gigId: string) => void;
  onCancel: () => void;
}) {
  const [benefice, setBenefice] = useState(gig ? gig.titre.replace(/^Je vais /, "") : "");
  const [description, setDescription] = useState(gig?.description ?? "");
  const [domaine, setDomaine] = useState(gig?.domaine ?? defaultDomaine ?? "");
  const [packages, setPackages] = useState<PackageDraft[]>(() => initialPackages(gig));
  const [tags, setTags] = useState<string[]>(gig?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [videoUrl, setVideoUrl] = useState(gig?.videoUrl ?? "");
  // Photos (3 au plus, la première = couverture). Service existant : chaque action part tout
  // de suite au serveur. Nouveau service : les photos attendent la création (`pending`), puis
  // sont envoyées dans l'ordre choisi.
  const [savedImages, setSavedImages] = useState<string[]>(gig?.images ?? []);
  const [pending, setPending] = useState<{ file: File; preview: string }[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoCount = savedImages.length + pending.length;

  const titre = `${GIG_TITLE_PREFIX}${benefice.trim()}`;
  const payload = useMemo(
    () => ({
      titre,
      description,
      domaine,
      tags,
      videoUrl: videoUrl.trim() || null,
      packages: packages.map((p) => ({
        tier: p.tier,
        titre: p.titre,
        description: p.description,
        prix: Number(p.prix),
        delaiJours: Number(p.delaiJours),
        revisions: Number(p.revisions),
      })),
    }),
    [titre, description, domaine, tags, videoUrl, packages],
  );
  const parsed = gigInputSchema.safeParse(payload);
  const packagesOk =
    payload.packages.every((p) => p.titre.trim().length >= 3 && p.description.trim().length >= 10 && p.prix > 0 && p.delaiJours >= 1) &&
    payload.packages[0].prix < payload.packages[1].prix &&
    payload.packages[1].prix < payload.packages[2].prix;
  const checklist = publishChecklist({
    titre,
    description,
    tags,
    packagesValid: packagesOk,
    hasImage: photoCount > 0,
    hasVideo: !!videoEmbedUrl(videoUrl),
  });
  const ready = checklist.every((c) => c.done) && parsed.success && domaine.trim().length >= 2;
  const embed = videoEmbedUrl(videoUrl);

  function setPackage(i: number, field: keyof PackageDraft, value: string) {
    setPackages((prev) => prev.map((p, j) => (j === i ? { ...p, [field]: value } : p)));
  }

  function addTag() {
    const next = normalizeGigTags([...tags, ...tagDraft.split(",")]).slice(0, GIG_TAGS_MAX);
    setTags(next);
    setTagDraft("");
  }

  async function uploadPhoto(gigId: string, file: File): Promise<string[] | null> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/gigs/${gigId}/images`, { method: "POST", body: form }).catch(() => null);
    if (!res?.ok) {
      setError((await res?.json().catch(() => null))?.message ?? "La photo n'a pas pu être envoyée.");
      return null;
    }
    return (await res.json()).images as string[];
  }

  async function pickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError(null);
    const room = GIG_IMAGES_MAX - photoCount;
    const valid: File[] = [];
    for (const f of files) {
      if (!GIG_IMAGE_TYPES[f.type]) setError("Photo JPG, PNG ou WEBP uniquement.");
      else if (f.size > GIG_IMAGE_MAX_BYTES) setError("Photo de 5 Mo maximum.");
      else valid.push(f);
    }
    if (valid.length > room) setError(`${GIG_IMAGES_MAX} photos maximum : les suivantes sont ignorées.`);
    const kept = valid.slice(0, room);
    if (!kept.length) return;
    if (!gig) {
      setPending((prev) => [...prev, ...kept.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
      return;
    }
    setPhotoBusy(true);
    for (const file of kept) {
      const images = await uploadPhoto(gig.id, file);
      if (!images) break;
      setSavedImages(images);
    }
    setPhotoBusy(false);
  }

  async function removePhoto(i: number) {
    setError(null);
    if (i >= savedImages.length) {
      setPending((prev) => prev.filter((_, j) => j !== i - savedImages.length));
      return;
    }
    if (!gig) return;
    setPhotoBusy(true);
    const res = await fetch(`/api/gigs/${gig.id}/images/${i}`, { method: "DELETE" }).catch(() => null);
    setPhotoBusy(false);
    if (res?.ok) setSavedImages((await res.json()).images);
    else setError((await res?.json().catch(() => null))?.message ?? "Impossible de retirer la photo.");
  }

  /** La photo `i` devient la couverture (première). */
  async function makeFirst(i: number) {
    setError(null);
    if (i >= savedImages.length) {
      const j = i - savedImages.length;
      setPending((prev) => [prev[j], ...prev.filter((_, k) => k !== j)]);
      return;
    }
    if (!gig) return;
    const order = [i, ...savedImages.map((_, k) => k).filter((k) => k !== i)];
    setPhotoBusy(true);
    const res = await fetch(`/api/gigs/${gig.id}/images`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }).catch(() => null);
    setPhotoBusy(false);
    if (res?.ok) setSavedImages((await res.json()).images);
    else setError("Impossible de changer la photo de couverture.");
  }

  async function save(publish: boolean) {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Gig incomplet.");
      return;
    }
    setSaving(true);
    // Les photos d'un nouveau service n'existent qu'après sa création : on crée en brouillon, on
    // téléverse, puis on publie — sinon la publication serait refusée faute de visuel.
    // Publiable d'emblée si un visuel existe DÉJÀ côté serveur (photo enregistrée ou vidéo).
    const publishNow = publish && (savedImages.length > 0 || !!embed);
    const body = { ...payload, status: publishNow ? "publie" : "brouillon" };
    const res = await fetch(gig ? `/api/gigs/${gig.id}` : "/api/gigs", {
      method: gig ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setSaving(false);
      setError(data?.message ?? "Enregistrement impossible. Réessayez.");
      return;
    }
    const gigId: string = gig?.id ?? data.id;
    for (const p of pending) {
      if (!(await uploadPhoto(gigId, p.file))) {
        setSaving(false);
        setError("Service enregistré, mais une photo n'a pas pu être envoyée. Réessayez depuis « Modifier ».");
        return;
      }
    }
    setPending([]);
    if (publish && !publishNow) {
      const pub = await fetch(`/api/gigs/${gigId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "publie" }),
      }).catch(() => null);
      if (!pub?.ok) {
        setSaving(false);
        setError((await pub?.json().catch(() => null))?.message ?? "Gig enregistré en brouillon : publication impossible.");
        return;
      }
    }
    setSaving(false);
    onSaved(gigId);
  }

  const photos = [...savedImages, ...pending.map((p) => p.preview)];

  return (
    <div className="space-y-5">
      {/* Checklist du guide — en tête, sur une ligne qui se replie : l'éditeur vit aussi dans la
          colonne étroite du profil, où une colonne latérale écrasait le formulaire. */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-[13px] font-bold text-[#0A1931]">Un service qui se vend</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5 text-[13px]">
              <span
                aria-hidden
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  c.done ? "bg-[#008751] text-white" : "border border-zinc-300 text-transparent"
                }`}
              >
                ✓
              </span>
              <span className={c.done ? "text-zinc-700" : "text-zinc-500"}>
                {c.label}
                <span className="sr-only">{c.done ? " : fait" : " : à faire"}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-zinc-500">Brouillon possible à tout moment ; la publication demande les cinq points.</p>
      </div>
      <div className="space-y-6 min-w-0">
        {/* Titre */}
        <div>
          <label htmlFor="gig-titre" className={LABEL}>
            Titre du service <span className="text-[#E8112D]">*</span>
          </label>
          <div className="flex items-center rounded-xl border border-zinc-200 bg-white focus-within:ring-2 focus-within:ring-[#008751]/20 focus-within:border-[#008751]">
            <span className="pl-3 pr-1 text-[14px] font-semibold text-[#0A1931] whitespace-nowrap">Je vais</span>
            <input
              id="gig-titre"
              value={benefice}
              onChange={(e) => setBenefice(e.target.value.replace(/^je vais /i, ""))}
              maxLength={GIG_TITLE_MAX - GIG_TITLE_PREFIX.length}
              placeholder="créer un logo professionnel qui fait vendre"
              className="h-10 flex-1 min-w-0 bg-transparent pr-3 text-[14px] focus:outline-none"
            />
          </div>
          <p className="mt-1 text-[12px] text-zinc-500">
            Le bénéfice concret pour le client, pas le nom de votre métier. {titre.length}/{GIG_TITLE_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="gig-domaine" className={LABEL}>
            Domaine <span className="text-[#E8112D]">*</span>
          </label>
          <input id="gig-domaine" value={domaine} onChange={(e) => setDomaine(e.target.value)} maxLength={80} className={INPUT} placeholder="Ex. Design graphique" />
        </div>

        {/* Formules */}
        <fieldset>
          <legend className={LABEL}>
            Formules <span className="text-[#E8112D]">*</span>
            <span className="ml-1 font-normal text-zinc-500">— trois offres, du prix le plus bas au plus haut</span>
          </legend>
          <div className="grid gap-3 md:grid-cols-3">
            {packages.map((p, i) => (
              <div key={p.tier} className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2.5">
                <p className="text-[12px] font-bold uppercase tracking-wider text-[#008751]">{GIG_TIER_LABELS[p.tier]}</p>
                <input
                  aria-label={`Nom de la formule ${GIG_TIER_LABELS[p.tier]}`}
                  value={p.titre}
                  onChange={(e) => setPackage(i, "titre", e.target.value)}
                  maxLength={40}
                  placeholder={PACKAGE_PLACEHOLDERS[p.tier].titre}
                  className={INPUT}
                />
                <textarea
                  aria-label={`Ce qui est inclus — ${GIG_TIER_LABELS[p.tier]}`}
                  value={p.description}
                  onChange={(e) => setPackage(i, "description", e.target.value)}
                  maxLength={GIG_PACKAGE_DESCRIPTION_MAX}
                  rows={3}
                  placeholder={PACKAGE_PLACEHOLDERS[p.tier].description}
                  className={TEXTAREA}
                />
                <label className="block text-[12px] text-zinc-600">
                  Prix (XOF)
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label={`Prix — ${GIG_TIER_LABELS[p.tier]}`}
                    value={p.prix}
                    onChange={(e) => setPackage(i, "prix", e.target.value)}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[12px] text-zinc-600">
                    Délai (jours)
                    <input
                      type="number"
                      min={1}
                      aria-label={`Délai en jours — ${GIG_TIER_LABELS[p.tier]}`}
                      value={p.delaiJours}
                      onChange={(e) => setPackage(i, "delaiJours", e.target.value)}
                      className={`${INPUT} mt-1`}
                    />
                  </label>
                  <label className="block text-[12px] text-zinc-600">
                    Révisions
                    <select
                      aria-label={`Révisions — ${GIG_TIER_LABELS[p.tier]}`}
                      value={p.revisions}
                      onChange={(e) => setPackage(i, "revisions", e.target.value)}
                      className={`${INPUT} mt-1`}
                    >
                      {Array.from({ length: GIG_REVISIONS_MAX + 1 }, (_, n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {/* Description */}
        <div>
          <label htmlFor="gig-description" className={LABEL}>
            Description <span className="text-[#E8112D]">*</span>
          </label>
          <textarea
            id="gig-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            maxLength={GIG_DESCRIPTION_MAX}
            placeholder="Ce que vous faites, comment vous travaillez, ce dont vous avez besoin du client pour démarrer."
            className={TEXTAREA}
          />
          <p className={`mt-1 text-[12px] ${description.trim().length < GIG_DESCRIPTION_MIN ? "text-zinc-500" : "text-emerald-700"}`}>
            {description.trim().length}/{GIG_DESCRIPTION_MAX} — {GIG_DESCRIPTION_MIN} caractères minimum
          </p>
        </div>

        {/* Visuels : 3 photos au plus (la première = couverture) et/ou une vidéo */}
        <div>
          <p className={LABEL}>
            Visuels <span className="text-[#E8112D]">*</span>
            <span className="ml-1 font-normal text-zinc-500">
              — jusqu&apos;à {GIG_IMAGES_MAX} photos qui défileront sur votre carte, et/ou une courte vidéo
            </span>
          </p>
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => void pickPhotos(e)}
            aria-label="Ajouter des photos"
          />
          <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Photos du service">
            {Array.from({ length: GIG_IMAGES_MAX }, (_, i) => {
              const src = photos[i];
              if (!src) {
                const isNext = i === photos.length;
                return (
                  <li key={`vide-${i}`}>
                    <button
                      type="button"
                      onClick={() => photoRef.current?.click()}
                      disabled={!isNext || photoBusy}
                      className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-zinc-300 text-[12px] text-zinc-500 hover:border-[#008751] hover:text-[#008751] disabled:opacity-40 disabled:hover:border-zinc-300 disabled:hover:text-zinc-500 transition"
                    >
                      <span className="text-[18px]" aria-hidden>
                        +
                      </span>
                      {i === 0 ? "Photo de couverture" : `Photo ${i + 1}`}
                    </button>
                  </li>
                );
              }
              return (
                <li key={src} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local ou route authentifiée */}
                  <img src={src} alt={i === 0 ? "Photo de couverture" : `Photo ${i + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-[#0A1931]/85 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Couverture
                    </span>
                  )}
                  <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1">
                    {i > 0 && (
                      <button
                        type="button"
                        disabled={photoBusy}
                        onClick={() => void makeFirst(i)}
                        aria-label={`Mettre la photo ${i + 1} en couverture`}
                        className="rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-[#0A1931] shadow-sm disabled:opacity-50"
                      >
                        Mettre en premier
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={photoBusy}
                      onClick={() => void removePhoto(i)}
                      aria-label={`Retirer la photo ${i + 1}`}
                      className="rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-red-600 shadow-sm disabled:opacity-50"
                    >
                      Retirer
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[12px] text-zinc-500">
            {photoBusy ? "Envoi en cours…" : `${photos.length}/${GIG_IMAGES_MAX} photos · JPG, PNG ou WEBP, 5 Mo max · format paysage conseillé`}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                maxLength={300}
                placeholder="Lien YouTube ou Vimeo (facultatif)"
                aria-label="Lien de la vidéo de présentation"
                className={INPUT}
              />
              {videoUrl.trim() && !embed && <p className="text-[12px] text-red-600">Lien YouTube ou Vimeo uniquement.</p>}
              {embed && (
                <div className="aspect-video overflow-hidden rounded-xl border border-zinc-200 bg-black">
                  <iframe
                    src={embed}
                    title="Aperçu de la vidéo"
                    className="h-full w-full"
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mots-clés */}
        <div>
          <label htmlFor="gig-tags" className={LABEL}>
            Mots-clés <span className="text-[#E8112D]">*</span>
            <span className="ml-1 font-normal text-zinc-500">— les mots que vos clients tapent dans la recherche</span>
          </label>
          <div className="flex gap-2">
            <input
              id="gig-tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  if (tagDraft.trim()) addTag();
                }
              }}
              disabled={tags.length >= GIG_TAGS_MAX}
              placeholder={tags.length >= GIG_TAGS_MAX ? `${GIG_TAGS_MAX} mots-clés maximum` : "Ex. logo, identité visuelle"}
              className={INPUT}
            />
            <button
              type="button"
              onClick={addTag}
              disabled={!tagDraft.trim() || tags.length >= GIG_TAGS_MAX}
              className="h-10 px-4 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
          {tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full bg-[#f0faf5] px-2.5 py-1 text-[12px] font-medium text-[#008751]">
                  {t}
                  <button type="button" aria-label={`Retirer ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="text-[#008751]/70 hover:text-red-600">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={saving || !ready}
            title={ready ? undefined : "Complétez la checklist pour publier."}
            className="h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] disabled:opacity-50 transition"
          >
            {saving ? "Enregistrement…" : gig?.status === "publie" ? "Enregistrer et garder en ligne" : "Publier le service"}
          </button>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            className="h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 disabled:opacity-50 transition"
          >
            Enregistrer en brouillon
          </button>
          <button type="button" onClick={onCancel} className="h-10 px-4 rounded-full text-[13px] text-zinc-500 hover:bg-zinc-100">
            Annuler
          </button>
        </div>
      </div>

    </div>
  );
}
