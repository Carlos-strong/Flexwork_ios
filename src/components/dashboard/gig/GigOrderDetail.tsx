"use client";

// Détail d'une commande Gig + signatures — extrait de l'ancienne page
// /gigs/commandes/[orderId] (supprimée) pour vivre dans la rubrique « Offres » des DEUX
// sidebars : le client y signe 1/2 (onglet « Mes commandes »), le prestataire y contre-signe
// 2/2 (onglet « Commandes »). Un seul composant pour les deux rôles — c'est la même commande
// vue de deux côtés, la seule différence étant qui peut signer à quel moment.
//
// Flux de signature INVERSÉ du modèle Mission : le CLIENT signe en premier (les fonds
// passent sous séquestre), le PRESTATAIRE accepte ensuite sous 24h, sinon remboursement
// automatique au client (src/lib/gig-expiry.ts).
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { SignContractModal } from "@/components/sign-contract-modal";
import { SignatureQRCode } from "@/components/signature-qrcode";
import { fetchDedupe } from "@/lib/fetch-dedupe";

// Constante locale, comme la page contrat Mission hardcode « 48 h » — ne PAS importer depuis
// src/lib/gig-expiry.ts (qui charge Prisma côté serveur → casserait le bundle client).
const PROVIDER_SIGN_DEADLINE_HOURS = 24;

type SignatureRecord = {
  signatureId: string;
  signerName: string;
  signerEmail: string;
  keyFingerprint: string;
  signedAt: string;
  signedDataHash: string;
};

type Order = {
  id: string;
  gigId: string;
  gig: { titre: string; description: string; domaine: string; delaiJours: number };
  montant: number;
  currency: string;
  status: string;
  clientSignedAt: string | null;
  providerSignedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  client: { id: string; email: string; name: string; avatarUrl: string | null };
  provider: { id: string; email: string; name: string; avatarUrl: string | null };
  signatures: SignatureRecord[];
  escrow: { instructionType: string; status: string; amount: number; currency: string }[];
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  created: { label: "Commande créée — le client signe en premier", color: "text-[#0A1931]", bg: "bg-[#E2E8F0]" },
  client_signed: { label: "Fonds sous séquestre — en attente du prestataire (24h)", color: "text-[#92400E]", bg: "bg-[#FFFBEB] border border-[#FDE68A]" },
  active: { label: "Commande engagée — mission en cours", color: "text-[#008751]", bg: "bg-[#f0faf5] border border-[#A7F3D0]" },
  completed: { label: "Terminée", color: "text-[#008751]", bg: "bg-[#f0faf5]" },
  cancelled: { label: "Annulée", color: "text-[#B91C1C]", bg: "bg-[#FEF2F2]" },
  refunded: { label: "Remboursée — délai de 24h dépassé", color: "text-[#B91C1C]", bg: "bg-[#FEF2F2]" },
};

function initialsOf(p: { name: string }): string {
  const parts = p.name.trim().split(/\s+/).filter(Boolean);
  return (`${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase()) || "?";
}

function SignatureCard({
  orderId,
  label,
  party,
  signedAt,
  signatureRecord,
  isSelf,
  canSignNow,
  blockedReason,
  onOpenSigning,
}: {
  orderId: string;
  label: string;
  party: { id: string; name: string; avatarUrl: string | null };
  signedAt: string | null;
  signatureRecord: SignatureRecord | null;
  isSelf: boolean;
  canSignNow: boolean;
  blockedReason: string | null;
  onOpenSigning: () => void;
}) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold">Signature {label}</h3>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${signedAt ? "bg-[#E6F4EE] text-[#008751] border border-[#A7F3D0]" : "bg-[#F1F5F9] text-[#64748B]"}`}>
          {signedAt ? "Signature vérifiable" : "En attente"}
        </span>
      </div>

      <div className="flex items-center gap-2.5 mb-4">
        <Avatar src={party.avatarUrl} initials={initialsOf(party)} size={40} />
        <div>
          <div className="text-[13px] font-semibold">{party.name || "—"}</div>
          <div className="text-[11.5px] text-[#64748B]">{label}</div>
        </div>
      </div>

      {signedAt && signatureRecord ? (
        <div className="text-center">
          <SignatureQRCode
            contractId={orderId}
            signatureId={signatureRecord.signatureId}
            role={label === "Client" ? "client" : "freelancer"}
            signerName={signatureRecord.signerName}
            signedAt={signatureRecord.signedAt}
            keyFingerprint={signatureRecord.keyFingerprint}
            signedDataHash={signatureRecord.signedDataHash}
            size={110}
            verifyPath={`/api/gigs/orders/${orderId}`}
          />
          <p className="mt-2.5 text-[11.5px] text-[#64748B]">
            QR généré le {new Date(signedAt).toLocaleDateString("fr-FR")} à {new Date(signedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      ) : signedAt ? (
        <p className="text-[13px] text-[#008751]">✓ Signé le {new Date(signedAt).toLocaleString("fr-FR")}</p>
      ) : isSelf ? (
        <>
          <button
            disabled={!canSignNow}
            onClick={onOpenSigning}
            className="w-full h-10 rounded-lg text-white text-[13px] font-semibold transition-colors disabled:opacity-50 bg-[#0f172a] hover:bg-black"
          >
            Signer la commande
          </button>
          {blockedReason && <p className="mt-2 text-[11.5px] text-[#94A3B8] text-center">{blockedReason}</p>}
        </>
      ) : (
        <p className="text-[13px] text-[#64748B]">En attente</p>
      )}
    </div>
  );
}

export default function GigOrderDetail({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [signingRole, setSigningRole] = useState<"client" | "freelancer" | null>(null);
  // Validation de la livraison (2026-09-14) : le geste qui libère les fonds au prestataire.
  // Il n'existait pas — une commande livrée restait `active` indéfiniment et son séquestre
  // n'avait aucune sortie vers le prestataire.
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function load() {
    const res = await fetchDedupe(`/api/gigs/orders/${orderId}`);
    if (!res.ok) return setNotFound(true);
    setOrder(await res.json());
  }

  async function validerLivraison() {
    setValidationError(null);
    setValidating(true);
    const res = await fetch(`/api/gigs/orders/${orderId}/validate`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setValidating(false);
    if (!res.ok) {
      setValidationError(
        data.error === "order_not_active"
          ? "Cette commande n'est plus en cours — elle a peut-être déjà été validée."
          : data.error === "nothing_to_release"
            ? "Aucun fonds à libérer sur cette commande."
            : "La validation n'a pas pu aboutir."
      );
      return;
    }
    await load();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const back = (
    <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500 hover:text-[#0A1931]">
      <ArrowLeft className="w-3.5 h-3.5" /> Retour aux commandes
    </button>
  );

  if (!order && !notFound) {
    return <div className="py-16 text-center text-[13px] text-zinc-400">Chargement…</div>;
  }
  if (notFound || !order) {
    return (
      <div className="space-y-4">
        {back}
        <div className="bg-white rounded-[20px] border border-gray-100 p-16 text-center text-[14px] text-zinc-500">Commande introuvable</div>
      </div>
    );
  }

  const isClient = userId === order.client.id;
  const isProvider = userId === order.provider.id;
  const clientSignature = order.signatures.find((s) => s.signerEmail === order.client.email) ?? null;
  const providerSignature = order.signatures.find((s) => s.signerEmail === order.provider.email) ?? null;
  const statusMeta = STATUS_META[order.status] ?? STATUS_META.created;
  const hold = order.escrow.find((e) => e.instructionType === "hold");

  // Ordre INVERSÉ : le client signe toujours en premier (1/2), le prestataire ensuite (2/2).
  const clientCanSign = !order.clientSignedAt && !order.providerSignedAt;
  const providerCanSign = !!order.clientSignedAt && !order.providerSignedAt && order.status === "client_signed";

  return (
    <div className="space-y-4">
      {back}

      <div className={`rounded-xl px-4 py-3 text-[13px] font-semibold ${statusMeta.bg} ${statusMeta.color}`}>{statusMeta.label}</div>

      {order.status === "client_signed" && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-[13px] text-[#92400E] leading-relaxed">
          ⏳ <strong>Le client a signé.</strong> Le prestataire dispose de {PROVIDER_SIGN_DEADLINE_HOURS}&nbsp;h pour
          accepter la commande ; passé ce délai, elle sera annulée et le client <strong>remboursé automatiquement</strong>.
        </div>
      )}
      {order.status === "refunded" && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-[13px] text-[#B91C1C] leading-relaxed">
          💸 <strong>Commande remboursée.</strong> Le prestataire n&apos;a pas signé sous {PROVIDER_SIGN_DEADLINE_HOURS}&nbsp;h —
          le client a été remboursé automatiquement, sans pénalité.
        </div>
      )}
      {order.status === "active" && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#f0faf5] p-3.5 space-y-2.5">
          <p className="text-[13px] text-[#008751] leading-relaxed">
            🤝 <strong>Commande engagée.</strong> Les deux parties ont signé — le prestataire réalise la prestation
            sous {order.gig.delaiJours} jour{order.gig.delaiJours > 1 ? "s" : ""}. Les fonds restent sous séquestre
            jusqu&apos;à votre validation.
          </p>
          {/* Réservé au CLIENT — symétrie exacte de la validation d'un livrable de mission : un
              prestataire capable de déclencher son propre paiement viderait le séquestre de sa
              fonction. */}
          {isClient && (
            <button
              onClick={validerLivraison}
              disabled={validating}
              className="w-full h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50"
            >
              {validating
                ? "Validation…"
                : `Valider la livraison et libérer ${order.montant.toLocaleString("fr-FR")} ${order.currency}`}
            </button>
          )}
          {isProvider && (
            <p className="text-[12px] text-[#00623A]">
              Le client validera la livraison pour déclencher votre paiement.
            </p>
          )}
          {validationError && (
            <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-2.5 text-[12.5px] text-[#B91C1C]">
              {validationError}
            </div>
          )}
        </div>
      )}

      {order.status === "completed" && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#f0faf5] p-3.5 text-[13px] text-[#008751] leading-relaxed">
          ✅ <strong>Livraison validée.</strong> Les fonds sous séquestre ont été libérés au prestataire et la
          commande est clôturée.
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h1 className="text-[13px] font-semibold">{order.gig.titre}</h1>
            <p className="text-[11.5px] text-[#64748B] mt-0.5">{order.gig.description}</p>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-bold text-[#0A1931]">{order.montant.toLocaleString("fr-FR")} {order.currency}</div>
            {hold && <div className="text-[11px] text-[#008751]">Sous séquestre · sécurisé</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[#64748B] flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-[#0A1931] text-white text-[10px] font-bold uppercase tracking-widest">{order.gig.domaine}</span>
          <span>Livraison sous {order.gig.delaiJours} j</span>
          <span className="ml-auto text-[11px]">Commandé le {new Date(order.createdAt).toLocaleDateString("fr-FR")}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SignatureCard
          orderId={order.id}
          label="Client"
          party={order.client}
          signedAt={order.clientSignedAt}
          signatureRecord={clientSignature}
          isSelf={isClient}
          canSignNow={clientCanSign}
          blockedReason={order.clientSignedAt ? null : "Vous signez en premier — votre signature met les fonds sous séquestre."}
          onOpenSigning={() => setSigningRole("client")}
        />
        <SignatureCard
          orderId={order.id}
          label="Prestataire"
          party={order.provider}
          signedAt={order.providerSignedAt}
          signatureRecord={providerSignature}
          isSelf={isProvider}
          canSignNow={providerCanSign}
          blockedReason={!order.clientSignedAt ? "Le client signe en premier ; le prestataire accepte ensuite (24h)." : null}
          onOpenSigning={() => setSigningRole("freelancer")}
        />
      </div>

      {signingRole && (
        <SignContractModal
          contractId={order.id}
          role={signingRole}
          signerName={session?.user?.name ?? ""}
          signerEmail={session?.user?.email ?? ""}
          onClose={() => setSigningRole(null)}
          onSigned={load}
          signUrl={`/api/gigs/orders/${order.id}/sign`}
          bodyIdKey="orderId"
        />
      )}
    </div>
  );
}
