// Vérification / validation d'une mission (2026-10-01) — module PUR, sans import de runtime.
//
// Choisi par le CLIENT à la publication, figé au contrat :
//
//   - "client" (« Moi-même ») : le client constate les relevés de présence et valide lui-même
//     jalons et tâches (preuves, avancement, validation, libération).
//   - "opr" (« OPR / responsable chantier ») : le responsable de chantier désigné VÉRIFIE —
//     relevés, preuves, avancement — puis TRANSMET au client. Le client prononce seul la
//     validation DÉFINITIVE, c'est-à-dire la libération des fonds. Strict : sans transmission, le
//     client ne valide pas ; si le responsable est indisponible, le client en désigne un autre.
//
// Ce qui ne change pas d'un mode à l'autre :
//   - le prestataire déclare toujours lui-même ses relevés — personne ne pointe à sa place ;
//   - le délai d'acceptation tacite court toujours depuis la soumission du livrable : il protège
//     le prestataire de l'inaction du responsable comme de celle du client ;
//   - le client garde le droit de REFUSER (renvoyer au prestataire), même après transmission.

export type ValidationMode = "client" | "opr";

export const VALIDATION_MODE_LABEL: Record<ValidationMode, { label: string; definition: string }> = {
  client: {
    label: "Moi-même",
    definition:
      "Vous constatez vous-même les relevés de présence et validez les jalons ou tâches de la mission.",
  },
  opr: {
    label: "OPR / responsable chantier",
    definition:
      "Un responsable de chantier constate les relevés et vérifie les jalons ou tâches, puis vous transmet ses vérifications : vous prononcez la validation définitive.",
  },
};

export const DEFAULT_VALIDATION_MODE: ValidationMode = "client";

export type ContractActors = {
  clientId: string;
  providerId: string;
  validationMode: ValidationMode;
  siteManagerId: string | null;
};

export type ContractRole = "client" | "provider" | "site_manager";

/** Rôle d'un utilisateur sur un contrat. Le responsable n'en a un qu'en mode OPR et désigné. */
export function contractRole(contract: ContractActors, userId: string): ContractRole | null {
  if (contract.clientId === userId) return "client";
  if (contract.providerId === userId) return "provider";
  if (isDesignatedSiteManager(contract, userId)) return "site_manager";
  return null;
}

export function isDesignatedSiteManager(contract: Pick<ContractActors, "validationMode" | "siteManagerId">, userId: string): boolean {
  return contract.validationMode === "opr" && !!contract.siteManagerId && contract.siteManagerId === userId;
}

/**
 * Qui VÉRIFIE (constate un relevé, apprécie une preuve, constate l'avancement) ?
 * Le client en mode « Moi-même », le responsable désigné en mode OPR — et lui seul.
 */
export function canVerify(contract: Pick<ContractActors, "clientId" | "validationMode" | "siteManagerId">, userId: string): boolean {
  if (contract.validationMode === "opr") return isDesignatedSiteManager(contract, userId);
  return contract.clientId === userId;
}

/**
 * En OPR, le responsable doit être désigné AVANT le financement du séquestre : un responsable
 * apparu au moment d'un jalon contesté est une source de litige (« pourquoi cette personne
 * valide-t-elle soudain ? »). La règle porte sur le financement INITIAL (contrat entier ou
 * jalon), pas sur la recharge d'un chantier en cours — bloquer une recharge arrêterait l'équipe.
 * Un remplacement ultérieur reste possible ; il est tracé au contrat et notifié au prestataire.
 */
export function siteManagerMissingForFunding(contract: Pick<ContractActors, "validationMode" | "siteManagerId">): boolean {
  return contract.validationMode === "opr" && !contract.siteManagerId;
}

/**
 * Le client peut-il prononcer la validation définitive (libération) ?
 * Toujours en mode « Moi-même » ; en mode OPR, seulement après transmission du responsable.
 */
export function canClientFinalize(mode: ValidationMode, verifiedAt: Date | string | null | undefined): boolean {
  return mode === "client" || !!verifiedAt;
}
