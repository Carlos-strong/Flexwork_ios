import { NextResponse } from "next/server";
import type { RiskLevel, Secteur } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { missionSchema } from "@/lib/validation";
import { notifyMissionUser } from "@/lib/mission-notify";
import { announcePublication, publishBlocker } from "@/lib/mission-publish";
import { clientPublicationRight, type KycBlock } from "@/lib/kyc-policy";
import { insuranceRequiredFor } from "@/lib/metier-risk";
import { isProfessionalTypeAllowed, secteurLabel } from "@/lib/secteur";
import { getFinancingMode } from "@/lib/financing-modes";
import { expectedMaxAmount } from "@/lib/spot-time";
import { missionDomainFilter } from "@/lib/domain-match";
import { resolveSiteManager } from "@/lib/site-manager";

// US-401 (Phase 4) : le client publie une mission ; son domaine détermine automatiquement
// son palier de risque et si une assurance effective est requise (US-702).
// US-203 (Phase 2) : le KYC ne conditionne QUE la publication (Mission.status = "publiee"),
// jamais l'enregistrement d'un brouillon — auparavant cette route forçait `status: "publiee"`
// sur toute création et exigeait le KYC même pour un brouillon, empêchant tout brouillon
// d'exister (contradiction avec la bannière d'aide de /missions/new qui promet l'inverse).
//
// Publication SANS identité vérifiée (2026-11-02, src/lib/kyc-policy.ts) : un KYC en attente
// ne bloque plus la mise en ligne — c'est la contractualisation et le financement qui
// l'exigent. Restent gardées en brouillon marqué `publicationRequestedAt` (réponse
// `publicationPending: "kyc"`, comme depuis 2026-10-06) les publications que les contrôles
// antifraude retiennent : KYC rejeté, ou plafond de missions en ligne non vérifiées atteint.
// Rien de ce que le client a saisi n'est perdu, et il la publie en un clic une fois débloqué
// (POST /api/missions/[id]/publish, voir src/lib/mission-publish.ts).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = missionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const wantsPublish = (parsed.data.status ?? "publiee") === "publiee";

  // Contrat au TEMPS (S2, 2026-09-15) : le budget publié est le plafond, DÉRIVÉ du tarif et de la
  // quantité maximale — jamais saisi à part, sans quoi les deux divergeraient dès la première
  // retouche du formulaire. Le régime de rémunération est « Taux » par construction.
  const chosenMode = parsed.data.financingModeKey ? getFinancingMode(parsed.data.financingModeKey) : null;
  const isTimeMode = chosenMode?.family === "temps";
  const timeRate = isTimeMode ? (parsed.data.timeRate ?? null) : null;
  const timeMaxQuantity = isTimeMode ? (parsed.data.timeMaxQuantity ?? null) : null;
  const budget =
    timeRate && timeMaxQuantity ? expectedMaxAmount({ rate: timeRate, maxQuantity: timeMaxQuantity }) : parsed.data.budget;

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  // Publication : conditions de la mission d'abord (mêmes règles que la publication d'un
  // brouillon), PUIS les contrôles d'identité — une mission retenue doit être publiable telle
  // quelle une fois débloquée.
  let publicationBlock: KycBlock | null = null;
  if (wantsPublish) {
    const blocker = publishBlocker({
      budgetType: isTimeMode ? "RATE" : parsed.data.budgetType,
      budget,
      financingModeKey: parsed.data.financingModeKey,
      timeRate,
      timeMaxQuantity,
    });
    if (blocker) {
      return NextResponse.json(blocker, { status: 400 });
    }
    const right = await clientPublicationRight(userId);
    if (!right.ok) publicationBlock = { error: right.error, message: right.message };
  }
  const kycPending = publicationBlock !== null;
  const publishNow = wantsPublish && !kycPending;

  // ── Taxonomie (2026-09-23) ────────────────────────────────────────────────────────────
  // Le métier choisi fait foi : son libellé devient `domaine`, qui reste le champ sur lequel
  // `src/lib/domain-match.ts` rapproche missions et prestataires. Sans cette projection, une
  // mission catégorisée proprement cesserait d'atteindre qui que ce soit — les profils
  // prestataires, eux, portent toujours un `mainDomain` libre.
  //
  // La cohérence catégorie ⊃ métier est vérifiée ici, seul endroit qui voit la base : sans
  // ce contrôle, un appel direct pourrait ranger une mission sous une catégorie qui n'est
  // pas celle de son métier, et l'arbre afficherait n'importe quoi.
  let categorieId = parsed.data.categorieId ?? null;
  const metierId = parsed.data.metierId ?? null;
  let domaine = parsed.data.domaine ?? "";
  // Palier de risque (2026-09-24) : il vient du MÉTIER, saisi par l'administrateur dans la
  // taxonomie, et non plus d'une table indexée sur un libellé — celle-ci ne correspondait à
  // aucun métier du catalogue, si bien que le palier « élevé » n'était jamais atteint et que
  // l'obligation d'assurance ne se déclenchait jamais.
  //
  // Sans métier choisi (domaine textuel libre), il n'existe aucune classification : le palier
  // faible est alors la seule réponse exacte, et non un défaut de complaisance.
  let riskLevel: RiskLevel = "low";
  // Secteur de la catégorie retenue, lu au passage (aucune requête de plus) : il ne sert qu'au
  // contrôle du professionnel ciblé, plus bas.
  let secteur: Secteur | null = null;
  if (!metierId && !domaine) {
    // Sans métier choisi, le domaine textuel redevient obligatoire : c'est le seul support
    // du rapprochement mission ⇄ prestataire.
    return NextResponse.json({ error: "domaine_required" }, { status: 400 });
  }
  if (metierId) {
    const metier = await prisma.metier.findUnique({
      where: { id: metierId },
      select: { id: true, libelle: true, categorieId: true, riskLevel: true, categorie: { select: { secteur: true } } },
    });
    if (!metier) {
      return NextResponse.json({ error: "metier_not_found" }, { status: 404 });
    }
    secteur = metier.categorie.secteur;
    if (categorieId && categorieId !== metier.categorieId) {
      return NextResponse.json({ error: "metier_categorie_mismatch" }, { status: 400 });
    }
    categorieId = metier.categorieId;
    domaine = metier.libelle;
    riskLevel = metier.riskLevel;
  } else if (categorieId) {
    const categorie = await prisma.categorie.findUnique({ where: { id: categorieId }, select: { id: true, secteur: true } });
    if (!categorie) {
      return NextResponse.json({ error: "categorie_not_found" }, { status: 404 });
    }
    secteur = categorie.secteur;
  }

  // Professionnel ciblé ⇄ secteur (2026-09-28) : une mission Digital ne cible ni artisan ni
  // manœuvre. Le formulaire ne propose déjà que les types admis ; le contrôle est refait ici
  // contre un appel direct. Cohérence de la MISSION seulement — aucun prestataire n'est exclu
  // de candidater (A16). Catégorie non classée : aucune restriction.
  if (!isProfessionalTypeAllowed(secteur, parsed.data.professionalType)) {
    return NextResponse.json(
      {
        error: "professional_type_incompatible",
        reason: `Ce type de professionnel ne peut pas être ciblé pour une mission du secteur ${secteurLabel(secteur)}.`,
      },
      { status: 400 },
    );
  }

  // Cohérence régime de rémunération ⇄ famille de financement (2026-09-23).
  //
  // Le formulaire lie déjà les deux (choisir « Taux » sélectionne un mode au temps, et
  // choisir un mode au temps force « Taux »), mais ce lien ne vivait QUE dans l'UI : un appel
  // direct pouvait publier un taux journalier financé par jalons — « une combinaison qu'aucun
  // contrat ne sait exécuter », précisément ce que le commentaire du formulaire annonçait
  // éviter. Le contrôle est donc refait ici, où il engage réellement.
  //
  // Une seule direction était déjà couverte (mode au temps ⇒ budgetType forcé à RATE, plus
  // bas) ; c'est l'autre qui manquait.
  // Sans AUCUN mode non plus (2026-10-01, test T-C08) : la garde ne refusait que l'envoi d'un
  // mode non temporel, si bien qu'une mission « Taux » sans mode du tout passait — sans tarif ni
  // plafond, donc sans contrat au temps possible.
  if (parsed.data.budgetType === "RATE" && !isTimeMode) {
    return NextResponse.json(
      { error: "rate_requires_time_mode", reason: "Un régime « Taux » exige un mode de financement au temps (S2H, S2J ou S2M)." },
      { status: 400 },
    );
  }

  // Fourchette indicative : bornes cohérentes, sinon le récapitulatif afficherait « de
  // 900 000 à 400 000 XOF ».
  const { budgetMin, budgetMax } = parsed.data;
  if (budgetMin !== undefined && budgetMax !== undefined && budgetMin > budgetMax) {
    return NextResponse.json({ error: "budget_range_inverted" }, { status: 400 });
  }

  // Vérification / validation (2026-10-01). Désignation facultative du responsable dès la
  // publication — refusée ici plutôt qu'ignorée si l'identifiant ne désigne pas un compte
  // « responsable de chantier » valide : le client croirait avoir délégué.
  const validationMode = parsed.data.validationMode ?? "client";
  // Le mode OPR n'est permis que pour une catégorie qui l'autorise (réglage administrateur) :
  // refait ici, l'interface seule ne suffit pas.
  if (validationMode === "opr") {
    const categorie = categorieId
      ? await prisma.categorie.findUnique({ where: { id: categorieId }, select: { allowsOprVerification: true } })
      : null;
    if (!categorie?.allowsOprVerification) {
      return NextResponse.json({ error: "opr_not_allowed_for_category" }, { status: 400 });
    }
  }
  let siteManagerId: string | null = null;
  if (validationMode === "opr" && parsed.data.siteManagerIdentifier) {
    const resolved = await resolveSiteManager(parsed.data.siteManagerIdentifier, { clientId: userId, providerId: null });
    if (!resolved.ok) {
      return NextResponse.json({ error: `site_manager_${resolved.error}` }, { status: resolved.status });
    }
    siteManagerId = resolved.user.id;
  }

  const client = await prisma.user.findUnique({ where: { id: userId }, select: { country: true } });
  // L'assurance n'est pas un réglage à part : la règle du modèle est « exigée si et seulement si
  // le palier est élevé » (modele-skillafrica-v3 §7.2), d'où la dérivation plutôt qu'une colonne
  // qui pourrait dire le contraire du palier.
  const insuranceRequired = insuranceRequiredFor(riskLevel);

  const mission = await prisma.mission.create({
    data: {
      clientId: userId,
      titre: parsed.data.titre,
      description: parsed.data.description,
      domaine,
      categorieId,
      metierId,
      mode: parsed.data.mode ?? "presentiel",
      dateDebut: parsed.data.dateDebut ?? null,
      pays: parsed.data.pays ?? client?.country ?? null,
      ville: parsed.data.ville ?? null,
      quartier: parsed.data.quartier ?? null,
      urgent: parsed.data.urgent ?? false,
      materiel: parsed.data.materiel ?? null,
      cahierDesCharges: parsed.data.cahierDesCharges ?? null,
      budgetMin: budgetMin ?? null,
      budgetMax: budgetMax ?? null,
      maxCandidatures: parsed.data.maxCandidatures ?? null,
      // Brouillon sans montant fixé : 0 est un simple espace réservé, jamais affiché tant
      // que la mission n'est pas publiée (le budget redevient obligatoire à ce moment-là).
      budget: budget ?? 0,
      currency: parsed.data.currency ?? "XOF",
      delaiJours: parsed.data.delaiJours,
      riskLevel,
      insuranceRequired,
      professionalType: parsed.data.professionalType,
      requiredLevel: parsed.data.level,
      budgetType: isTimeMode ? "RATE" : parsed.data.budgetType,
      // Seul un mode au TEMPS se pose à la publication (2026-10-01) : son unité tarifaire est
      // une condition de la mission. Fixe ou par jalons, c'est le devis du prestataire qui le
      // propose et le client qui l'accepte avec lui — un mode envoyé ici est donc ignoré.
      financingModeKey: isTimeMode ? chosenMode!.key : null,
      timeRate,
      timeMaxQuantity,
      // Mode de pointage : posé à la publication avec le tarif et le plafond, seulement au temps.
      attendanceValidation: isTimeMode ? (parsed.data.attendanceValidation ?? "partielle") : null,
      validationMode,
      siteManagerId,
      tags: parsed.data.tags ?? [],
      maxRevisionRounds: parsed.data.maxRevisionRounds ?? 3,
      dateExpiration: parsed.data.dateExpiration ?? null,
      status: publishNow ? "publiee" : "brouillon",
      publicationRequestedAt: kycPending ? new Date() : null,
    },
  });

  // Pièces jointes déposées avant la création (cahier des charges joint à l'étape 1) : les
  // lignes de brouillon deviennent des pièces jointes de la mission.
  //
  // Le FICHIER n'est pas déplacé — son chemin est opaque, servi uniquement par URL signée, et
  // le recopier n'apporterait qu'une écriture disque de plus. Seule la ligne change de table.
  //
  // Filtré sur `uploaderId` : un `draftId` deviné ne rattache pas les fichiers d'autrui.
  // Non bloquant, comme la notification : la mission est créée et committée, échouer ici
  // ferait retenter le client et créerait un doublon.
  if (parsed.data.draftId) {
    try {
      const drafts = await prisma.missionDraftAttachment.findMany({
        where: { draftId: parsed.data.draftId, uploaderId: userId },
      });
      if (drafts.length > 0) {
        await prisma.$transaction([
          prisma.missionAttachment.createMany({
            data: drafts.map((d) => ({
              missionId: mission.id,
              uploaderId: userId,
              filePath: d.filePath,
              mimeType: d.mimeType,
            })),
          }),
          prisma.missionDraftAttachment.deleteMany({ where: { id: { in: drafts.map((d) => d.id) } } }),
        ]);
      }
    } catch (err) {
      console.error("[missions] rattachement des pièces jointes de brouillon échoué :", err);
    }
  }

  if (publishNow) {
    await announcePublication(mission, userId);
  } else if (publicationBlock) {
    // Le client garde une trace de sa demande (cloche + e-mail), avec ce qui reste à faire.
    try {
      await notifyMissionUser({
        missionId: mission.id,
        userId,
        type: "mission_publication_en_attente",
        message: `Votre mission « ${mission.titre} » est enregistrée en brouillon. ${publicationBlock.message}`,
        email: {
          subject: `Mission enregistrée — vérification d'identité requise`,
          text: `Votre mission « ${mission.titre} » est enregistrée en brouillon. ${publicationBlock.message} Dès que ce sera réglé, vous pourrez la publier en un clic depuis votre tableau de bord.`,
        },
      });
    } catch (e) {
      console.error("[missions] notification de publication en attente échouée (non bloquant) :", e);
    }
  }

  return NextResponse.json({
    id: mission.id,
    status: mission.status,
    riskLevel: mission.riskLevel,
    ...(publicationBlock ? { publicationPending: "kyc" as const, publicationBlock } : {}),
  });
}

// GET : le client voit ses propres missions ; un prestataire voit les missions ouvertes
// (`publiee`) correspondant à son domaine principal déclaré, pour pouvoir candidater
// (US-203 : le KYC ne conditionne que la candidature elle-même, pas la consultation).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profiles: true } });
  // Session valide mais compte absent (supprimé entre la vérification de session et cette
  // requête) : le `user?.role` plus bas court-circuitait le cas client, puis le code
  // retombait sur `user.profiles` sans garde — `next build` refusait ce déréférencement
  // (TS18047). Même convention que GET /api/messages.
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (user.role === "client") {
    // Gestion des missions : les BROUILLONS en sont exclus (2026-10-06). Une mission non
    // publiée n'est pas une mission à gérer — elle s'affichait même « Ouverte », comme si elle
    // était en ligne. Les brouillons ont leur propre carte au tableau de bord
    // (GET /api/missions/pending-publication, PendingPublicationsCard).
    const missions = await prisma.mission.findMany({
      where: { clientId: userId, status: { not: "brouillon" } },
      orderBy: { createdAt: "desc" },
      // `contract.jalons` inclus pour que useSidebarBadges.ts puisse détecter un jalon
      // "livrable_soumis" en attente — sur un contrat à jalons, mission.status ne reflète
      // jamais cet état au niveau agrégé (voir src/lib/psp-webhook.ts). `contract.provider`
      // ajouté (2026-09-04) pour la colonne "Freelance" de MesMissions — identité du
      // prestataire engagé sur CE contrat, pas une liste de candidats.
      include: {
        _count: { select: { proposals: true } },
        contract: { select: { jalons: { select: { status: true, montant: true, observedProgress: true } }, provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } } } },
      },
    });
    return NextResponse.json({ items: missions });
  }

  const mainDomain =
    user.profiles.find((p) => p.isDefault)?.mainDomain ?? user.profiles[0]?.mainDomain ?? null;
  const missions = await prisma.mission.findMany({
    where: { status: "publiee", ...missionDomainFilter(mainDomain) },
    include: {
      client: { select: { id: true, firstname: true, lastname: true, country: true, avatarPath: true } },
      // Candidatures en lice, pour dire au prestataire AVANT qu'il ouvre la mission si le
      // plafond est atteint. Sans ça, il découvrait la fermeture au moment de soumettre —
      // après avoir rédigé sa proposition. Mêmes statuts exclus que dans la garde
      // (`candidature-guard.ts`) : une candidature refusée ou définitivement annulée a
      // libéré sa place.
      _count: { select: { proposals: { where: { status: { notIn: ["refusee", "annulee_definitive"] } } } } },
      proposals: { where: { providerId: userId }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Le calcul est fait ici, une fois, plutôt que répété dans chaque écran qui affiche une
  // liste de missions — et il reprend exactement la règle de la garde, y compris l'exception
  // du prestataire déjà en lice, qu'un plafond atteint ne concerne pas.
  const items = missions.map(({ _count, proposals, ...mission }) => ({
    ...mission,
    candidaturesCount: _count.proposals,
    candidaturesClosed:
      mission.maxCandidatures !== null && proposals.length === 0 && _count.proposals >= mission.maxCandidatures,
  }));
  return NextResponse.json({ items });
}
