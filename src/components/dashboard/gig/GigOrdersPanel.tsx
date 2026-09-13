"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { ShoppingCart } from "lucide-react";
import { Avatar } from "@/components/avatar";

// ---------------------------------------------------------------------------
// Liste des commandes Gig — servie aux DEUX rubriques « Offres » du sidebar :
//   - `as="provider"` : commandes reçues sur ses Gigs (dashboard prestataire).
//   - `as="client"`   : commandes qu'il a passées (dashboard client).
// Un seul composant plutôt que deux quasi identiques : seuls le filtre serveur
// (GET /api/gigs/orders?as=…), les libellés et l'interlocuteur affiché changent.
// Le détail (signatures + QR) s'ouvre en place via `onOpenOrder` — il n'y a plus de page
// /gigs/commandes/[orderId], tout reste dans la rubrique.
// ---------------------------------------------------------------------------

type GigOrderItem = {
  id: string;
  gigId: string;
  titre: string;
  domaine: string;
  montant: number;
  currency: string;
  status: string;
  createdAt: string;
  clientSignedAt: string | null;
  providerSignedAt: string | null;
  refundedAt: string | null;
  counterpart: { id: string; name: string; avatarUrl: string | null };
};

// Le libellé d'un même statut diffère selon le côté : « à vous de signer » ne s'adresse au
// prestataire qu'en `client_signed`, et au client qu'en `created`.
const STATUS_LABEL: Record<"provider" | "client", Record<string, string>> = {
  provider: {
    created: "En attente de signature client",
    client_signed: "Client signé — à vous de signer (24h)",
    active: "Engagée",
    completed: "Terminée",
    cancelled: "Annulée",
    refunded: "Remboursée",
  },
  client: {
    created: "À signer — votre signature engage le séquestre",
    client_signed: "Signée — en attente du prestataire (24h)",
    active: "Engagée",
    completed: "Terminée",
    cancelled: "Annulée",
    refunded: "Remboursée — délai dépassé",
  },
};

const ORDER_STATUS_STYLE: Record<string, string> = {
  created: "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  client_signed: "bg-[#FEF9C3] text-[#854D0E] border-[#FDE68A]",
  active: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  completed: "bg-[#0A1931] text-white border-[#0A1931]",
  cancelled: "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  refunded: "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
};

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffJ = Math.floor(diffH / 24);
  if (diffJ === 1) return "Hier";
  if (diffJ < 7) return `Il y a ${diffJ}j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

export default function GigOrdersPanel({
  as = "provider",
  onOpenOrder,
}: {
  as?: "provider" | "client";
  onOpenOrder: (orderId: string) => void;
}) {
  const isClient = as === "client";
  const [orders, setOrders] = useState<GigOrderItem[] | null>(null);

  useEffect(() => {
    fetchDedupe(`/api/gigs/orders${isClient ? "?as=client" : ""}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setOrders(d.items ?? []))
      .catch(() => setOrders([]));
  }, [isClient]);

  const stats = useMemo(
    () => ({
      total: orders?.length ?? 0,
      // Côté client, « à signer » = commandes créées non encore signées par lui (1/2).
      // Côté prestataire, « à signer » = commandes déjà signées par le client (2/2, 24h).
      aSigner: orders?.filter((o) => (isClient ? o.status === "created" : o.status === "client_signed")).length ?? 0,
      actives: orders?.filter((o) => o.status === "active").length ?? 0,
      terminees: orders?.filter((o) => o.status === "completed").length ?? 0,
      // Montant brut des commandes ENGAGÉES ou terminées. Ce n'est jamais un solde interne :
      // le séquestre est une instruction au PSP (GigOrderEscrowOperation).
      ca: orders?.filter((o) => o.status === "active" || o.status === "completed").reduce((s, o) => s + o.montant, 0) ?? 0,
    }),
    [orders, isClient]
  );

  const statCards = [
    { label: "Commandes", value: stats.total, sub: "au total", color: "border-gray-800", text: "" },
    { label: "À signer", value: stats.aSigner, sub: isClient ? "en attente de vous" : "sous 24h", color: "border-[#FF6B35]", text: "text-[#FF6B35]" },
    { label: "Engagées", value: stats.actives, sub: "livraison en cours", color: "border-[#1B9C6A]", text: "text-[#1B9C6A]" },
    { label: "Terminées", value: stats.terminees, sub: "livrées", color: "border-[#0A1931]", text: "" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[18px] font-extrabold text-[#0A1931]">{isClient ? "Mes commandes" : "Commandes reçues"}</h2>
        <p className="text-[13px] text-gray-500 mt-1">
          {isClient
            ? "Les Gigs que vous avez achetés. Vous signez en premier — les fonds passent alors sous séquestre — puis le prestataire accepte sous 24h, sinon vous êtes remboursé automatiquement."
            : "Les achats de tes Gigs. Le client signe en premier ; tu contre-signes sous 24h, sinon remboursement automatique."}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white rounded-[16px] p-4 border-l-4 ${s.color} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}>
            <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{s.label}</div>
            <div className="text-[24px] font-extrabold mt-1 text-[#0A1931]">{s.value}</div>
            <div className={`text-[11px] mt-1 ${s.text || "text-gray-400"}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      {stats.ca > 0 && (
        <div className="bg-[#f0faf5] border border-[#008751]/20 rounded-[16px] px-4 py-3 text-[13px] text-[#065f46]">
          💰 <strong>{stats.ca.toLocaleString("fr-FR")} FCFA</strong> {isClient ? "de commandes engagées ou terminées." : "de commandes engagées ou terminées."}
        </div>
      )}

      {orders === null ? (
        <div className="bg-white rounded-[20px] p-10 text-center text-[13px] text-gray-400">Chargement…</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">🛒</div>
          <p className="text-[14px] text-zinc-500 font-medium">Aucune commande pour l&apos;instant.</p>
          <p className="text-[12px] text-zinc-400 mt-1">
            {isClient
              ? "Parcourez le catalogue pour commander un Gig."
              : "Une commande apparaîtra ici dès qu'un client achète un de tes Gigs."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((o) => (
            <div key={o.id} className="group bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${ORDER_STATUS_STYLE[o.status] ?? "bg-gray-100"}`}>
                      {STATUS_LABEL[as][o.status] ?? o.status}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">#{o.id.slice(-6).toUpperCase()}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">{timeAgo(o.createdAt)}</span>
                </div>
                <h3 className="font-bold text-[14px] mt-3 leading-snug group-hover:text-[#FF6B35] transition-colors line-clamp-2">{o.titre}</h3>
                <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                  <span className="truncate">{o.domaine}</span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full shrink-0" />
                  <span className="font-bold text-[#0A1931] shrink-0">{o.montant.toLocaleString("fr-FR")} {o.currency}</span>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <Avatar src={o.counterpart.avatarUrl} initials={o.counterpart.name.charAt(0)} size={28} gradient="from-[#FF7A00] to-[#E8112D]" />
                  <div className="text-[12px]">
                    <span className="font-semibold text-[#0A1931]">{o.counterpart.name}</span>{" "}
                    <span className="text-gray-400">· {isClient ? "prestataire" : "commande"}</span>
                  </div>
                </div>
              </div>
              <div className="sm:w-[150px] shrink-0">
                <button
                  onClick={() => onOpenOrder(o.id)}
                  className="w-full bg-[#0A1931] hover:bg-black text-white rounded-full py-2 text-[12px] font-bold transition text-center"
                >
                  Voir la commande
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[12px] text-gray-400">
        <ShoppingCart className="w-4 h-4" /> Signature inversée : client 1/2, prestataire 2/2 sous 24h — sinon remboursement automatique.
      </div>
    </div>
  );
}
