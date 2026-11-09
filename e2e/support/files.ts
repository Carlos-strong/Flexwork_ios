import type { Page } from "@playwright/test";

// Image PNG 1×1 valide : les routes de téléversement contrôlent le type MIME, pas le contenu.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

export const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG_1X1 });

let idSeq = 0;
/** Numéro de pièce unique : deux comptes portant le même numéro sont refusés comme doublons. */
export const uniqueIdNumber = () => `PW${Date.now()}${++idSeq}`;

/** Dépose les quatre pièces d'identité par l'API, comme l'écran /kyc le fait étape par étape. */
export async function uploadIdentityDocs(page: Page) {
  const idNumber = uniqueIdNumber();
  for (const type of ["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"]) {
    const res = await page.request.post("/api/kyc/upload", {
      multipart: { type, file: png(`${type}.png`), ...(type === "piece_identite_recto" ? { idNumber } : {}) },
    });
    if (!res.ok()) throw new Error(`dépôt ${type} refusé : ${res.status()} ${await res.text()}`);
  }
}
