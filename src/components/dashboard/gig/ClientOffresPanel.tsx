"use client";

// Rubrique « Offres » du sidebar CLIENT — pendant de la rubrique Offres du prestataire.
// Deux onglets, qui couvrent tout le parcours d'achat d'un Gig sans jamais quitter le
// dashboard (les pages autonomes /gigs, /gigs/[id] et /gigs/commandes/[orderId] ont été
// supprimées au profit de cette rubrique) :
//   - Catalogue     : parcourir les Gigs publiés, ouvrir le détail, acheter.
//   - Mes commandes : suivre ses commandes et y signer 1/2 (ce qui déclenche le séquestre).
// Après un achat, on bascule automatiquement sur la commande créée : c'est l'étape suivante
// attendue du client, inutile de la lui faire chercher.
import { useState } from "react";
import GigCatalog from "./GigCatalog";
import GigOrdersPanel from "./GigOrdersPanel";
import GigOrderDetail from "./GigOrderDetail";

export default function ClientOffresPanel() {
  const [tab, setTab] = useState<"catalogue" | "commandes">("catalogue");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const TABS = [
    { id: "catalogue" as const, label: "Catalogue" },
    { id: "commandes" as const, label: "Mes commandes" },
  ];

  return (
    <div className="max-w-[1400px] w-full mx-auto space-y-6">
      <div>
        <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#0A1931]">Offres</h1>
        <p className="text-[13px] text-gray-500 mt-2">
          Des prestations à prix fixe publiées par les prestataires. Vous signez en premier —
          les fonds passent sous séquestre — et le prestataire accepte sous 24h, sinon vous êtes remboursé.
        </p>
      </div>

      <div className="flex gap-2 border-b border-gray-100">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setOpenOrderId(null);
              }}
              className={`px-4 h-10 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                active ? "border-[#008751] text-[#0A1931]" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "catalogue" && (
        <GigCatalog
          onPurchased={(orderId) => {
            // L'achat crée la commande ; l'étape suivante est la signature 1/2 du client.
            setTab("commandes");
            setOpenOrderId(orderId);
          }}
        />
      )}

      {tab === "commandes" &&
        (openOrderId ? (
          <GigOrderDetail orderId={openOrderId} onBack={() => setOpenOrderId(null)} />
        ) : (
          <GigOrdersPanel as="client" onOpenOrder={setOpenOrderId} />
        ))}
    </div>
  );
}
