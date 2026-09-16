import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { computeChainedHash } from "@/lib/hash-chain";
import { computeAge, isChantierRole } from "@/lib/age-gate";
import { assertNoSelfDealing } from "@/lib/invariants";
import { validateJalonsSum, type JalonInput } from "@/lib/jalons";
import { getFinancingMode, resolveFinancing } from "@/lib/financing-modes";
import type { DevisData } from "@/lib/devis";
import { isCounterSignExpired, cancelExpiredContract } from "@/lib/contract-expiry";
import { notifyMissionParties } from "@/lib/mission-notify";
import { resolveTimeTerms, type SpotTimeTerms } from "@/lib/spot-time";

// US-402 (Phase 4) : génère le contrat de prestation à partir de la proposition acceptée.
// La plateforme n'est jamais signataire — voir la mention obligatoire ci-dessous, testée en
// non-régression (contract.test.ts). Contenu minimal imposé par modele-skillafrica-v3-
// Flexwork.md §2.1 : identités, objet, prix/conditions, délais, déclarations du prestataire
// (ou mention explicite d'absence), responsabilités, médiation facultative.
const PLATFORM_NOT_A_PARTY_CLAUSE = "Flexwork n'est pas partie au présent contrat.";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  // Paiement fractionné optionnel (2026-08-06) : `jalons` est facultatif. Absent → comportement
  // historique inchangé (un seul HOLD/RELEASE sur le prix total). Présent → les montants
  // doivent sommer exactement au prix de la proposition acceptée (validé plus bas, une fois
  // ce prix connu).
  //
  // Depuis 2026-09-10 ce payload n'est plus que le CHEMIN DE REPLI : quand la mission porte un
  // mode de financement choisi à la publication (Mission.financingModeKey), les jalons et les
  // deux options sont DÉRIVÉS du mode et du devis accepté (voir plus bas), et le corps de la
  // requête est ignoré. Le client ne resaisit plus des montants que le prestataire a déjà
  // chiffrés ligne par ligne.
  const body = await req.json().catch(() => ({}));
  const rawJalons = Array.isArray(body?.jalons) ? (body.jalons as JalonInput[]) : null;

  // Options de gestion des jalons (règles 18.4/18.8-18.9, 2026-09-08) — repli identique :
  // utilisées seulement en l'absence de mode de financement sur la mission. Défauts stricts :
  // tout payload absent/invalide retombe sur le comportement historique inchangé.
  const fallbackFinancingMode = body?.financingMode === "progressive" ? "progressive" : "lump_sum";
  const fallbackJalonsSequential = body?.jalonsSequential === true;

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      client: true,
      // Accepte aussi "devis_valide" (mode QUOTE) : le devis validé tient lieu de sélection.
      proposals: { where: { status: { in: ["acceptee", "devis_valide"] } }, include: { provider: { include: { profiles: { include: { declarations: true } } } } } },
      contract: true,
    },
  });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const proposal = mission.proposals[0];
  if (!proposal) {
    return NextResponse.json({ error: "no_accepted_proposal" }, { status: 409 });
  }
  // Famille 4 — invariant : le client qui génère le contrat ne peut pas être le prestataire
  // sélectionné (un contrat entre une personne et elle-même n'a pas de sens). Défense en
  // profondeur après le blocage de l'auto-candidature (POST proposals / devis).
  if (!assertNoSelfDealing(mission.clientId, proposal.providerId)) {
    return NextResponse.json({ error: "self_dealing_forbidden" }, { status: 403 });
  }
  if (mission.contract) {
    return NextResponse.json({ error: "contract_already_generated" }, { status: 409 });
  }

  // ── Financement : dérivé du mode choisi à la publication, sinon repli sur le payload ──────
  //
  // Le devis EST la décomposition en jalons (une ligne = un livrable = une preuve = une
  // libération) : quand la mission porte un mode, les jalons se déduisent de `devisData` selon
  // la stratégie de ce mode (src/lib/financing-modes.ts) au lieu d'être resaisis. Les montants
  // sont proratisés au prix du contrat, main d'œuvre et TVA comprises — les lignes du devis
  // somment au HT hors main d'œuvre, jamais au TTC facturé.
  const mode = mission.financingModeKey ? getFinancingMode(mission.financingModeKey) : null;

  let jalons: JalonInput[] | null = null;
  let financingMode: "lump_sum" | "progressive" = fallbackFinancingMode;
  let jalonsSequential = fallbackJalonsSequential;
  // Retenue de garantie (règle 18.10) : contrairement à `financingMode`/`jalonsSequential`, elle
  // n'a AUCUN repli depuis le corps de la requête — le taux vient du catalogue et de lui seul
  // (voir RETENTION_RATE_J4, src/lib/financing-modes.ts). Un contrat généré sans mode (mission
  // publiée avant les modes) n'a donc jamais de retenue : on n'en invente pas une sur un
  // contrat dont le prestataire n'a pas pu la connaître en chiffrant.
  let retentionRate = 0;
  // Granularité du financement (§8, 2026-09-14) — comme `retentionRate`, elle ne vient QUE du
  // mode : aucun corps de requête ne la porte. Un contrat généré sans mode garde le
  // comportement historique (`per_jalon`), inchangé.
  let fundingGranularity: "per_jalon" | "upfront" = "per_jalon";
  let appliedModeKey: string | null = null;
  // Distinct de `appliedModeKey` : un mode peut s'appliquer (son régime est retenu) sans que
  // les JALONS aient pu en être dérivés (mission à prix fixe sans devis, voir plus bas).
  let jalonsDerived = false;

  // Seul un VRAI devis (mission en mode devis) découpe le contrat. Une candidature à prix fixe
  // porte elle aussi un `devisData`, mais c'est une ligne SYNTHÉTIQUE unique, créée pour réutiliser
  // l'affichage de la négociation par rounds (POST .../proposals). La prendre pour un découpage
  // réduisait tout contrat à jalons en prix fixe à UN jalon et ignorait ceux saisis par le client :
  // J4 devenait impossible (retenue sur un jalon unique refusée), S1/J1/J3 perdaient leur découpage
  // sans le dire. Constaté par le test de workflow complet (2026-09-15).
  const derived = mode
    ? resolveFinancing(
        mode,
        mission.budgetType === "QUOTE" ? ((proposal.devisData as DevisData | null) ?? null) : null,
        proposal.montant
      )
    : null;

  if (derived?.ok) {
    jalons = derived.resolved.jalons;
    financingMode = derived.resolved.financingMode;
    jalonsSequential = derived.resolved.jalonsSequential;
    retentionRate = derived.resolved.retentionRate;
    fundingGranularity = derived.resolved.fundingGranularity;
    appliedModeKey = mode!.key;
    jalonsDerived = derived.resolved.jalons !== null;
  } else if (derived && derived.error === "devis_required") {
    // Mode à jalons sur une mission SANS devis à dériver (prix fixe) : seul le DÉCOUPAGE
    // manque, pas le régime. `financingMode` s'applique avec ou sans jalons
    // (options-gestion-jalons.md §1) et `jalonsSequential` s'appliquera aux jalons saisis à la
    // main juste en dessous — les abandonner tous les deux ferait retomber un contrat J3 en
    // `lump_sum` sans que personne ne l'ait demandé, c'est-à-dire changer silencieusement le
    // régime économique choisi à la publication.
    financingMode = mode!.primitives.financingMode;
    jalonsSequential = mode!.primitives.jalonsSequential;
    retentionRate = mode!.primitives.retentionRate;
    fundingGranularity = mode!.primitives.fundingGranularity;
    appliedModeKey = mode!.key;
  } else if (derived) {
    // Une vraie erreur de dérivation (prix invalide) : ne pas la masquer en retombant
    // silencieusement sur une saisie manuelle, le montant serait faux dans les deux cas.
    return NextResponse.json({ error: derived.error }, { status: 400 });
  }

  // ── Contrat au TEMPS (S2, 2026-09-15) ────────────────────────────────────────────────────
  // Jusqu'ici un mode S2 générait un contrat SANS conditions tarifaires : aucun code ne créait
  // `SpotTimeTerms`, et tous les relevés de présence répondaient `not_a_time_contract`. Le mode
  // était publiable, et inexécutable. Les conditions sont désormais dérivées de la mission
  // (quantité maximale) et de la candidature acceptée (tarif, plafond = prix du contrat), puis
  // figées au contrat comme le reste.
  let conditionsTemps: SpotTimeTerms | null = null;
  if (mode?.family === "temps" && mode.rateUnit) {
    const resolved = resolveTimeTerms({
      rateUnit: mode.rateUnit,
      maxQuantity: mission.timeMaxQuantity,
      unitRate: proposal.unitRate,
      contractPrice: proposal.montant,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 409 });
    }
    conditionsTemps = resolved.terms;
  }

  // Repli — mission sans mode (publiée avant 2026-09-10), ou mode à jalons sur une mission à
  // prix fixe SANS devis (`devis_required`) : les jalons éventuels viennent alors du corps de
  // la requête, exactement comme avant. Jamais sur un contrat au temps : ce sont les relevés, et
  // non un découpage d'avance, qui fractionnent son paiement.
  if (!jalons && rawJalons && !conditionsTemps) {
    const parsed = rawJalons
      .filter((j) => j && typeof j.titre === "string" && typeof j.montant === "number")
      .map((j) => ({ titre: j.titre, montant: j.montant }));
    const validation = validateJalonsSum(parsed, proposal.montant);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    jalons = parsed;
  }

  // Défense en profondeur sur le chemin DÉRIVÉ uniquement (le chemin manuel est déjà validé
  // juste au-dessus, avec un 400 qui revient à l'appelant) : `distributeExact` garantit déjà
  // Σ == prix en mettant le reliquat sur la dernière part, mais un contrat dont les jalons ne
  // somment pas au prix séquestré est un défaut de paiement silencieux. Un échec ici est un
  // bug de la plateforme, pas une faute du client — d'où le 500.
  if (jalonsDerived && jalons) {
    const validation = validateJalonsSum(jalons, proposal.montant);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 500 });
    }
  }

  // Sans jalon, pas de retenue — identique à la règle de `resolveFinancing`, réappliquée ici
  // parce que le chemin de REPLI (mode à jalons + mission à prix fixe) peut n'aboutir à aucun
  // jalon si le client n'en a saisi aucun : le régime du mode s'applique alors sur le prix
  // total, et une retenue y serait libérée dans la même seconde que le solde (voir
  // PrestationContract.retentionRate, prisma/schema.prisma).
  const effectiveRetentionRate = jalons ? retentionRate : 0;
  // Sans jalon, la granularité n'a pas d'objet — un seul financement, une seule libération.
  const effectiveFundingGranularity = jalons ? fundingGranularity : "per_jalon";

  // Une retenue de garantie sur UN SEUL jalon ne garantit rien : elle est libérée dans la
  // foulée de la validation de ce jalon unique, puisque c'est déjà le dernier. Le mode J4
  // dégénérerait donc silencieusement en J1, avec deux allers-retours PSP de plus et une clause
  // au contrat qui promet une garantie inexistante. Cas réel et non théorique : J4 dérive ses
  // jalons des lignes du devis, et un devis à une seule ligne donne un seul jalon.
  //
  // Refus explicite plutôt que neutralisation silencieuse de la retenue : le client PEUT encore
  // agir — le mode se change tant qu'aucun contrat n'est généré (PUT .../financing-mode), et le
  // prestataire peut redécouper son devis. Le lui dire est la seule façon de lui laisser ce
  // choix ; annuler la retenue dans son dos lui ferait signer autre chose que ce qu'il a choisi.
  if (effectiveRetentionRate > 0 && jalons && jalons.length < 2) {
    return NextResponse.json(
      { error: "retention_requires_multiple_jalons", jalonsCount: jalons.length },
      { status: 400 }
    );
  }

  let declarationAge: string | null = null;
  if (isChantierRole(proposal.provider.role) && proposal.provider.dateNaissance) {
    // findFirst, pas findUnique : Prisma refuse `null` dans la valeur d'une clé composée
    // (voir le même correctif détaillé dans src/app/api/profile/route.ts) — ça levait une
    // PrismaClientValidationError non interceptée = 500 systématique à CHAQUE génération de
    // contrat pour un prestataire en filière chantier (artisan, manœuvre, expert BTP/autres).
    const requirement = await prisma.countryAgeRequirement.findFirst({
      where: {
        country: proposal.provider.country ?? "",
        profileType: proposal.provider.role,
        domain: null,
      },
    });
    const minimumAge = requirement?.minimumAge ?? 18;
    const age = computeAge(proposal.provider.dateNaissance);
    declarationAge = `Le prestataire déclare être âgé de ${age} ans et satisfaire l'âge minimum de ${minimumAge} ans requis au ${proposal.provider.country ?? "pays de la mission"}. Le client reconnaît avoir été informé de cette exigence légale.`;
  }

  const providerDeclarations = proposal.provider.profiles.flatMap((p) => p.declarations);
  const latestInsurance = providerDeclarations
    .filter((d) => d.declarationType === "insurance")
    .sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime())[0];
  const latestQualification = providerDeclarations
    .filter((d) => d.declarationType === "qualification")
    .sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime())[0];

  // Contre-proposition (workflow étape 2) : le délai contractuel est celui proposé par le
  // prestataire et accepté par le client (delaiPropose), PAS le délai initialement publié
  // par la mission — fallback sur mission.delaiJours pour les candidatures antérieures qui
  // n'ont pas de delaiPropose. Idem pour le prix (prix: proposal.montant ci-dessous).
  const delaiJours = proposal.delaiPropose ?? mission.delaiJours;

  // Régime affiché sous le tableau de l'Article 2, au format du modèle de référence
  // (« Le régime de rémunération applicable est : … »).
  const REGIME: Record<string, string> = { FIXED: "Prix fixe", RATE: "Taux (horaire/journalier)", QUOTE: "Sur devis" };

  const termsSnapshot = {
    // Bloc « LE CLIENT » / « ET LE PRESTATAIRE » de l'en-tête (modèle de référence) : identité,
    // adresse et contact figés au moment de la génération, au même titre que le reste des
    // conditions. Ni SIRET ni forme juridique — non collectés par ce schéma.
    client: {
      id: mission.client.id,
      email: mission.client.email,
      tel: mission.client.tel,
      name: [mission.client.firstname, mission.client.lastname].filter(Boolean).join(" ").trim() || null,
      city: mission.client.city,
      country: mission.client.country,
    },
    provider: {
      id: proposal.provider.id,
      email: proposal.provider.email,
      tel: proposal.provider.tel,
      name: [proposal.provider.firstname, proposal.provider.lastname].filter(Boolean).join(" ").trim() || null,
      city: proposal.provider.city,
      country: proposal.provider.country,
      role: proposal.provider.role,
    },
    regimeRemuneration: REGIME[mission.budgetType ?? "FIXED"] ?? "Prix fixe",
    objet: mission.titre,
    description: mission.description,
    prix: proposal.montant,
    devise: mission.currency,
    delaiJours,
    declarationAssurance: latestInsurance
      ? {
          insurerName: latestInsurance.insurerName,
          policyNumber: latestInsurance.policyNumber,
          coverageCeiling: latestInsurance.coverageCeiling,
          validUntil: latestInsurance.validUntil,
        }
      : "Aucune assurance déclarée par ce prestataire",
    declarationQualification: latestQualification?.label ?? null,
    declarationAge,
    // ── Clauses complètes (modèle « Contrat de prestation », adaptées au contexte Bénin /
    //    XOF : sans SIRET ni forme juridique — non collectées —, droit béninois). Figées
    //    dans le snapshot immuable comme le reste des conditions. ──
    dateDebut: new Date().toISOString(),
    clauseDuree: conditionsTemps
      ? `La mission débute le ${new Date().toLocaleDateString("fr-FR")} pour une durée prévisionnelle de ${delaiJours} jours. Cette durée est indicative. Le présent contrat prend effet à sa signature par les deux parties et s'achève à la clôture de la mission par le Client, ou à l'épuisement de la quantité maximale convenue à l'Article 2, sauf résiliation anticipée.`
      : `La mission débute le ${new Date().toLocaleDateString("fr-FR")} pour une durée prévisionnelle de ${delaiJours} jours, soit une échéance au ${new Date(Date.now() + delaiJours * 86400000).toLocaleDateString("fr-FR")}. Cette durée est indicative et pourra être ajustée d'un commun accord selon l'avancement des jalons. Le présent contrat prend effet à sa signature par les deux parties et s'achève à la validation et au paiement du dernier jalon, sauf résiliation anticipée.`,
    clauseStatutIndependant:
      "Le Prestataire exerce sa mission en toute indépendance, sans lien de subordination juridique avec le Client. Il organise librement son travail, ses méthodes et ses horaires, sous la seule réserve du respect des délais convenus. Il est seul responsable de ses obligations sociales, fiscales et déclaratives.",
    clauseProprieteIntellectuelle:
      "Sous réserve du complet paiement des sommes dues, le Prestataire cède au Client les droits patrimoniaux de propriété intellectuelle sur les livrables développés spécifiquement dans le cadre de la mission, pour le monde entier et pour la durée légale de protection. Cette cession ne s'étend pas aux outils, bibliothèques, composants génériques ou méthodes propres au Prestataire, préexistants ou développés hors du cadre strict de la mission.",
    clauseConfidentialite:
      "Chaque partie s'engage à conserver strictement confidentielles les informations techniques, commerciales ou financières dont elle aurait connaissance à l'occasion de la mission, et à ne les utiliser qu'aux fins de sa réalisation. Cette obligation perdure pendant la durée du contrat et pour une période de deux ans à compter de son terme.",
    clauseResiliation: conditionsTemps
      ? "Chaque partie peut résilier le présent contrat en cas de manquement grave non réparé dans les quinze jours suivant une mise en demeure restée sans effet. Les relevés de présence constatés à la date de résiliation restent dus ; le solde non consommé du plafond est restitué au Client."
      : "Chaque partie peut résilier le présent contrat en cas de manquement grave non réparé dans les quinze jours suivant une mise en demeure restée sans effet. Les jalons achevés et validés à la date de résiliation restent dus ; les jalons non engagés ne donnent lieu à aucun paiement.",
    clauseResponsabilite:
      "Le Prestataire est tenu à une obligation de moyens dans l'exécution de sa mission. Sa responsabilité ne peut être engagée qu'en cas de faute prouvée, et est en tout état de cause limitée au montant total perçu au titre du présent contrat.",
    clauseDroitApplicable:
      "Le présent contrat est soumis au droit béninois. En cas de différend, les parties s'efforceront de trouver une solution amiable (y compris la médiation facultative proposée par la plateforme) avant toute action contentieuse. À défaut d'accord amiable, les tribunaux compétents du Bénin seront seuls compétents.",
    responsabiliteQualite: "prestataire",
    responsabiliteBesoinEtSite: "client",
    clauseMediationFacultative: true,
    clausePlateformeNonPartie: PLATFORM_NOT_A_PARTY_CLAUSE,
    // Figé dans le snapshot immuable au même titre que le reste des conditions — un jalon
    // ajouté/modifié après génération du contrat n'existe pas (aucune route ne le permet).
    // Mode devis (QUOTE) : le détail du devis validé est figé intégralement.
    devis: proposal.devisData ?? null,
    jalons: jalons ?? null,
    // Figés au même titre que `jalons` — voir le commentaire sur
    // PrestationContract.financingMode (prisma/schema.prisma).
    financingMode,
    jalonsSequential,
    retentionRate: effectiveRetentionRate,
    fundingGranularity: effectiveFundingGranularity,
    // Mode de financement effectivement APPLIQUÉ (2026-09-10), null si les jalons viennent du
    // chemin de repli (saisie manuelle). Figé ici parce que le catalogue, lui, peut évoluer :
    // le contrat doit garder trace du régime sous lequel il a été signé, même si le libellé
    // ou la disponibilité du mode changent plus tard côté plateforme.
    financingModeKey: appliedModeKey,
    // Conditions au temps figées (S2) — lues par les Articles 2 et 4 (contract-clauses.ts).
    conditionsTemps: conditionsTemps
      ? {
          rateUnit: conditionsTemps.rateUnit,
          rate: conditionsTemps.rate,
          maxQuantity: conditionsTemps.maxQuantity,
          maxAmount: conditionsTemps.maxAmount,
        }
      : null,
  };

  const currentHash = computeChainedHash(null, termsSnapshot);

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.prestationContract.create({
      data: {
        missionId,
        clientId: mission.clientId,
        providerId: proposal.providerId,
        termsSnapshot,
        currentHash,
        financingMode,
        jalonsSequential,
        retentionRate: effectiveRetentionRate,
        fundingGranularity: effectiveFundingGranularity,
      },
    });
    if (conditionsTemps) {
      await tx.spotTimeTerms.create({ data: { contractId: created.id, ...conditionsTemps } });
    }
    if (jalons) {
      await tx.jalon.createMany({
        data: jalons.map((j, i) => ({ contractId: created.id, ordre: i + 1, titre: j.titre, montant: j.montant })),
      });
    }
    await tx.mission.update({ where: { id: missionId }, data: { status: "contrat_genere" } });
    return created;
  });

  // ⚠️ 7 du modèle — notification « Mission à confirmer » au prestataire : le contrat est
  // généré (statut mission = contrat_genere), il doit le signer en premier (1/2). In-app
  // (MissionNotification → fil « Activité récente ») + e-mail. L'e-mail est non bloquant
  // (try/catch dans le helper) — la génération du contrat ne dépend jamais de la notif.
  await notifyMissionParties({
    missionId,
    type: "contract_generated",
    counterpart: {
      userId: proposal.providerId,
      message: `Contrat généré pour « ${mission.titre} » — signez-le pour confirmer la mission`,
      email: {
        subject: "Mission à confirmer — contrat prêt à signer",
        text: `Le contrat pour la mission « ${mission.titre} » vient d'être généré. Connectez-vous pour le signer : vous signez en premier, puis le client contre-signe sous 48h.`,
        html: `<p>Le contrat pour la mission <strong>${mission.titre}</strong> vient d'être généré.</p><p>Connectez-vous pour le signer : <strong>vous signez en premier</strong>, puis le client contre-signe sous 48h.</p>`,
      },
    },
    actor: {
      userId,
      message: `Contrat généré pour « ${mission.titre} » — le prestataire doit le signer, vous contre-signerez ensuite sous 48h.`,
      email: {
        subject: `Contrat généré — ${mission.titre}`,
        text: `Le contrat de la mission « ${mission.titre} » a été généré et envoyé au prestataire pour signature. Vous serez notifié dès qu'il aura signé, pour contre-signer sous 48h.`,
      },
    },
  });

  return NextResponse.json({ id: contract.id, termsSnapshot: contract.termsSnapshot });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: missionId } = await params;

  // F-01 étendu : le contrat (termsSnapshot : prix, téléphones, identités) n'est lisible
  // que par ses deux parties. La condition de propriété est DANS le where (R01) — un tiers
  // reçoit 404, indistinguable d'un contrat inexistant.
  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, OR: [{ clientId: userId }, { providerId: userId }] },
    include: {
      client: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
      provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Annulation temporelle (délai de contre-signature 48h) : si le prestataire a signé (1/2)
  // mais que le client n'a pas contre-signé (2/2) à temps, le contrat est annulé avant d'être
  // renvoyé — le flux redémarre (le prestataire re-signe). Voir src/lib/contract-expiry.ts.
  if (isCounterSignExpired(contract)) {
    await cancelExpiredContract(contract.id);
    contract.providerSignedAt = null;
  }

  return NextResponse.json(contract);
}
