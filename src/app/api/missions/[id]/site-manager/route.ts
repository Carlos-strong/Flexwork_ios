import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Désignation du RESPONSABLE DE CHANTIER sur un contrat au temps (2026-09-14).
//
// Réservé au CLIENT : c'est son pouvoir de validation qu'il délègue, et lui seul peut le
// déléguer. Le prestataire ne doit surtout pas pouvoir choisir qui constatera ses heures.
//
// Révocable à tout moment (`siteManagerId: null`), et c'est la raison pour laquelle la
// désignation vit sur le CONTRAT et non sur le compte : un pouvoir attaché au rôle serait
// impossible à retirer sans supprimer le compte de la personne.
//
// Les relevés DÉJÀ validés par un responsable révoqué ne sont pas défaits — une validation passée
// était légitime au moment où elle a eu lieu, et l'argent est parti.
async function loadOwnedTimeContract(missionId: string, userId: string) {
  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, clientId: userId },
    include: { spotTimeTerms: true },
  });
  if (!contract) return null;
  return contract.spotTimeTerms ? contract : "not_a_time_contract";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await loadOwnedTimeContract(missionId, userId);
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (contract === "not_a_time_contract") {
    return NextResponse.json({ error: "not_a_time_contract" }, { status: 409 });
  }

  const siteManagerId = contract.spotTimeTerms!.siteManagerId;
  const siteManager = siteManagerId
    ? await prisma.user.findUnique({
        where: { id: siteManagerId },
        select: { id: true, firstname: true, lastname: true, email: true },
      })
    : null;

  return NextResponse.json({
    siteManager: siteManager && {
      id: siteManager.id,
      name: [siteManager.firstname, siteManager.lastname].filter(Boolean).join(" ").trim() || siteManager.email,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await loadOwnedTimeContract(missionId, userId);
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (contract === "not_a_time_contract") {
    return NextResponse.json({ error: "not_a_time_contract" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);

  // Révocation explicite.
  if (body?.identifier === null) {
    await prisma.spotTimeTerms.update({
      where: { contractId: contract.id },
      data: { siteManagerId: null },
    });
    return NextResponse.json({ siteManager: null });
  }

  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier) return NextResponse.json({ error: "identifier_required" }, { status: 400 });

  const candidat = await prisma.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { tel: identifier },
    select: { id: true, role: true, status: true, firstname: true, lastname: true, email: true },
  });
  if (!candidat || candidat.status !== "active") {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }
  // Seul un compte portant ce rôle peut être désigné : la responsabilité de constater des heures
  // payées n'est pas un droit qu'on confie à un compte quelconque au détour d'un formulaire.
  if (candidat.role !== "responsable_chantier") {
    return NextResponse.json({ error: "not_a_site_manager" }, { status: 409 });
  }
  // Ni le prestataire, ni le client lui-même : le premier validerait ses propres heures, le
  // second n'a pas besoin d'être désigné pour valider.
  if (candidat.id === contract.providerId || candidat.id === contract.clientId) {
    return NextResponse.json({ error: "invalid_site_manager" }, { status: 409 });
  }

  await prisma.spotTimeTerms.update({
    where: { contractId: contract.id },
    data: { siteManagerId: candidat.id },
  });

  return NextResponse.json({
    siteManager: {
      id: candidat.id,
      name: [candidat.firstname, candidat.lastname].filter(Boolean).join(" ").trim() || candidat.email,
    },
  });
}
