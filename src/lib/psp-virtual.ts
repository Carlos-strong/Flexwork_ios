import { prisma } from "@/lib/db";
import { IN_FLIGHT_STATUSES, netHeldAmount, PROVIDER_PAYOUT_TYPES } from "@/lib/escrow-instructions";
import { applyPspWebhookEvent, type PspWebhookPayload } from "@/lib/psp-webhook";
import { signWebhookPayload } from "@/lib/webhook-signing";

// ---------------------------------------------------------------------------
// PSP virtuelle — simulation du prestataire de paiement agréé (Phase 5, US-501/503/504).
//
// Le cycle séquestre de la plateforme est conçu pour un PSP EXTERNE (FedaPay ou équivalent) :
// la plateforme transmet une instruction (HOLD/RELEASE/FREEZE/REFUND) et attend la
// confirmation par webhook signé HMAC (src/lib/psp-webhook.ts, POST /api/webhooks/psp).
// Aucun vrai PSP n'étant branché en développement, les opérations restaient `pending`
// indéfiniment — le flux ne pouvait pas être testé de bout en bout.
//
// Ce module EST le PSP : il simule fidèlement son comportement côté « banque » —
// autorisation du paiement Mobile Money, gel/libération/remboursement — puis confirme le
// mouvement en renvoyant un webhook signé EXACTEMENT comme le ferait le vrai PSP, en
// réutilisant le même chemin de vérification (`applyPspWebhookEvent`) que la route
// POST /api/webhooks/psp. Aucune dérogation à la règle US-503 : une opération ne passe
// `confirmed` que via la confirmation webhook signée, jamais de façon optimiste.
//
// ⚠️ GARDES : jamais actif en production (NODE_ENV === "production" → désactivé). Les routes
// API de la console renvoient 404 hors développement. En production, seul le vrai webhook
// PSP peut confirmer un mouvement.
// ---------------------------------------------------------------------------

// Interne : aucun appelant hors de ce module (le nom exposé passe par virtualPspName()).
const PSP_VIRTUAL_NAME = "psp-virtuelle";

export type VirtualPspAction = "authorize" | "release" | "freeze" | "unfreeze" | "refund" | "fail";

const EVENT_FOR_ACTION: Record<VirtualPspAction, PspWebhookPayload["event"]> = {
  authorize: "hold_confirmed",
  release: "release_confirmed",
  freeze: "freeze_confirmed",
  unfreeze: "unfreeze_confirmed",
  refund: "refund_confirmed",
  fail: "failed",
};

// Un « authorize » ne s'applique qu'à une instruction HOLD (le client autorise le paiement
// Mobile Money → les fonds passent sous séquestre). Les autres actions correspondent à
// l'instruction portée par l'opération — miroir du comportement d'un vrai PSP.
// Plusieurs types d'instruction peuvent correspondre à une même action d'opérateur : côté
// « banque », verser la retenue de garantie (règle 18.10) est un virement comme un autre, seule
// la plateforme distingue les deux (voir EscrowInstructionType.retention_release).
const ALLOWED_INSTRUCTION_FOR_ACTION: Record<Exclude<VirtualPspAction, "fail">, readonly string[]> = {
  authorize: ["hold"],
  release: PROVIDER_PAYOUT_TYPES,
  freeze: ["freeze"],
  unfreeze: ["unfreeze"],
  refund: ["refund"],
};

/** Le PSP virtuel n'existe qu'en développement — jamais en production. */
export function isVirtualPspEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  // NEXT_PUBLIC_APP_ENV est déclaré dans .env.example ; en l'absence, on considère le dev.
  return (process.env.NEXT_PUBLIC_APP_ENV ?? "development") !== "production";
}

/**
 * Mode « autoconfirm » — implémente la variable ESCROW_STUB_AUTOCONFIRM documentée dans
 * .env.example mais jamais branchée jusqu'ici : la PSP virtuelle confirme automatiquement
 * chaque instruction dès sa création, pour tester le flux complet sans écran intermédiaire.
 * UNIQUEMENT en dev local — ne jamais mettre "true" en staging/production.
 */
export function shouldAutoConfirmStub(): boolean {
  return process.env.ESCROW_STUB_AUTOCONFIRM === "true";
}

/**
 * Nom du PSP à enregistrer sur les opérations : PSP virtuel en développement, sinon le PSP
 * cible configuré (PSP_NAME, défaut "fedapay"). Permet à la console de distinguer les
 * opérations simulées des opérations réelles (qui n'existent pas encore).
 */
export function virtualPspName(): string {
  return isVirtualPspEnabled() ? PSP_VIRTUAL_NAME : (process.env.PSP_NAME ?? "fedapay");
}

/** Évènement webhook qui confirme une instruction donnée (mapping instruction → évènement). */
export function eventForInstruction(instructionType: string): PspWebhookPayload["event"] {
  switch (instructionType) {
    case "hold":
      return "hold_confirmed";
    case "release":
    // La retenue de garantie se confirme par le même évènement qu'une libération ordinaire :
    // c'est bien un versement au prestataire. Sans ce cas, le `default` ci-dessous renvoyait
    // "failed" et l'autoconfirmation faisait ÉCHOUER toute retenue au lieu de la confirmer.
    case "retention_release":
      return "release_confirmed";
    case "freeze":
      return "freeze_confirmed";
    case "refund":
      return "refund_confirmed";
    default:
      return "failed";
  }
}

/**
 * Dispatch d'un évènement webhook « en provenance du PSP » : construit la charge signée HMAC
 * puis la passe à `applyPspWebhookEvent` — STRICTEMENT le même chemin que la route
 * POST /api/webhooks/psp (vérification de signature + transition de statut). On évite un
 * aller-retour HTTP vers soi-même (fragile en dev), mais la sécurité est identique : si la
 * signature ne correspond pas, `applyPspWebhookEvent` refuse le mouvement.
 */
async function dispatchPspWebhook(
  pspReference: string,
  event: PspWebhookPayload["event"],
  channel: "virtual_console" | "autoconfirm"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload: PspWebhookPayload = { pspReference, event };
  const signature = signWebhookPayload(payload as unknown as Record<string, unknown>);
  // Le canal est consigné au journal des échanges : en développement, distinguer une confirmation
  // cliquée sur la console d'une confirmation automatique évite de chercher un webhook qui n'a
  // jamais existé.
  return applyPspWebhookEvent(payload, signature, channel);
}

export type OperateResult =
  | { ok: true; event: PspWebhookPayload["event"] }
  | { ok: false; error: string; status: number };

/**
 * Action de la console PSP virtuelle : confirmer (ou faire échouer) une opération `pending`
 * par référence PSP. C'est l'équivalent, côté simulation, de l'opérateur du PSP qui traite
 * un mouvement — jamais une capture manuelle côté plateforme (US-503 reste intact : le
 * mouvement n'est confirmé qu'à travers le chemin webhook signé).
 */
export async function operateVirtualPsp(
  action: VirtualPspAction,
  pspReference: string
): Promise<OperateResult> {
  if (!isVirtualPspEnabled()) {
    return { ok: false, error: "psp_virtual_disabled", status: 404 };
  }
  const op = await prisma.pspEscrowOperation.findUnique({ where: { pspReference } });
  if (!op) return { ok: false, error: "operation_not_found", status: 404 };
  if (op.status !== "pending") {
    return { ok: false, error: "operation_not_pending", status: 409 };
  }
  if (action !== "fail") {
    const expected = ALLOWED_INSTRUCTION_FOR_ACTION[action];
    if (!expected.includes(op.instructionType)) {
      return { ok: false, error: "instruction_mismatch", status: 409 };
    }
  }

  const event = EVENT_FOR_ACTION[action];
  const result = await dispatchPspWebhook(op.pspReference!, event, "virtual_console");
  if (!result.ok) return { ok: false, error: result.error, status: 409 };
  return { ok: true, event };
}

/**
 * Confirmation automatique (mode ESCROW_STUB_AUTOCONFIRM) d'une opération `pending` : la PSP
 * virtuelle confirme immédiatement l'instruction qu'elle vient de recevoir — comme si le
 * client avait déjà autorisé le paiement et le PSP confirmé dans la foulée.
 */
export async function autoConfirmPending(pspReference: string): Promise<OperateResult> {
  if (!isVirtualPspEnabled() || !shouldAutoConfirmStub()) {
    return { ok: false, error: "auto_confirm_disabled", status: 409 };
  }
  const op = await prisma.pspEscrowOperation.findUnique({ where: { pspReference } });
  if (!op) return { ok: false, error: "operation_not_found", status: 404 };
  if (op.status !== "pending") return { ok: false, error: "operation_not_pending", status: 409 };

  const event = eventForInstruction(op.instructionType);
  const result = await dispatchPspWebhook(op.pspReference!, event, "autoconfirm");
  if (!result.ok) return { ok: false, error: result.error, status: 409 };
  return { ok: true, event };
}

export type VirtualPspOperationView = {
  id: string;
  pspReference: string | null;
  amount: number;
  currency: string;
  instructionType: string;
  status: string;
  instructionSentAt: Date;
  pspConfirmedAt: Date | null;
  contractId: string;
  missionId: string | null;
  missionTitre: string | null;
  jalonId: string | null;
};

export type VirtualPspHeldView = {
  contractId: string;
  missionId: string | null;
  missionTitre: string | null;
  amount: number;
  currency: string;
};

export type VirtualPspSnapshot = {
  enabled: boolean;
  mode: "console" | "autoconfirm";
  pspName: string;
  operations: VirtualPspOperationView[];
  held: VirtualPspHeldView[];
};

/**
 * État de la PSP virtuelle (« la banque ») : la liste des opérations qu'elle détient et les
 * soldes séquestrés par contrat. Les soldes sont DÉRIVÉS des opérations confirmées — la PSP
 * virtuelle n'a pas de base propre, sa comptabilité est exactement le registre des
 * instructions/confirmations (cohérent avec le modèle v3 : la plateforme n'a jamais détenu
 * les fonds, elle enregistre les confirmations du PSP).
 */
export async function getVirtualPspSnapshot(): Promise<VirtualPspSnapshot> {
  const enabled = isVirtualPspEnabled();
  if (!enabled) {
    return { enabled: false, mode: "console", pspName: virtualPspName(), operations: [], held: [] };
  }

  // Portée `mission_contract` uniquement (2026-09-14) : depuis l'unification des registres, la
  // même table porte aussi les opérations des commandes Gig. Celles-ci n'ont pas de
  // `pspReference` et ne passent par aucun webhook — elles sont créées confirmées. Cette console
  // simule l'opérateur du PSP sur les instructions qu'il a réellement à trancher ; y faire
  // figurer des opérations qu'aucune action ne peut toucher n'ajouterait que du bruit.
  const operations = await prisma.pspEscrowOperation.findMany({
    where: { sourceType: "mission_contract" },
    orderBy: { instructionSentAt: "desc" },
    take: 300,
    include: {
      contract: { select: { missionId: true, mission: { select: { titre: true } } } },
    },
  });

  const views: VirtualPspOperationView[] = operations.map((op) => ({
    id: op.id,
    pspReference: op.pspReference,
    amount: op.amount,
    currency: op.currency,
    instructionType: op.instructionType,
    status: op.status,
    instructionSentAt: op.instructionSentAt,
    pspConfirmedAt: op.pspConfirmedAt,
    contractId: op.contractId!,
    missionId: op.contract?.missionId ?? null,
    missionTitre: op.contract?.mission?.titre ?? null,
    jalonId: op.jalonId,
  }));

  // Solde séquestré par contrat, via la règle PARTAGÉE (`netHeldAmount`,
  // src/lib/escrow-instructions.ts) — 2026-09-14. Cette console portait jusqu'ici sa propre
  // copie de la règle, et cette copie DIVERGEAIT : elle comptait un `freeze` comme un crédit,
  // alors qu'un gel ne déplace aucun fonds. Une mission en médiation s'affichait donc au double
  // de son séquestre réel. C'était la troisième écriture de la même règle, après les deux
  // moteurs eux-mêmes ; il n'en reste qu'une.
  const heldMap = new Map<string, VirtualPspHeldView>();
  const rowsByContract = new Map<string, { instructionType: string; status: string; amount: number }[]>();
  for (const op of operations) {
    const key = op.contractId!;
    if (!heldMap.has(key)) {
      heldMap.set(key, {
        contractId: key,
        missionId: op.contract?.missionId ?? null,
        missionTitre: op.contract?.mission?.titre ?? null,
        amount: 0,
        currency: op.currency,
      });
    }
    // Le TABLEAU de la console affiche aussi les instructions refusées — c'est utile à
    // l'opérateur. Le SOLDE, lui, ne doit compter que ce qui n'a pas échoué : c'est la
    // précondition de `netHeldAmount`, et la même que le `where` de tous ses autres appelants.
    // Sans ce filtre, une instruction refusée débitait un séquestre qu'elle n'avait jamais quitté.
    if (!IN_FLIGHT_STATUSES.includes(op.status)) continue;
    const rows = rowsByContract.get(key) ?? [];
    rows.push({ instructionType: op.instructionType, status: op.status, amount: op.amount });
    rowsByContract.set(key, rows);
  }
  for (const [key, rows] of rowsByContract) {
    heldMap.get(key)!.amount = netHeldAmount(rows);
  }

  return {
    enabled,
    mode: shouldAutoConfirmStub() ? "autoconfirm" : "console",
    pspName: PSP_VIRTUAL_NAME,
    operations: views,
    held: Array.from(heldMap.values()).filter((h) => Math.abs(h.amount) > 0.001),
  };
}
