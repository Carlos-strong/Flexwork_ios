import { randomUUID } from "crypto";
import type { PspOperationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyWebhookSignatureGeneric } from "@/lib/webhook-signing";
import { contractPrice, heldBalance, releasedAmounts } from "@/lib/escrow";
import { IN_FLIGHT_STATUSES } from "@/lib/escrow-instructions";
import { MONTANT_EPSILON, releasableBeforeRetention, totalRetentionAmount } from "@/lib/jalons";

export type PspWebhookPayload = {
  pspReference: string;
  event: "hold_confirmed" | "release_confirmed" | "freeze_confirmed" | "refund_confirmed" | "failed";
};

export type ApplyResult = { ok: true } | { ok: false; error: string };

// Le montant total CONFIRMÉ libéré sur ce jalon (ou, jalonId null, sur ce contrat sans jalon)
// a-t-il atteint le montant dû ? Financement progressif (règle 18.4) : plusieurs RELEASE
// partiels peuvent se succéder (un par point d'étape confirmé, voir .../checkpoint) — seul le
// DERNIER, celui qui fait franchir ce seuil, doit déclencher la clôture (`libere`/`cloturee`).
// En mode "lump_sum" (défaut), un seul RELEASE est jamais créé, toujours pour le montant
// plein : ce contrôle est alors trivialement vrai dès sa confirmation, comportement
// historique inchangé.
async function isFullyReleased(
  where: { jalonId: string } | { contractId: string; jalonId: null },
  montant: number
): Promise<boolean> {
  const { confirmed } = await releasedAmounts(where);
  return confirmed >= montant - MONTANT_EPSILON;
}

// Marque UN jalon `libere` et clôture la mission (`cloturee`) si c'était le DERNIER jalon du
// contrat encore non libéré — factorisé (2026-09-08, règle 18.4) pour être appelé aussi bien
// par le webhook PSP normal (release confirmé) que par POST .../validate quand le financement
// progressif a déjà libéré 100% du jalon via les points d'étape (aucune nouvelle instruction
// PSP à transmettre dans ce cas, donc aucun webhook à attendre — voir ce fichier appelant).
export async function closeJalonFullyReleased(jalonId: string, contractId: string, missionId: string): Promise<void> {
  await prisma.jalon.update({ where: { id: jalonId }, data: { status: "libere" } });

  // UNE seule lecture : le contrat porte déjà ses jalons, d'où l'on tire à la fois « en
  // reste-t-il un non libéré ? » et les montants qui composent la retenue. Auparavant un
  // `count` puis un `findUnique` — deux allers-retours pour deux vues de la même liste.
  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    select: {
      retentionRate: true,
      mission: { select: { currency: true } },
      jalons: { select: { montant: true, status: true } },
    },
  });
  if (!contract) return;
  if (contract.jalons.some((j) => j.status !== "libere")) return;

  // Tous les jalons sont libérés. Sans retenue de garantie (cas par défaut, retentionRate 0)
  // il n'y a plus rien à transmettre : la mission se clôture ici, comportement historique.
  const retention = totalRetentionAmount(contract.jalons, contract.retentionRate);
  if (retention <= 0) {
    await prisma.mission.update({ where: { id: missionId }, data: { status: "cloturee" } });
    return;
  }

  await emitRetentionRelease({
    contractId,
    missionId,
    amount: retention,
    currency: contract.mission.currency,
    missionStatus: "validee",
  });
}

// Libération FINALE de la retenue de garantie (règle 18.10, mode J4) — une seule instruction
// portant la somme retenue sur tous les jalons, scopée au CONTRAT (jalonId null) puisqu'elle
// n'appartient à aucun jalon en particulier. La mission passe `validee` (tous les jalons sont
// payés, le solde de garantie est en vol) et n'atteindra `cloturee` qu'à la confirmation du
// PSP — jamais de clôture optimiste, même règle que partout ailleurs en Phase 5.
export async function emitRetentionRelease(args: {
  contractId: string;
  missionId: string;
  amount: number;
  currency: string;
  // Statut à poser sur la mission en même temps que l'instruction. "validee" sur le chemin
  // nominal (tous les jalons payés, la retenue est le dernier mouvement). OMIS sur le chemin de
  // règlement d'une mission arrêtée (POST /api/admin/contracts/[contractId]/retention/settle) :
  // une mission en médiation ou interrompue ne doit surtout pas être réétiquetée « validée »
  // parce qu'on solde son séquestre.
  missionStatus?: "validee";
}): Promise<{ emitted: boolean }> {
  // ⚠️ Import DYNAMIQUE, volontaire : `src/lib/psp-virtual.ts` importe `applyPspWebhookEvent`
  // depuis CE fichier (il rejoue le même chemin de vérification signé). Un import statique de
  // psp-virtual ici fermerait donc le cycle psp-webhook → psp-virtual → psp-webhook. Le charger
  // au moment de l'appel casse le cycle à l'évaluation des modules sans dupliquer la résolution
  // du nom de PSP ni la logique d'autoconfirmation.
  const { autoConfirmPending, isVirtualPspEnabled, shouldAutoConfirmStub, virtualPspName } =
    await import("@/lib/psp-virtual");

  // Garde d'idempotence SOUS VERROU : ce chemin est atteint par le webhook du dernier jalon
  // libéré, et `closeJalonFullyReleased` est aussi appelable par POST .../validate. Un simple
  // `findFirst` suivi d'un `create` laissait deux arrivées CONCURRENTES passer toutes les deux
  // la garde et instruire la retenue deux fois (lecture puis écriture non atomiques). Le
  // `FOR UPDATE` sur la ligne du contrat sérialise les prétendants : le second attend, relit,
  // trouve l'opération du premier et s'arrête. `failed` reste exclu — une instruction refusée
  // par le PSP doit pouvoir être reprise.
  //
  // La mise à jour du statut mission est DANS la même transaction : une opération créée sans
  // son changement de statut laisserait une retenue en vol sur une mission qui ne l'annonce pas.
  const operation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrestationContract" WHERE id = ${args.contractId} FOR UPDATE`;
    const existing = await tx.pspEscrowOperation.findFirst({
      where: {
        contractId: args.contractId,
        instructionType: "retention_release",
        status: { in: IN_FLIGHT_STATUSES },
      },
    });
    if (existing) return null;

    // Borne de sûreté (défense en profondeur) : ne jamais transmettre plus que ce que notre
    // registre dit encore séquestré pour ce contrat. Le montant vient des montants de jalons,
    // le solde des instructions réellement émises — deux chemins indépendants qui doivent
    // coïncider ; s'ils divergent, la borne empêche que ça devienne un sur-paiement. Lue DANS
    // la transaction, donc sous le même verrou que l'écriture qu'elle protège : à l'extérieur,
    // une libération concurrente pouvait changer le solde entre la lecture et l'instruction.
    const amount = Math.min(args.amount, await heldBalance(args.contractId, tx));
    if (amount <= 0) return null;


    const created = await tx.pspEscrowOperation.create({
      data: {
        contractId: args.contractId,
        pspName: virtualPspName(),
        pspReference: `retention_release_${randomUUID()}`,
        amount,
        currency: args.currency,
        instructionType: "retention_release",
      },
    });
    if (args.missionStatus) {
      await tx.mission.update({ where: { id: args.missionId }, data: { status: args.missionStatus } });
    }
    return created;
  });
  if (!operation) return { emitted: false };

  // Confirmation HORS transaction, volontairement : `autoConfirmPending` rentre à nouveau dans
  // `applyPspWebhookEvent`, qui écrit en base. L'appeler à l'intérieur ferait attendre le verrou
  // `FOR UPDATE` que cette même transaction détient — interblocage garanti en mode autoconfirm.
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    await autoConfirmPending(operation.pspReference!);
  }
  return { emitted: true };
}

// US-503 (Phase 5) — seule source de confirmation d'un mouvement d'escrow : le webhook
// signé du PSP. Aucune route admin de confirmation manuelle n'existe côté plateforme — la
// plateforme n'a jamais détenu les fonds, elle ne fait qu'enregistrer la confirmation reçue.
export async function applyPspWebhookEvent(payload: PspWebhookPayload, signature: string): Promise<ApplyResult> {
  if (!verifyWebhookSignatureGeneric(payload, signature)) {
    return { ok: false, error: "invalid_signature" };
  }

  const operation = await prisma.pspEscrowOperation.findUnique({
    where: { pspReference: payload.pspReference },
    include: { contract: { include: { mission: true } } },
  });
  if (!operation) return { ok: false, error: "operation_not_found" };

  // ── Machine à états (règle 18.2) ────────────────────────────────────────────────────────
  // `pending` → `confirmed` | `failed`, et c'est terminal. Sans ce garde, un évènement rejoué
  // écrasait le dénouement précédent : un `failed` arrivant APRÈS un `confirmed` remettait
  // l'opération à `failed`, et comme tous les cumuls excluent `failed` (pour permettre la
  // reprise d'une instruction refusée), le solde libérable se rouvrait — le montant pouvait
  // repartir une seconde fois. Un webhook n'est pas fiable en ordre ni en unicité : c'est au
  // récepteur de l'être.
  const outcome: PspOperationStatus = payload.event === "failed" ? "failed" : "confirmed";
  if (operation.status !== "pending") {
    // Rejeu du MÊME dénouement : idempotent, aucune écriture — les effets métier ont déjà eu
    // lieu et les rejouer (re-clôturer, ré-émettre) serait pire que de ne rien faire.
    if (operation.status === outcome) return { ok: true };
    return { ok: false, error: "operation_already_settled" };
  }

  if (payload.event === "failed") {
    await prisma.pspEscrowOperation.update({
      where: { id: operation.id },
      data: { status: "failed" },
    });
    // Reprise (règle 18.5) : une libération refusée laissait le jalon en `valide` — statut
    // qu'aucune route n'accepte (canDecideDeliverable exige `livrable_soumis`). Le jalon était
    // donc condamné et ses fonds immobilisés pour toujours, alors qu'un refus PSP (solde
    // insuffisant, indisponibilité) est par nature réessayable. On le remet dans l'état où le
    // client peut re-valider. `updateMany` avec garde de statut : un release PARTIEL refusé en
    // financement progressif laisse le jalon `livrable_soumis`, il n'y a alors rien à défaire.
    if (operation.jalonId && operation.instructionType === "release") {
      await prisma.jalon.updateMany({
        where: { id: operation.jalonId, status: "valide" },
        data: { status: "livrable_soumis" },
      });
    }
    return { ok: true };
  }

  await prisma.pspEscrowOperation.update({
    where: { id: operation.id },
    data: { status: "confirmed", pspConfirmedAt: new Date(), webhookReference: payload.event },
  });

  // ── Gel et remboursement ────────────────────────────────────────────────────────────────
  // Branche EXPLICITE, même si elle ne fait rien : ces deux types ne déclenchaient aucune
  // transition et tombaient silencieusement à travers les branches hold/release ci-dessous,
  // si bien qu'un remboursement confirmé laissait la mission « fonds sous séquestre » — de
  // l'argent rendu au client que la plateforme croyait toujours bloqué.
  //
  // `freeze` : le gel accompagne l'ouverture d'une médiation, qui a DÉJÀ posé
  // `mediation_ouverte` sur la mission. Aucune transition supplémentaire n'est due, et c'est
  // volontaire — la confirmation enregistrée ci-dessus suffit.
  //
  // `refund` : aucune route n'émet aujourd'hui de remboursement sur ce modèle (les commandes
  // de gigs ont leur propre table, GigOrderEscrowOperation). Le jour où un tel chemin existera,
  // il lui faudra un état de mission dédié — l'enum MissionStatus n'a rien qui dise « remboursé »,
  // et détourner `cloturee` ferait passer un abandon pour une mission menée à terme. La
  // confirmation est donc enregistrée, et RIEN n'est inventé sur l'état de la mission.
  if (operation.instructionType === "freeze" || operation.instructionType === "refund") {
    return { ok: true };
  }

  // Retenue de garantie (règle 18.10) : une seule instruction porte TOUTE la retenue du
  // contrat, donc aucun seuil à cumuler — sa confirmation clôture la mission, point final.
  // Branche séparée et placée AVANT le test de scope : cette instruction n'est jamais rattachée
  // à un jalon, et la confondre avec un `release` contrat (celui de la médiation) est
  // exactement le défaut que le type dédié supprime.
  if (operation.instructionType === "retention_release") {
    // `updateMany` avec garde de statut, pas `update` : cette instruction peut aussi provenir du
    // règlement d'une mission ARRÊTÉE (route admin de solde de retenue), auquel cas une médiation
    // est probablement ouverte. Solder le séquestre ne tranche pas le litige — la médiation
    // garde la main sur l'état de la mission.
    await prisma.mission.updateMany({
      where: { id: operation.contract.missionId, status: { not: "mediation_ouverte" } },
      data: { status: "cloturee" },
    });
    return { ok: true };
  }

  // Paiement fractionné (2026-08-06) : une opération scopée à un jalon (jalonId non nul) met
  // à jour CE jalon, pas le statut agrégé de la mission de façon optimiste — la mission ne
  // passe `cloturee` qu'une fois TOUS les jalons du contrat `libere` (vérifié ci-dessous).
  if (operation.jalonId) {
    if (operation.instructionType === "hold") {
      await prisma.jalon.update({ where: { id: operation.jalonId }, data: { status: "fonds_sous_sequestre" } });
      await prisma.mission.updateMany({
        where: { id: operation.contract.missionId, status: { notIn: ["fonds_sous_sequestre", "livrable_soumis", "validee", "cloturee"] } },
        data: { status: "fonds_sous_sequestre" },
      });
    } else if (operation.instructionType === "release") {
      const jalon = await prisma.jalon.findUnique({ where: { id: operation.jalonId }, select: { montant: true } });
      // Retenue de garantie (règle 18.10) : le seuil de clôture d'un jalon est son plafond
      // LIBÉRABLE, pas son montant — la part retenue ne sera jamais transmise sur ce jalon
      // (elle part en une instruction finale, voir emitRetentionRelease). Sans retenue
      // (retentionRate 0) `releasableBeforeRetention` rend le montant plein : seuil inchangé.
      if (jalon) {
        const seuil = releasableBeforeRetention(jalon.montant, operation.contract.retentionRate);
        if (await isFullyReleased({ jalonId: operation.jalonId }, seuil)) {
          await closeJalonFullyReleased(operation.jalonId, operation.contractId, operation.contract.missionId);
        }
      }
      // Sinon : RELEASE partiel (financement progressif) — l'argent bouge, mais le jalon
      // reste dans son statut actuel (`livrable_soumis`) jusqu'au RELEASE qui complète son
      // montant. Aucune clôture prématurée sur un simple point d'étape intermédiaire.
    }
    return { ok: true };
  }

  // US-502 — comportement historique (contrat sans jalon) : la mission avance dans son cycle
  // seulement à la confirmation, jamais de façon optimiste à l'envoi de l'instruction.
  if (operation.instructionType === "hold") {
    await prisma.mission.update({
      where: { id: operation.contract.missionId },
      data: { status: "fonds_sous_sequestre" },
    });
  } else if (operation.instructionType === "release") {
    // `cloturee` directement, pas `validee` (audit workflow, 2026-09-02) : contrairement à la
    // branche jalons ci-dessus (qui pose `cloturee` une fois TOUS les jalons `libere`), ce
    // chemin sans jalon n'avait aucun écrivain vers `cloturee` — un seul RELEASE, donc aucune
    // condition à attendre, contrairement au cas multi-jalons. La mission restait bloquée en
    // `validee` indéfiniment : le lien "Donner un avis" (gaté sur `cloturee`) n'apparaissait
    // jamais, alors que l'API l'acceptait déjà (canReviewAtStatus inclut `validee` — laissé
    // tel quel, en défense en profondeur si un autre chemin s'arrêtait un jour à `validee`).
    //
    // Contrat À JALONS : un `release` scopé contrat n'y est jamais la libération du prix — les
    // jalons ont chacun leur opération scopée, et la retenue a son propre type. La seule chose
    // qui atterrit ici est un release de médiation (POST /api/admin/mediations/[id]/respond),
    // dont le montant n'a aucun rapport avec le prix : il ne doit surtout pas clôturer la
    // mission en franchissant un seuil qui ne le concerne pas. On enregistre la confirmation
    // (déjà faite plus haut) et on ne touche à rien d'autre.
    const jalonCount = await prisma.jalon.count({ where: { contractId: operation.contractId } });
    if (jalonCount > 0) return { ok: true };

    // Financement progressif (règle 18.4) : plusieurs RELEASE partiels peuvent précéder
    // celui-ci (un par point d'étape confirmé) — ne clôturer que lorsque le cumul confirmé
    // atteint le prix du contrat, jamais sur un simple palier intermédiaire.
    const montant = contractPrice(operation.contract);
    if (await isFullyReleased({ contractId: operation.contractId, jalonId: null }, montant)) {
      await prisma.mission.update({
        where: { id: operation.contract.missionId },
        data: { status: "cloturee" },
      });
    }
  }

  return { ok: true };
}
