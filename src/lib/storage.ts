import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_PATH ?? "./storage");
const KYC_BUCKET = "kyc-docs"; // bucket privé — jamais servi statiquement, uniquement via route API signée
const MISSIONS_BUCKET = "mission-attachments";
const MESSAGE_FILES_BUCKET = "message-files";
const DECLARATION_DOCS_BUCKET = "declaration-documents";
const PORTFOLIO_BUCKET = "portfolio"; // photos de chantiers + CV (profil prestataire), servis via /api/files/[token]
// Contrairement à KYC_BUCKET : ce bucket est destiné à être VU par d'autres utilisateurs
// (cartes de mission, candidatures, sidebar) — servi par GET /api/users/[id]/avatar, sans
// URL signée à durée limitée (une photo de profil n'a pas besoin d'expirer).
const AVATARS_BUCKET = "avatars";

async function saveFile(bucket: string, params: { ownerId: string; fileName: string; buffer: Buffer }): Promise<string> {
  const safeName = `${crypto.randomUUID()}-${params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const relPath = path.posix.join(bucket, params.ownerId, safeName);
  const absPath = path.join(STORAGE_ROOT, relPath);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, params.buffer);

  return relPath;
}

export async function saveKycFile(params: { userId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(KYC_BUCKET, { ownerId: params.userId, fileName: params.fileName, buffer: params.buffer });
}

export async function saveMissionAttachment(params: { missionId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(MISSIONS_BUCKET, { ownerId: params.missionId, fileName: params.fileName, buffer: params.buffer });
}

// Fichier joint à un message de chat (messagerie).
export async function saveMessageFile(params: { missionId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(MESSAGE_FILES_BUCKET, { ownerId: params.missionId, fileName: params.fileName, buffer: params.buffer });
}

// Phase 3 — document joint à une déclaration professionnelle (qualification/assurance).
export async function saveDeclarationDocument(params: { profileId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(DECLARATION_DOCS_BUCKET, { ownerId: params.profileId, fileName: params.fileName, buffer: params.buffer });
}

// Photos de chantiers + CV du profil prestataire (formulaire /profile). Servis via
// /api/files/[token] (kind "portfolio"), visible par tout utilisateur authentifié.
export async function savePortfolioFile(params: { userId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(PORTFOLIO_BUCKET, { ownerId: params.userId, fileName: params.fileName, buffer: params.buffer });
}

// Photo de profil (formulaire /profile, POST /api/profile/avatar). Un remplacement écrase
// l'ancien fichier (voir la route) plutôt que d'accumuler les anciennes photos.
export async function saveAvatar(params: { userId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(AVATARS_BUCKET, { ownerId: params.userId, fileName: params.fileName, buffer: params.buffer });
}

export async function deleteStoredFile(relPath: string): Promise<void> {
  const absPath = path.join(STORAGE_ROOT, relPath);
  if (!absPath.startsWith(STORAGE_ROOT)) {
    throw new Error("path_traversal_rejected");
  }
  await fs.unlink(absPath).catch(() => {});
}

export async function readStoredFile(relPath: string): Promise<Buffer> {
  const absPath = path.join(STORAGE_ROOT, relPath);
  if (!absPath.startsWith(STORAGE_ROOT)) {
    throw new Error("path_traversal_rejected");
  }
  return fs.readFile(absPath);
}

// Taille réelle du fichier sur disque — utilisé pour afficher les infos d'un document déjà
// téléversé (GET /api/kyc/documents) sans avoir à stocker la taille en base séparément.
export async function getStoredFileSize(relPath: string): Promise<number | null> {
  const absPath = path.join(STORAGE_ROOT, relPath);
  if (!absPath.startsWith(STORAGE_ROOT)) {
    throw new Error("path_traversal_rejected");
  }
  try {
    const stat = await fs.stat(absPath);
    return stat.size;
  } catch {
    return null;
  }
}

// `saveFile` préfixe le nom original par un UUID pour éviter les collisions
// (`{uuid}-{safeName}`) — on l'enlève pour ré-afficher un nom lisible côté utilisateur.
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
export function displayFileName(relPath: string): string {
  const base = path.posix.basename(relPath);
  return base.replace(UUID_PREFIX_RE, "");
}

const SIGNED_URL_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SECRET = process.env.AUTH_SECRET ?? "dev-secret";

export function signPrivateFileToken(kind: string, id: string): string {
  const expires = Date.now() + SIGNED_URL_TTL_MS;
  const payload = `${kind}.${id}.${expires}`;
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function verifyPrivateFileToken(token: string): { kind: string; id: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [kind, id, expiresStr, signature] = decoded.split(".");
    const expires = Number(expiresStr);
    const payload = `${kind}.${id}.${expiresStr}`;
    const expectedSignature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

    if (signature !== expectedSignature) return null;
    if (Date.now() > expires) return null;

    return { kind, id };
  } catch {
    return null;
  }
}

// Alias conservés pour compatibilité avec le code KYC existant (US-102).
export function signKycDocToken(docId: string): string {
  return signPrivateFileToken("kyc", docId);
}
export function verifyKycDocToken(token: string): { docId: string } | null {
  const result = verifyPrivateFileToken(token);
  if (!result || result.kind !== "kyc") return null;
  return { docId: result.id };
}
