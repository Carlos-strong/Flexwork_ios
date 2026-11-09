// ---------------------------------------------------------------------------
// Adaptateur PSP (2026-10-01) — la SEULE frontière entre la plateforme et le prestataire de
// paiement. Tout ce qui sort vers le PSP (transmettre une instruction) et tout ce qu'on lui
// redemande (relire le statut d'une opération restée en attente) passe par ici.
//
// Ce qui revient du PSP, en revanche, n'y passe pas : la confirmation reste le webhook signé
// (US-503, src/lib/psp-webhook.ts), seule source capable de faire avancer une opération.
//
// Implémentations :
//   - `virtual`  : PSP virtuelle de développement (src/lib/psp-virtual.ts). En autoconfirm, la
//                  « transmission » déclenche aussitôt la confirmation signée ; sinon l'opération
//                  attend une action sur la console.
//   - `external` : aucun appel sortant — le PSP est opéré en dehors de l'application et ne
//                  répond que par webhook. C'est le comportement de production tant qu'aucune
//                  intégration HTTP (FedaPay…) n'est branchée : l'outbox marque l'instruction
//                  transmise et le webhook fait le reste.
//
// Brancher un vrai PSP = écrire une implémentation de `PspAdapter` (appel HTTP idempotent par
// `pspReference`) et la sélectionner par PSP_PROVIDER. Rien d'autre ne change.
// ---------------------------------------------------------------------------

export type PspInstruction = {
  id: string;
  pspReference: string;
  instructionType: string;
  amount: number;
  currency: string;
  contractId: string | null;
  jalonId: string | null;
};

/** Statut tel que le PSP le connaît. `null` : le PSP ne sait pas répondre (ou pas encore). */
export type PspRemoteStatus = "pending" | "confirmed" | "failed" | null;

export interface PspAdapter {
  readonly name: string;
  /**
   * Transmet l'instruction. DOIT être idempotent par `pspReference` : une transmission dont
   * l'accusé s'est perdu est retransmise, et le PSP ne doit pas l'exécuter deux fois.
   * Lève en cas d'échec de transmission (réseau, 5xx) — l'outbox reprendra plus tard.
   */
  sendInstruction(instruction: PspInstruction): Promise<void>;
  /** Relit le statut d'une instruction transmise dont le webhook n'est jamais arrivé. */
  fetchStatus(instruction: PspInstruction): Promise<PspRemoteStatus>;
}

const virtualAdapter: PspAdapter = {
  name: "virtual",
  async sendInstruction(instruction) {
    // Import dynamique : psp-virtual → psp-webhook → escrow → (dispatch →) cet adaptateur. Un
    // import statique fermerait le cycle à l'évaluation des modules.
    const { autoConfirmPending, isVirtualPspEnabled, shouldAutoConfirmStub } = await import("@/lib/psp-virtual");
    if (!isVirtualPspEnabled() || !shouldAutoConfirmStub()) return;
    // Le refus éventuel (opération déjà dénouée entre-temps) n'est pas un échec de TRANSMISSION :
    // la PSP virtuelle a bien reçu l'instruction.
    await autoConfirmPending(instruction.pspReference);
  },
  async fetchStatus() {
    // La console de la PSP virtuelle est la seule à trancher : rien à relire.
    return null;
  },
};

const externalAdapter: PspAdapter = {
  name: "external",
  async sendInstruction() {},
  async fetchStatus() {
    return null;
  },
};

let override: PspAdapter | null = null;

/** Tests uniquement : remplace l'adaptateur le temps d'un scénario (`null` pour rétablir). */
export function setPspAdapterForTests(adapter: PspAdapter | null): void {
  override = adapter;
}

export function pspAdapter(): PspAdapter {
  if (override) return override;
  const provider = process.env.PSP_PROVIDER;
  if (provider === "external") return externalAdapter;
  if (provider === "virtual") return virtualAdapter;
  // Défaut : la PSP virtuelle là où elle existe (développement), l'intégration externe ailleurs.
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_APP_ENV === "production"
    ? externalAdapter
    : virtualAdapter;
}
