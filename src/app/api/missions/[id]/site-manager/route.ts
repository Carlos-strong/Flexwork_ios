import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveSiteManager } from "@/lib/site-manager";
import { SignatureService } from "@/lib/signature";
import { notifyMissionUser } from "@/lib/mission-notify";

// Désignation du RESPONSABLE DE CHANTIER (2026-09-14, étendue le 2026-10-01).
//
// Réservé au CLIENT : c'est son pouvoir de vérification qu'il délègue, et lui seul peut le
// déléguer. Le prestataire ne doit surtout pas pouvoir choisir qui constatera son travail.
//
// N'a de sens qu'en mode de vérification OPR (Mission/PrestationContract.validationMode) : en
// « Moi-même », le client vérifie seul et la désignation est refusée. Couvre tout contrat — relevés
// au temps comme jalons et tâches — et, avant le contrat, la mission (désignation « plus tard »
// que la publication) ; la génération du contrat la recopie.
//
// Révocable à tout moment (`identifier: null`). Le client peut aussi REMPLACER un responsable
// indisponible : c'est la seule issue en mode OPR strict, où rien ne se valide sans vérification.
// Les vérifications déjà transmises par un responsable révoqué restent valables — elles étaient
// légitimes au moment où elles ont eu lieu.
async function loadOwned(missionId: string, userId: string) {
  const mission = await prisma.mission.findFirst({
    where: { id: missionId, clientId: userId },
    select: {
      id: true,
      titre: true,
      validationMode: true,
      siteManagerId: true,
      contract: { select: { id: true, providerId: true, validationMode: true, siteManagerId: true } },
    },
  });
  return mission;
}

function describe(user: { id: string; firstname: string | null; lastname: string | null; email: string | null } | null) {
  return user && { id: user.id, name: [user.firstname, user.lastname].filter(Boolean).join(" ").trim() || user.email };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await loadOwned(missionId, userId);
  if (!mission) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mode = mission.contract?.validationMode ?? mission.validationMode;
  const siteManagerId = mission.contract ? mission.contract.siteManagerId : mission.siteManagerId;
  const siteManager = siteManagerId
    ? await prisma.user.findUnique({ where: { id: siteManagerId }, select: { id: true, firstname: true, lastname: true, email: true } })
    : null;

  return NextResponse.json({ validationMode: mode, siteManager: describe(siteManager) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await loadOwned(missionId, userId);
  if (!mission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const mode = mission.contract?.validationMode ?? mission.validationMode;
  if (mode !== "opr") {
    return NextResponse.json({ error: "validation_mode_client" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const precedentId = mission.contract ? mission.contract.siteManagerId : mission.siteManagerId;

  // Une fois le contrat signé, tout changement de responsable est une modification des
  // conditions d'exécution : il est inscrit au journal chaîné du contrat et notifié au
  // prestataire (« pourquoi cette personne vérifie-t-elle soudain mon travail ? »), ainsi qu'aux
  // responsables entrant et sortant. Avant le contrat, rien de cela : la désignation sera
  // recopiée au contrat, que le prestataire signera en la connaissant.
  async function tracer(nouveau: { id: string; name: string | null } | null) {
    if (!mission!.contract) return;
    const evenement = nouveau ? (precedentId ? "site_manager_replaced" : "site_manager_designated") : "site_manager_revoked";
    const description = nouveau
      ? precedentId
        ? `Responsable chantier remplacé par ${nouveau.name ?? "un nouveau responsable"}.`
        : `Responsable chantier désigné : ${nouveau.name ?? "responsable"}.`
      : "Responsable chantier retiré par le client.";
    await SignatureService.addAuditEntry(mission!.contract.id, evenement, description, {
      previousSiteManagerId: precedentId,
      siteManagerId: nouveau?.id ?? null,
      byClientId: userId,
    });
    const avis = [
      notifyMissionUser({
        missionId,
        userId: mission!.contract.providerId,
        type: "responsable_chantier",
        message: `${description} Mission « ${mission!.titre} » — il vérifie votre travail, le client garde la validation définitive.`,
      }),
    ];
    if (nouveau) {
      avis.push(
        notifyMissionUser({
          missionId,
          userId: nouveau.id,
          type: "responsable_chantier",
          message: `Vous êtes désigné responsable chantier sur « ${mission!.titre} » : vérifiez les relevés et jalons, puis transmettez-les au client.`,
        })
      );
    }
    if (precedentId && precedentId !== nouveau?.id) {
      avis.push(
        notifyMissionUser({
          missionId,
          userId: precedentId,
          type: "responsable_chantier",
          message: `Vous n'êtes plus responsable chantier sur « ${mission!.titre} ».`,
        })
      );
    }
    await Promise.allSettled(avis);
  }

  const save = (siteManagerId: string | null) =>
    mission.contract
      ? prisma.prestationContract.update({ where: { id: mission.contract.id }, data: { siteManagerId } })
      : prisma.mission.update({ where: { id: mission.id }, data: { siteManagerId } });

  // Révocation explicite.
  if (body?.identifier === null) {
    await save(null);
    if (precedentId) await tracer(null);
    return NextResponse.json({ siteManager: null });
  }

  const resolved = await resolveSiteManager(typeof body?.identifier === "string" ? body.identifier : "", {
    clientId: userId,
    providerId: mission.contract?.providerId ?? null,
  });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const designe = describe(resolved.user);
  await save(resolved.user.id);
  // Redésigner la même personne ne change rien : pas d'entrée de journal ni de notification.
  if (precedentId !== resolved.user.id) await tracer(designe);
  return NextResponse.json({ siteManager: designe });
}
