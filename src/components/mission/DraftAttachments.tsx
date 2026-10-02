"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Dépôt du cahier des charges AVANT que la mission existe (2026-09-23).
//
// Le champ qui se trouvait là auparavant était de l'UI morte : un `<input type="file">` dans
// un formulaire dont le handler construisait un payload JSON et ne lisait jamais les fichiers,
// sous une légende qui promettait « scan antivirus + stockage chiffré ». Il a été retiré, puis
// remplacé ici par un dépôt réel adossé à POST /api/missions/attachments/draft.
//
// Les fichiers sont rattachés à un `draftId` produit par le navigateur, puis convertis en
// pièces jointes de la mission à sa création. Ce `draftId` n'authentifie rien : le serveur
// filtre sur l'utilisateur de la session.

const MAX_FILES = 10;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

const UPLOAD_ERRORS: Record<string, string> = {
  unsupported_file_type: "Format non supporté — PDF, JPG, PNG ou WEBP uniquement.",
  file_too_large: "Fichier trop volumineux — 10 Mo maximum.",
  too_many_files: `Maximum ${MAX_FILES} fichiers.`,
  unauthenticated: "Votre session a expiré — reconnectez-vous puis réessayez.",
};

export type DraftAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

const readableSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

export function DraftAttachments({
  draftId,
  labelClass,
  onCountChange,
}: {
  draftId: string;
  labelClass: string;
  // Le récapitulatif annonce « n fichier(s) joint(s) » : le compte vit ici, il est remonté
  // plutôt que recompté par une requête de plus depuis le tunnel.
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items, onCountChange]);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    fetch(`/api/missions/attachments/draft?draftId=${encodeURIComponent(draftId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.items) setItems(d.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const upload = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setMsg(null);
      let added = 0;
      let lastError: string | null = null;

      // Séquentiel, pas en parallèle : le plafond par brouillon se compte côté serveur, et
      // dix envois simultanés le franchiraient tous avant que le premier ne soit enregistré.
      for (const file of files) {
        const body = new FormData();
        body.append("draftId", draftId);
        body.append("file", file);
        const res = await fetch("/api/missions/attachments/draft", { method: "POST", body });
        if (res.ok) {
          const created = (await res.json()) as DraftAttachment;
          setItems((prev) => [...prev, created]);
          added += 1;
        } else {
          const data = await res.json().catch(() => ({}));
          lastError = UPLOAD_ERRORS[data.error] ?? `« ${file.name} » n'a pas pu être envoyé.`;
        }
      }

      setBusy(false);
      if (lastError) setMsg({ text: lastError, ok: false });
      else if (added > 0) setMsg({ text: `${added} fichier(s) ajouté(s).`, ok: true });
    },
    [draftId],
  );

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permet de resélectionner le même fichier après une erreur
    if (files.length === 0) return;

    // Contrôlés côté client AUSSI, pour ne pas faire monter 10 Mo avant de les refuser.
    const tooBig = files.find((f) => f.size > MAX_SIZE_BYTES);
    if (tooBig) {
      setMsg({ text: `« ${tooBig.name} » dépasse 10 Mo.`, ok: false });
      return;
    }
    if (items.length + files.length > MAX_FILES) {
      setMsg({ text: `Maximum ${MAX_FILES} fichiers (${items.length} déjà déposés).`, ok: false });
      return;
    }
    await upload(files);
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch("/api/missions/attachments/draft", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setMsg(null);
    } else {
      setMsg({ text: "Suppression impossible.", ok: false });
    }
  }

  const full = items.length >= MAX_FILES;

  return (
    <div>
      <span className={labelClass}>Plans et documents</span>

      <input ref={inputRef} type="file" accept={ACCEPT} multiple onChange={handleSelect} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || full}
        className="w-full p-4 border border-dashed border-zinc-300 rounded-xl text-[13px] text-zinc-500 hover:border-[#008751] hover:text-[#008751] disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {busy ? "Envoi en cours..." : full ? `Maximum ${MAX_FILES} fichiers atteint` : "📎 Ajouter des fichiers"}
      </button>
      <p className="text-[11px] text-zinc-400 mt-1">
        PDF, JPG, PNG ou WEBP — 10 Mo par fichier, {MAX_FILES} maximum. Joints à la mission dès sa création.
      </p>

      {msg && (
        <p className={`mt-2 text-[12px] font-medium ${msg.ok ? "text-[#166534]" : "text-red-600"}`}>{msg.text}</p>
      )}

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-zinc-200 bg-white">
              <span className="text-[16px] shrink-0">{f.mimeType === "application/pdf" ? "📄" : "🖼️"}</span>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-0 text-[13px] text-zinc-800 hover:underline truncate"
              >
                {f.fileName}
              </a>
              <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">{readableSize(f.size)}</span>
              <button
                type="button"
                onClick={() => remove(f.id)}
                disabled={busy}
                aria-label={`Retirer ${f.fileName}`}
                className="text-[12px] font-medium text-red-600 hover:underline disabled:opacity-50 shrink-0"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
