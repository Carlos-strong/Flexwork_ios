import type { DevisData } from "@/lib/devis";

export type DevisRevisionPayload = {
  id: string;
  roundNumber: number;
  comment: string | null;
  createdAt: string;
  devisData: DevisData;
  author: { firstname: string | null; lastname: string | null };
};

export type DevisProposalPayload = {
  id: string;
  montant: number;
  message: string | null;
  status: string;
  roundActuel: number;
  devisData: DevisData | null;
  devisValideAt: string | null;
  createdAt: string;
  provider: { id: string; email: string };
  revisions: DevisRevisionPayload[];
};

export function authorDisplayName(author: {
  firstname: string | null;
  lastname: string | null;
}): string {
  const name = [author.firstname, author.lastname].filter(Boolean).join(" ");
  return name || "Prestataire";
}
