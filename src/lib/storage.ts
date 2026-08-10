import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_PATH ?? "./storage");
const KYC_BUCKET = "kyc-docs"; // bucket privé — jamais servi statiquement, uniquement via route API signée
const MISSIONS_BUCKET = "mission-attachments";
const DECLARATION_DOCS_BUCKET = "declaration-documents";
const MEDIATION_PREUVES_BUCKET = "mediation-preuves";

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

// Phase 3 — document joint à une déclaration professionnelle (qualification/assurance).
export async function saveDeclarationDocument(params: { profileId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(DECLARATION_DOCS_BUCKET, { ownerId: params.profileId, fileName: params.fileName, buffer: params.buffer });
}

// Phase 6 — éléments de preuve déposés dans une médiation.
export async function saveMediationPreuve(params: { mediationId: string; fileName: string; buffer: Buffer }): Promise<string> {
  return saveFile(MEDIATION_PREUVES_BUCKET, { ownerId: params.mediationId, fileName: params.fileName, buffer: params.buffer });
}

export async function readStoredFile(relPath: string): Promise<Buffer> {
  const absPath = path.join(STORAGE_ROOT, relPath);
  if (!absPath.startsWith(STORAGE_ROOT)) {
    throw new Error("path_traversal_rejected");
  }
  return fs.readFile(absPath);
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
