"use client";

// Publication d'un Gig — extrait de l'ancienne page /gigs/nouveau (supprimée) pour vivre
// dans la rubrique « Offres » du sidebar prestataire (onglet « Mes Gigs »). Logique et appel
// API strictement identiques : POST /api/gigs, qui refuse les comptes client (403).
import { useState } from "react";

const DOMAINES = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

const INPUT =
  "w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

export default function GigCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [domaine, setDomaine] = useState("expert_digital");
  const [prix, setPrix] = useState("");
  const [delaiJours, setDelaiJours] = useState("7");
  const [tags, setTags] = useState("");
  const [publie, setPublie] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/gigs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre,
        description,
        domaine,
        prix: Number(prix),
        delaiJours: Number(delaiJours),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        status: publie ? "publie" : "brouillon",
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(data.message ?? data.error ?? "Impossible de publier le Gig.");
      return;
    }
    // Retour à la liste plutôt qu'une redirection : on ne quitte plus la rubrique Offres.
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-[20px] border border-gray-100 p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[#0A1931]">Publier un Gig</h3>
        <button type="button" onClick={onCancel} className="text-[12.5px] text-zinc-500 hover:text-[#0A1931]">
          Annuler
        </button>
      </div>

      <div>
        <label className="block text-[12px] font-medium text-zinc-600 mb-1">Titre</label>
        <input value={titre} onChange={(e) => setTitre(e.target.value)} required placeholder="Ex. Site vitrine — création complète" className={INPUT} />
      </div>

      <div>
        <label className="block text-[12px] font-medium text-zinc-600 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={4}
          placeholder="Décrivez précisément ce qui est livré, le périmètre, les livrables."
          className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-medium text-zinc-600 mb-1">Domaine</label>
          <select value={domaine} onChange={(e) => setDomaine(e.target.value)} className={INPUT}>
            {DOMAINES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-medium text-zinc-600 mb-1">Prix (XOF)</label>
          <input type="number" value={prix} onChange={(e) => setPrix(e.target.value)} required min={1} placeholder="250000" className={INPUT} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-medium text-zinc-600 mb-1">Délai de livraison (jours)</label>
          <input type="number" value={delaiJours} onChange={(e) => setDelaiJours(e.target.value)} required min={1} className={INPUT} />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-zinc-600 mb-1">Tags (séparés par une virgule)</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="web, vitrine" className={INPUT} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-zinc-600">
        <input type="checkbox" className="w-auto" checked={publie} onChange={(e) => setPublie(e.target.checked)} />
        Publier immédiatement dans le catalogue
      </label>

      {error && <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-11 rounded-full bg-[#008751] text-white text-[13.5px] font-semibold hover:bg-[#007a49] disabled:opacity-50"
      >
        {submitting ? "Publication…" : publie ? "Publier le Gig" : "Enregistrer le brouillon"}
      </button>
    </form>
  );
}
