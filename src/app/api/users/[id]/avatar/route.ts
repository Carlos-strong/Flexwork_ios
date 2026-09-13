import { NextResponse } from "next/server";
import path from "path";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { readStoredFile } from "@/lib/storage";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// Diffuse la photo de profil d'un utilisateur — contrairement aux documents KYC (privés,
// URL signée à durée limitée via /api/kyc/file/[token]), une photo de profil est destinée à
// être vue par d'autres utilisateurs (cartes de mission, candidatures, sidebar), sans jeton
// ni expiration.
//
// Visible sans session (2026-09-09) pour les seuls prestataires déjà listés publiquement —
// mêmes critères que /api/search/prestataires et /api/users/[id]/public-profile. La vitrine
// d'accueil et /recherche sont publiques et affichent ces photos : les laisser derrière une
// session ne protégeait rien (le nom, le pays et le métier de ces mêmes profils sont publics)
// et faisait juste échouer chaque image en 401 pour un visiteur. Les photos de tous les
// autres comptes — clients, comptes non vérifiés, profils non listés — restent réservées aux
// connectés.
// 404 silencieux si l'utilisateur n'a pas de photo — les vues appelantes retombent sur les
// initiales via un simple onError sur <img>, pas besoin d'un endpoint séparé "a une photo ?".
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { avatarPath: true, kycStatus: true, role: true, _count: { select: { profiles: true } } },
  });

  const publiclyListed =
    !!user && user.kycStatus === "verifie" && PROVIDER_ROLES.includes(user.role) && user._count.profiles > 0;

  if (!session?.user && !publiclyListed) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (!user?.avatarPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = await readStoredFile(user.avatarPath).catch(() => null);
  if (!buffer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contentType = CONTENT_TYPE_BY_EXT[path.extname(user.avatarPath).toLowerCase()] ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      // Réutilisable côté navigateur sans revalider à chaque affichage de carte. « public »
      // uniquement pour les profils listés publiquement : ces photos sont déjà servies à
      // n'importe qui et peuvent être mises en cache par un intermédiaire. Pour tout le
      // reste la réponse dépend de la session, donc « private » — un cache partagé ne doit
      // jamais servir la photo d'un compte non listé à un autre visiteur.
      "Cache-Control": publiclyListed ? "public, max-age=300" : "private, max-age=300",
    },
  });
}
