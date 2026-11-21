"use client";

// Candidatures reçues — maquette « cartes + comparatif » (2026-11-11), vue du CLIENT
// propriétaire sur /missions/[id]/proposals, en mode prix fixe comme en mode devis.
//
// Données réelles uniquement (GET /api/missions/[id]/proposals) : note moyenne (Review), missions
// menées à terme, compétences déclarées, message, prix et délai proposés, statut. Aucune
// étiquette inventée : le badge de chaque carte est le statut réel de la candidature.
//
// Actions des cartes :
//   - Voir profil       → /profil/[id]?missionId= (comme dans le tiroir) ;
//   - Shortlister       → POST .../shortlist (envoyee ⇄ preselectionnee, voir shortlistTarget) ;
//   - Refuser           → ouvre le tiroir de la candidature (motif de refus obligatoire) ;
//   - Choisir           → récapitulatif du choix (ChoiceRecap), qui confirme et ouvre le contrat ;
//   - Ouvrir le chat    → /missions/[id]?providerId=&chat=1, bulle ouverte sur ce candidat.

import Link from "next/link";
import { useState } from "react";
import { MessageCircle, PenLine, RefreshCw, Star } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { authorDisplayName, type DevisProposalPayload } from "@/components/devis/types";
import { isProposalEngaged } from "@/lib/messaging-visibility";
import { ChoiceRecap } from "@/components/devis/ChoiceRecap";
import { canWithdrawEngagement, favoritesAvailable } from "@/lib/engagement-withdrawal-rules";

// Couleurs des avatars de la maquette (violet, émeraude, ambre, bleu) — classes littérales pour
// que Tailwind les génère.
const AVATAR_GRADIENTS = [
  "from-[#6D28D9] to-[#6D28D9]",
  "from-[#047857] to-[#047857]",
  "from-[#B45309] to-[#B45309]",
  "from-[#1D4ED8] to-[#1D4ED8]",
  "from-[#4C1D95] to-[#4C1D95]",
];
const SHORTLISTED = "preselectionnee";
const OPEN = ["envoyee", "preselectionnee", "en_negociation"];

type Props = {
  missionId: string;
  proposals: DevisProposalPayload[];
  /** Candidatures après filtre — celles affichées en cartes et dans le comparatif. */
  visible: DevisProposalPayload[];
  isQuote: boolean;
  currency: string;
  missionDelaiJours: number | null;
  missionOpen: boolean;
  /** Budget publié — tuile « Budget mission » du récapitulatif. */
  missionBudget: number | null;
  /** Places encore libres sur l'annonce (maxCandidatures − prestataires déjà retenus). */
  placesLeft: number;
  statusLabel: (p: DevisProposalPayload) => string;
  onOpen: (proposalId: string) => void;
  onChanged: () => void;
  /** Filtres, rendus sous l'en-tête. */
  toolbar?: React.ReactNode;
  /** Candidatures retenues (déplacées sur leur engagement) — section « Prestataires retenus ». */
  retained?: DevisProposalPayload[];
  /** Places recherchées sur l'annonce. */
  placesTotal?: number;
  /** Afficher les retenus dans la grille (filtres « Toutes » et « Prestataires retenus »). */
  showRetained?: boolean;
  /** Annonce close dont la réserve (candidats présélectionnés) peut encore être mobilisée. */
  reserveOpen?: boolean;
};

const fmtMoney = (n: number, currency: string) => `${n.toLocaleString("fr-FR")} ${currency === "XOF" ? "FCFA" : currency}`;

function priceOf(p: DevisProposalPayload, isQuote: boolean): number | null {
  if (isQuote) return p.devisData?.totalTTC ?? null;
  return p.montant;
}
function delayOf(p: DevisProposalPayload, missionDelaiJours: number | null): string {
  if (p.delaiPropose) return `${p.delaiPropose} jour${p.delaiPropose > 1 ? "s" : ""}`;
  if (p.devisData?.delay) return p.devisData.delay;
  return missionDelaiJours ? `${missionDelaiJours} jour${missionDelaiJours > 1 ? "s" : ""}` : "—";
}
function initialsOf(p: DevisProposalPayload) {
  return authorDisplayName(p.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

export function ProposalCards({ missionId, proposals, visible, isQuote, currency, missionDelaiJours, missionOpen, missionBudget, placesLeft, statusLabel, onOpen, onChanged, toolbar, retained = [], placesTotal = 1, showRetained = true, reserveOpen = false }: Props) {
  const [compare, setCompare] = useState(false);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const choice = proposals.find((p) => p.id === choiceId) ?? null;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Une seule grille (2026-11-11) : les retenus d'abord (filtres « Toutes » et « Prestataires
  // retenus »), puis les candidatures en attente du filtre courant. Le comparatif porte sur
  // exactement les cartes affichées.
  const shownRetained = showRetained ? retained : [];
  // « Changer ce prestataire » : seulement si un favori disponible peut le remplacer (2026-11-11).
  const favoris = proposals.filter((p) => p.status === SHORTLISTED).length;
  const canChangeProvider = favoritesAvailable({
    annonceStatus: missionOpen ? "publiee" : reserveOpen ? "annonce_close" : "autre",
    reserveOpen,
    favoris,
  });
  const compared = [...shownRetained, ...visible];
  const shortlisted = proposals.filter((p) => p.status === SHORTLISTED).length;
  const refused = proposals.filter((p) => p.status === "refusee").length;
  const gradientOf = (p: DevisProposalPayload) => AVATAR_GRADIENTS[Math.max(0, proposals.findIndex((x) => x.id === p.id)) % AVATAR_GRADIENTS.length];

  async function toggleShortlist(p: DevisProposalPayload) {
    setPendingId(p.id);
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/proposals/${p.id}/shortlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortlisted: p.status !== SHORTLISTED }),
    });
    setPendingId(null);
    if (!res.ok) {
      setError("Cette candidature ne peut plus être présélectionnée (elle a changé entre-temps).");
      return;
    }
    onChanged();
  }

  const criteria: { label: string; value: (p: DevisProposalPayload) => string }[] = [
    { label: "Note", value: (p) => (p.averageRating != null ? `${p.averageRating.toFixed(1)} / 5` : "Pas encore notée") },
    { label: "Missions", value: (p) => String(p.missionsCompleted ?? 0) },
    { label: "Prix", value: (p) => { const v = priceOf(p, isQuote); return v != null ? fmtMoney(v, currency) : "—"; } },
    { label: "Délai", value: (p) => delayOf(p, missionDelaiJours) },
    { label: "Statut", value: (p) => (p.engagement ? "Retenu" : statusLabel(p)) },
  ];

  return (
    <section className="space-y-4" aria-labelledby="candidatures-recues">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="candidatures-recues" className="font-display font-extrabold leading-tight text-[#191224]" style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>
            Candidatures reçues
          </h1>
          <p className="mt-1 text-[15px] text-[#6B6478]">
            {proposals.length + retained.length} profil{proposals.length + retained.length > 1 ? "s" : ""} • {retained.length}/{placesTotal} retenu{retained.length > 1 ? "s" : ""} • {shortlisted} shortlisté(s) • {refused} refusé(s)
          </p>
        </div>
        {compared.length >= 2 && (
          <button
            type="button"
            onClick={() => setCompare((c) => !c)}
            aria-expanded={compare}
            className="px-5 py-3 rounded-full border border-[#4C1D95] text-[#4C1D95] text-[15px] font-bold hover:bg-[#F0EAFF] transition"
          >
            {compare ? "Masquer le comparatif" : `Comparer les ${compared.length} profils`}
          </button>
        )}
      </div>

      {toolbar}
      {error && <p role="alert" className="rounded-2xl bg-[#FEECEB] px-4 py-3 text-[13px] text-[#B42318]">{error}</p>}

      {compare && compared.length >= 2 && (
        <div className="rounded-2xl border border-[#E7E2F0] bg-white overflow-x-auto pop">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead>
              <tr className="bg-[#EFEAF8]">
                <th scope="col" className="text-left py-3.5 px-4 font-bold text-[#191224] normal-case tracking-normal text-[14px] bg-transparent">Critère</th>
                {compared.map((p) => (
                  <th key={p.id} scope="col" className="text-left py-3.5 px-4 font-bold text-[#191224] normal-case tracking-normal text-[14px] bg-transparent">{authorDisplayName(p.provider)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.label} className="border-t border-[#E7E2F0] hover:bg-transparent">
                  <th scope="row" className="text-left py-3.5 px-4 font-bold text-[#191224] bg-transparent normal-case tracking-normal text-[14px]">{c.label}</th>
                  {compared.map((p) => (
                    <td key={p.id} className="py-3.5 px-4 text-[#191224]">{c.value(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compared.length === 0 ? (
        <p className="rounded-2xl border border-[#E7E2F0] bg-white p-6 text-center text-[14px] text-[#6B6478]">
          {proposals.length + retained.length === 0 ? "Aucune candidature reçue pour cette mission." : "Aucun prestataire dans ce filtre."}
        </p>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Prestataires retenus : leur candidature vit sur leur engagement ; chaque carte mène
              à la signature de SON contrat. */}
          {shownRetained.map((p, i) => {
              const eng = p.engagement!;
              const c = eng.contract;
              const signed = !!c?.clientSignedAt && !!c?.providerSignedAt;
              const state = !c
                ? "Contrat à générer — le prestataire signera en premier."
                : signed
                  ? "Contrat signé par les deux parties."
                  : c.providerSignedAt
                    ? "Le prestataire a signé : à vous de contre-signer."
                    : "En attente de la signature du prestataire.";
              return (
                <CandidateCard
                  key={p.id}
                  p={p}
                  gradient={AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]}
                  badge={{ label: "Retenu", cls: "bg-[#E7F7EF] text-[#047857]" }}
                  isQuote={isQuote}
                  currency={currency}
                  missionDelaiJours={missionDelaiJours}
                  priceLabel="Prix retenu"
                >
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      href={`/profil/${p.provider.id}?missionId=${eng.id}`}
                      className="flex items-center justify-center py-2.5 rounded-full border border-[#E7E2F0] text-[14px] font-bold text-[#191224] hover:border-[#4C1D95]"
                      style={{ textDecoration: "none" }}
                    >
                      Voir profil
                    </Link>
                    <Link
                      href={`/missions/${eng.id}/publique`}
                      className="flex items-center justify-center py-2.5 rounded-full border border-[#E7E2F0] text-[14px] font-bold text-[#191224] hover:border-[#4C1D95]"
                      style={{ textDecoration: "none" }}
                    >
                      Voir le suivi
                    </Link>
                  </div>
                  <p className="mt-3 text-[12px] text-[#6B6478] text-center">{state}</p>
                  <Link
                    href={`/missions/${eng.id}/contract`}
                    className="mt-2 flex items-center justify-center gap-2 py-3 rounded-full border border-[#A7F3D0] bg-[#D1FAE5] text-[#065F46] text-[14px] font-bold hover:bg-[#A7F3D0] transition"
                    style={{ textDecoration: "none" }}
                  >
                    <PenLine className="w-4 h-4" aria-hidden />
                    {signed ? "Contrat signé — voir le contrat" : "Signature du contrat"}
                  </Link>
                  {/* Désistement (2026-11-11) : tant que le contrat n'est pas signé des deux parties. */}
                  {canWithdrawEngagement({ parentMissionId: missionId, status: eng.status, contract: c }) &&
                    (canChangeProvider ? (
                      <WithdrawButton engagementId={eng.id} providerName={authorDisplayName(p.provider)} onDone={onChanged} />
                    ) : (
                      <p className="mt-2 text-center text-[12px] text-[#6B6478]">
                        {missionOpen
                          ? "⭐ Shortlistez un favori pour pouvoir changer de prestataire."
                          : "Aucun favori disponible pour changer de prestataire."}
                      </p>
                    ))}
                </CandidateCard>
              );
          })}
          {visible.map((p) => {
            const isShortlisted = p.status === SHORTLISTED;
            const canShortlist = missionOpen && (p.status === "envoyee" || isShortlisted);
            // Réserve (2026-11-11) : après la clôture, un candidat présélectionné peut remplacer un
            // prestataire qui s'est désisté, tant que la réserve court et qu'une place est libre.
            const inReserve = reserveOpen && isShortlisted;
            const isOpen = (missionOpen && OPEN.includes(p.status)) || inReserve;
            const canChoose = placesLeft > 0 && isOpen && (!isQuote || (p.status === "en_negociation" && !!p.devisData));
            const canChat = isProposalEngaged(p.status);
            const chosen = p.status === "acceptee" || p.status === "devis_valide";
            return (
              <CandidateCard
                key={p.id}
                p={p}
                gradient={gradientOf(p)}
                badge={{ label: inReserve ? "En réserve" : isShortlisted ? "Shortlisté" : statusLabel(p), cls: p.status === "refusee" ? "bg-[#FEECEB] text-[#B42318]" : chosen ? "bg-[#E7F7EF] text-[#047857]" : "bg-[#F0EAFF] text-[#4C1D95]" }}
                isQuote={isQuote}
                currency={currency}
                missionDelaiJours={missionDelaiJours}
                onDetail={() => onOpen(p.id)}
              >
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      href={`/profil/${p.provider.id}?missionId=${missionId}`}
                      className="flex items-center justify-center py-2.5 rounded-full border border-[#E7E2F0] text-[14px] font-bold text-[#191224] hover:border-[#4C1D95]"
                      style={{ textDecoration: "none" }}
                    >
                      Voir profil
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleShortlist(p)}
                      disabled={!canShortlist || pendingId === p.id}
                      aria-pressed={isShortlisted}
                      title={canShortlist ? undefined : "Présélection possible seulement avant toute négociation"}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-full border text-[14px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${isShortlisted ? "border-[#F59E0B] bg-[#FFF6E3] text-[#B45309]" : "border-[#E7E2F0] text-[#191224] hover:border-[#4C1D95]"}`}
                    >
                      <Star className={`w-4 h-4 ${isShortlisted ? "fill-[#F59E0B] text-[#F59E0B]" : ""}`} aria-hidden />
                      {isShortlisted ? "Shortlisté" : "Shortlister"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen(p.id)}
                      disabled={!isOpen}
                      className="py-2.5 rounded-full border border-[#E7E2F0] text-[14px] font-bold text-[#191224] hover:border-[#B42318] hover:text-[#B42318] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {p.status === "refusee" ? "Refusée" : "Refuser"}
                    </button>
                    {canChat ? (
                      <Link
                        href={`/missions/${missionId}?providerId=${p.provider.id}&chat=1`}
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-[#E7E2F0] text-[14px] font-bold text-[#191224] hover:border-[#4C1D95]"
                        style={{ textDecoration: "none" }}
                      >
                        <MessageCircle className="w-4 h-4" aria-hidden /> Ouvrir le chat
                      </Link>
                    ) : (
                      <span className="flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-[#E7E2F0] text-[14px] font-bold text-[#191224] opacity-40" aria-disabled="true">
                        <MessageCircle className="w-4 h-4" aria-hidden /> Ouvrir le chat
                      </span>
                    )}
                  </div>

                  {chosen ? (
                    <Link
                      href={`/missions/${missionId}/contract`}
                      className="mt-2 flex items-center justify-center py-3 rounded-full bg-[#047857] text-white text-[14px] font-bold hover:bg-[#065F46]"
                      style={{ textDecoration: "none" }}
                    >
                      Prestataire choisi — voir le contrat
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setChoiceId(p.id)}
                      disabled={!canChoose}
                      title={canChoose ? undefined : isQuote && isOpen ? "Le devis doit être en négociation pour être validé" : undefined}
                      className="mt-2 w-full py-3 rounded-full bg-[#4C1D95] text-white text-[14px] font-bold hover:bg-[#3B1578] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Choisir ce prestataire
                    </button>
                  )}
              </CandidateCard>
            );
          })}
        </div>
      )}

      {choice && (
        <ChoiceRecap
          missionId={missionId}
          proposal={choice}
          others={proposals.filter((o) => o.id !== choice.id && OPEN.includes(o.status))}
          isQuote={isQuote}
          currency={currency}
          missionBudget={missionBudget}
          delayLabel={delayOf(choice, missionDelaiJours)}
          price={priceOf(choice, isQuote)}
          avatarGradient={gradientOf(choice)}
          placesLeft={placesLeft}
          onClose={() => setChoiceId(null)}
          onDone={onChanged}
        />
      )}
    </section>
  );
}

// Haut de carte commun aux candidatures en attente et aux prestataires retenus : identité,
// note, missions, statut, message, compétences, prix et délai. Les actions sont passées en
// `children`, sous le prix.
function CandidateCard({
  p,
  gradient,
  badge,
  isQuote,
  currency,
  missionDelaiJours,
  onDetail,
  priceLabel,
  children,
}: {
  p: DevisProposalPayload;
  gradient: string;
  badge: { label: string; cls: string };
  isQuote: boolean;
  currency: string;
  missionDelaiJours: number | null;
  onDetail?: () => void;
  priceLabel?: string;
  children: React.ReactNode;
}) {
  const price = priceOf(p, isQuote);
  return (
    <article className="rounded-3xl border border-[#E7E2F0] bg-white p-5 flex flex-col pop">
      <div className="flex items-start gap-3">
        <Avatar src={p.provider.avatarPath ? `/api/users/${p.provider.id}/avatar` : null} initials={initialsOf(p)} size={56} gradient={gradient} />
        <div className="min-w-0">
          <h2 className="font-bold text-[16px] text-[#191224] truncate">{authorDisplayName(p.provider)}</h2>
          <p className="text-[14px] text-[#4A4258] flex items-center gap-1">
            <Star className="w-4 h-4 fill-[#F59E0B] text-[#F59E0B]" aria-hidden />
            {p.averageRating != null ? p.averageRating.toFixed(1) : "Nouveau"} • {p.missionsCompleted ?? 0} mission{(p.missionsCompleted ?? 0) > 1 ? "s" : ""}
          </p>
          <span className={`inline-flex mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
        </div>
      </div>

      <p className="mt-4 text-[14px] leading-relaxed text-[#191224] line-clamp-3">{p.message || "Aucun message joint à cette candidature."}</p>
      {onDetail && (
        <button type="button" onClick={onDetail} className="self-start mt-1 text-[13px] font-semibold text-[#4C1D95] hover:underline">
          {isQuote ? "Voir le devis détaillé →" : "Voir le détail →"}
        </button>
      )}

      {(p.skills?.length ?? 0) > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {p.skills!.map((s) => (
            <li key={s} className="rounded-full bg-[#EFEAF8] px-2.5 py-1 text-[12px] text-[#191224]">{s}</li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[13px] text-[#6B6478]">{priceLabel ?? (isQuote ? "Devis TTC" : "Prix proposé")}</p>
            <p className="font-extrabold text-[16px] text-[#047857]">{price != null ? fmtMoney(price, currency) : "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-[13px] text-[#6B6478]">Délai</p>
            <p className="font-extrabold text-[16px] text-[#191224]">{delayOf(p, missionDelaiJours)}</p>
          </div>
        </div>
        {children}
      </div>
    </article>
  );
}

// « Retirer ce prestataire » (2026-11-11) — le client annule l'engagement d'un prestataire
// retenu (désistement annoncé, absence de réponse), motif obligatoire. POST /api/missions/[id]/
// withdraw sur l'ENGAGEMENT ; sa place se libère et peut être pourvue par un candidat de la
// réserve.
export function WithdrawButton({
  engagementId,
  providerName,
  onDone,
  label = "Changer ce prestataire",
  reasonLabel,
  hint = "Son engagement sera annulé et sa place libérée : vous choisirez ensuite un autre candidat, par exemple parmi vos favoris.",
  variant = "button",
}: {
  engagementId: string;
  providerName: string;
  onDone: () => void;
  label?: string;
  reasonLabel?: string;
  hint?: string;
  /** « button » : bouton pleine largeur (carte d'un retenu) ; « link » : lien discret. */
  variant?: "button" | "link";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/missions/${engagementId}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setPending(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "Le retrait a échoué. Réessayez.");
      return;
    }
    setOpen(false);
    onDone();
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === "button"
            ? "mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-full border border-[#E7E2F0] bg-white text-[14px] font-bold text-[#191224] hover:border-[#B42318] hover:text-[#B42318] transition"
            : "mt-2 self-center text-[12px] font-semibold text-[#B42318] hover:underline"
        }
      >
        {variant === "button" && <RefreshCw className="w-4 h-4" aria-hidden />}
        {label}
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-2xl border border-[#F5C2BE] bg-[#FEECEB] p-3 text-left">
      <label htmlFor={`withdraw-${engagementId}`} className="text-[12px] font-semibold text-[#912018]">
        {reasonLabel ?? `Pourquoi changer ${providerName} ?`} <span aria-hidden>*</span>
      </label>
      <textarea
        id={`withdraw-${engagementId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Ex. : le prestataire s'est désisté par message, ne répond plus…"
        className="mt-1 text-[13px]"
      />
      <p className="mt-1 text-[11px] text-[#912018]">{hint}</p>
      {error && <p role="alert" className="mt-1 text-[12px] font-semibold text-[#B42318]">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || reason.trim().length < 3}
          className="px-3 py-2 rounded-full bg-[#B42318] text-white text-[12px] font-bold disabled:opacity-50"
        >
          {pending ? "Confirmation…" : variant === "button" ? "Confirmer le changement" : "Confirmer le retrait"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="px-3 py-2 rounded-full border border-[#E7E2F0] bg-white text-[12px] font-bold">
          Annuler
        </button>
      </div>
    </div>
  );
}
