// Fiche publique d'une mission — format « fiche mission » de la maquette (2026-11-11) : en-tête
// dégradé, budget, description, conditions, carte du client, colonne « Paiement protégé » et
// « Date limite ».
//
// Données filtrées par le serveur (src/lib/public-mission.ts) : jamais le nom du client, ni le
// cahier des charges, ni les pièces jointes. Seul le CLIENT PROPRIÉTAIRE, reconnu côté serveur
// (src/app/missions/[id]/publique/page.tsx), reçoit en plus son nom, sa ville et son nombre de
// missions publiées — et les actions de gestion (« Voir / Gérer les candidatures »).
//
// Actions selon qui regarde :
//   - visiteur non connecté : « Candidater » → connexion, retour sur la mission formulaire ouvert ;
//   - membre connecté (prestataire ou client) : « Candidater » → /missions/[id]?candidater=1, où
//     le parcours existant ouvre le formulaire (ou l'espace prestataire pour un compte client) ;
//   - propriétaire : gestion des candidatures, aucune candidature possible.

import Link from "next/link";
import { ArrowRight, Calendar, Clock, MapPin, ShieldCheck, Users } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { countryFlag } from "@/lib/country-flag";
import { countryName } from "@/lib/world-countries";
import { PROFESSIONAL_TYPE_LABELS } from "@/lib/provider-options";
import { withCallbackUrl } from "@/lib/safe-callback";
import { categoryColor } from "@/components/dashboard/proto-ui";
import type { PublicMission } from "@/lib/public-mission";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
import { placesRecherchees } from "@/lib/mission-expiry";

const JALON_STATUS: Record<string, { label: string; cls: string }> = {
  en_attente: { label: "À financer", cls: "bg-[#EFEAF8] text-[#6B6478]" },
  fonds_sous_sequestre: { label: "Financé", cls: "bg-[#F0EAFF] text-[#4C1D95]" },
  livrable_soumis: { label: "À valider", cls: "bg-[#FFF6E3] text-[#B45309]" },
  valide: { label: "Validé", cls: "bg-[#E7F7EF] text-[#047857]" },
  rejete: { label: "À reprendre", cls: "bg-[#FEECEB] text-[#B42318]" },
  libere: { label: "Payé", cls: "bg-[#E7F7EF] text-[#047857]" },
};

const MODE_LABEL = { presentiel: "Sur site", distance: "À distance", hybride: "Hybride" } as const;
const fmt = (n: number) => n.toLocaleString("fr-FR");
const money = (n: number, currency: string) => `${fmt(n)} ${currency === "XOF" ? "FCFA" : currency}`;

function budgetLabel(m: PublicMission) {
  if (!m.isQuote) return money(m.budget, m.currency);
  if (m.budgetMin && m.budgetMax) return `${fmt(m.budgetMin)} – ${money(m.budgetMax, m.currency)}`;
  return "Sur devis";
}

export type PublicMissionViewer =
  | { kind: "visitor" }
  | { kind: "member" }
  | { kind: "owner"; fullName: string; city: string | null; missionsPubliees: number };

export function PublicMissionView({ mission: m, viewer = { kind: "visitor" } }: { mission: PublicMission; viewer?: PublicMissionViewer }) {
  const isOwner = viewer.kind === "owner";
  const applyHref =
    viewer.kind === "member" ? `/missions/${m.id}?candidater=1` : withCallbackUrl("/signin", `/missions/${m.id}?candidater=1`);
  const signupHref = withCallbackUrl("/signup", `/missions/${m.id}?candidater=1`);
  const proposalsHref = `/missions/${m.id}/proposals`;
  const lieu = m.mode === "distance" ? MODE_LABEL.distance : [m.ville, countryName(m.pays) ?? m.pays].filter(Boolean).join(", ") || MODE_LABEL[m.mode];
  // `maxCandidatures` = prestataires RECHERCHÉS (src/lib/mission-expiry.ts), pas un plafond de
  // candidatures. Toutes les places prises, l'annonce reste ouverte jusqu'à sa date limite :
  // on le signale, sans retirer « Candidater » (même règle que la fiche /missions/[id]).
  const places = placesRecherchees({ maxCandidatures: m.maxCandidatures });
  const retenus = m.engagements?.length ?? m.prestatairesRetenus ?? 0;
  const placesFull = retenus >= places;
  const applyLabel = m.isQuote ? "Envoyer un devis" : "Candidater";
  // `status` n'est fourni qu'en vue propriétaire : absent = mission publiée (vue publique).
  const isPublished = !m.status || m.status === "publiee";
  const statusLabel = isPublished ? "Publique" : (MISSION_STATUS_STYLE[m.status as keyof typeof MISSION_STATUS_STYLE]?.label ?? m.status);
  const contract = m.contract ?? null;
  const delai = contract?.delaiJours ?? m.delaiJours;
  const deadline = isPublished && m.dateExpiration ? new Date(m.dateExpiration) : null;
  const nbCandidatures = m.candidaturesTotal ?? m.candidatures;
  const candidaturesLabel = `${nbCandidatures} candidature${nbCandidatures > 1 ? "s" : ""}`;
  const retenusLabel = `${retenus}/${places} prestataire${places > 1 ? "s" : ""} retenu${retenus > 1 ? "s" : ""}`;

  const conditions: { label: string; value: string }[] = [
    { label: "Mode", value: MODE_LABEL[m.mode] },
    ...(m.dateDebut ? [{ label: "Début", value: new Date(m.dateDebut).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) }] : []),
    ...(m.professionalType ? [{ label: "Profil recherché", value: PROFESSIONAL_TYPE_LABELS[m.professionalType] ?? m.professionalType }] : []),
    ...(m.requiredLevel ? [{ label: "Niveau", value: m.requiredLevel }] : []),
    ...(m.categorie ? [{ label: "Catégorie", value: m.categorie }] : []),
  ];

  return (
    <main className="min-h-screen bg-[#F6F5FA]">
      <div className="mx-auto max-w-[1240px] px-4 py-6 md:py-8">
        {isOwner ? <BackLink href="/client/dashboard" label="Retour au tableau de bord" /> : <BackLink href="/" label="Retour à l'accueil" />}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <article className="min-w-0 rounded-3xl border border-[#E7E2F0] bg-white overflow-hidden">
            {/* En-tête dégradé */}
            <header className="p-6 md:p-7 text-white" style={{ background: `linear-gradient(120deg, ${categoryColor(m.metier)}, #0f766e)` }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-bold bg-black/25 px-2.5 py-1 rounded-full">
                  {statusLabel} • {m.icon && <span aria-hidden className="mr-0.5">{m.icon}</span>}
                  {m.metier}
                </span>
                {m.urgent && <span className="text-[12px] font-bold bg-[#B42318] px-2.5 py-1 rounded-full">Urgent</span>}
                {m.parent && (
                  <Link href={`/missions/${m.parent.id}/publique`} className="text-[12px] font-bold bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded-full text-white" style={{ textDecoration: "none" }}>
                    Engagement de l&apos;annonce « {m.parent.titre} » →
                  </Link>
                )}
              </div>
              <h1 className="font-display font-extrabold leading-[1.08] mt-3" style={{ fontSize: "clamp(26px, 3.8vw, 42px)" }}>{m.titre}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] font-medium text-white/90">
                <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" aria-hidden />{lieu}</span>
                <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden />{delai} jour{delai > 1 ? "s" : ""}{contract?.delaiJours ? " (contrat)" : ""}</span>
                <span className="inline-flex items-center gap-1"><Calendar className="w-4 h-4" aria-hidden />Publiée {m.publishedAgo}</span>
              </div>
            </header>

            <div className="p-6 md:p-7 space-y-6">
              {/* Budget + candidatures */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[12px] text-[#6B6478]">{contract ? "Prix convenu (contrat)" : m.isQuote ? "Budget indicatif • Sur devis" : "Budget"}</p>
                  <p className="font-display font-extrabold text-[#047857] leading-none mt-1" style={{ fontSize: "clamp(26px, 3.2vw, 34px)" }}>{contract ? money(contract.price, m.currency) : budgetLabel(m)}</p>
                  {!contract && m.isQuote && m.budgetMin && m.budgetMax && (
                    <p className="text-[13px] text-[#6B6478] mt-1">Fourchette indicative : {money(m.budgetMin, m.currency)} — {money(m.budgetMax, m.currency)}</p>
                  )}
                </div>
                <div className="text-right">
                  {contract?.providerName || m.retainedProviderName ? (
                    <p className="text-[14px] text-[#6B6478]">Prestataire retenu<br /><span className="font-bold text-[#191224]">{contract?.providerName || m.retainedProviderName}</span></p>
                  ) : (
                    <>
                      <p className="text-[14px] font-bold text-[#191224]">{candidaturesLabel}</p>
                      {isPublished && <p className="text-[13px] text-[#6B6478]">{retenusLabel}</p>}
                    </>
                  )}
                  {isOwner && isPublished && (
                    <Link href={proposalsHref} className="mt-2 inline-flex px-4 py-2 rounded-full bg-[#4C1D95] text-white text-[13px] font-bold hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                      {m.isQuote ? "Voir les devis" : "Voir les candidatures"}
                    </Link>
                  )}
                </div>
              </div>

              <section>
                <h2 className="font-display font-bold text-[16px] text-[#191224] mb-2">Description du besoin</h2>
                <p className="whitespace-pre-line text-[15px] leading-[1.65] text-[#191224]">{m.description}</p>
              </section>

              {/* Timeline des jalons — contrat à jalons, vue propriétaire */}
              {contract && contract.jalons.length > 0 && (
                <section>
                  <h2 className="font-display font-bold text-[16px] text-[#191224] mb-3">Timeline des jalons</h2>
                  <ol className="space-y-2">
                    {contract.jalons.map((j) => {
                      const js = JALON_STATUS[j.status] ?? { label: j.status, cls: "bg-[#EFEAF8] text-[#6B6478]" };
                      return (
                        <li key={j.ordre} className="rounded-2xl border border-[#E7E2F0] px-4 py-3 flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full bg-[#F0EAFF] text-[#4C1D95] grid place-items-center shrink-0" aria-hidden>
                            <Calendar className="w-4 h-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[14px] text-[#191224]">Jalon {j.ordre} — {j.titre}</p>
                            <span className={`inline-flex mt-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${js.cls}`}>{js.label}</span>
                          </div>
                          <span className="font-extrabold text-[14px] text-[#047857] whitespace-nowrap">{money(j.montant, m.currency)}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              {/* Conditions */}
              {conditions.length > 0 && (
                <section>
                  <h2 className="font-display font-bold text-[16px] text-[#191224] mb-3">Conditions de la mission</h2>
                  <dl className="grid sm:grid-cols-2 gap-2 text-[13px]">
                    {conditions.map((c) => (
                      <div key={c.label} className="rounded-2xl border border-[#E7E2F0] px-4 py-3 flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-[#F0EAFF] text-[#4C1D95] grid place-items-center shrink-0" aria-hidden>
                          <Calendar className="w-4 h-4" />
                        </span>
                        <div>
                          <dt className="text-[12px] text-[#6B6478]">{c.label}</dt>
                          <dd className="font-bold text-[#191224]">{c.value}</dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {m.competences.length > 0 && (
                <section>
                  <h2 className="font-display font-bold text-[16px] text-[#191224] mb-3">Compétences recherchées</h2>
                  <ul className="flex flex-wrap gap-1.5">
                    {m.competences.map((c) => (
                      <li key={c} className="rounded-full bg-[#F0EAFF] px-3 py-1 text-[12px] font-semibold text-[#4C1D95]">{c}</li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Carte du client — nominative pour le propriétaire seulement */}
              <div className="rounded-2xl bg-[#EFEAF8] p-4 flex items-center gap-3">
                <span className="w-12 h-12 rounded-full bg-[#4C1D95] text-white font-bold grid place-items-center shrink-0" aria-hidden>
                  {isOwner ? viewer.fullName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() : <Users className="w-5 h-5" />}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-[15px] text-[#191224]">{isOwner ? `${viewer.fullName} (vous)` : "Client"}</p>
                  <p className="text-[13px] text-[#6B6478] flex flex-wrap items-center gap-x-1.5">
                    {m.clientCountry && (
                      <span role="img" aria-label={`Client : ${countryName(m.clientCountry) ?? m.clientCountry}`}>{countryFlag(m.clientCountry)}</span>
                    )}
                    {m.clientVerified ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[#047857]"><ShieldCheck className="w-3.5 h-3.5" aria-hidden />Identité vérifiée</span>
                    ) : (
                      <span className="font-semibold text-[#B45309]">Identité non vérifiée</span>
                    )}
                    {isOwner && viewer.city && <span>• {viewer.city}</span>}
                    {isOwner && <span>• {viewer.missionsPubliees} mission{viewer.missionsPubliees > 1 ? "s" : ""} publiée{viewer.missionsPubliees > 1 ? "s" : ""}</span>}
                  </p>
                </div>
              </div>

              {!isOwner && (
                <p className="rounded-2xl bg-[#F6F5FA] px-4 py-3 text-[13px] leading-relaxed text-[#6B6478]">
                  Le cahier des charges, les documents joints et l&apos;identité du client sont communiqués aux prestataires
                  connectés qui candidatent.
                </p>
              )}

              {/* Action principale */}
              {isOwner && !isPublished ? (
                // Mission engagée : le suivi (validation des livrables, séquestre) vit sur
                // /missions/[id] — l'espace de validation du client.
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link href={`/missions/${m.id}`} className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#4C1D95] text-white text-[15px] font-bold hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                    Suivre la mission <ArrowRight className="w-4 h-4" aria-hidden />
                  </Link>
                  {contract && (
                    <Link href={`/missions/${m.id}/contract`} className="flex items-center justify-center px-6 py-3.5 rounded-full border border-[#E7E2F0] bg-white text-[15px] font-bold text-[#191224] hover:border-[#4C1D95]" style={{ textDecoration: "none" }}>
                      Voir le contrat
                    </Link>
                  )}
                </div>
              ) : isOwner ? (
                <Link href={proposalsHref} className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full bg-[#4C1D95] text-white text-[15px] font-bold hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                  {m.isQuote ? "Gérer les devis" : "Gérer les candidatures"} <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
              ) : (
                <div>
                  {placesFull && (
                    <p className="mb-2 rounded-2xl bg-[#FFF6E3] px-4 py-3 text-[13px] text-[#B45309]">
                      Le client a déjà retenu le nombre de prestataires recherchés. L&apos;annonce reste ouverte jusqu&apos;à sa date limite.
                    </p>
                  )}
                  <a href={applyHref} className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full bg-[#4C1D95] text-white text-[15px] font-bold hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                    {applyLabel} <ArrowRight className="w-4 h-4" aria-hidden />
                  </a>
                  {viewer.kind === "visitor" && (
                    <p className="mt-2 text-center text-[13px] text-[#6B6478]">
                      Connexion requise.{" "}
                      <a href={signupHref} className="font-semibold text-[#4C1D95] hover:underline">Créer un compte</a>
                    </p>
                  )}
                </div>
              )}
            </div>
          </article>

          <aside className="space-y-4 lg:sticky lg:top-20">
            {/* Ne promet que ce que la plateforme fait réellement. */}
            <div className="rounded-3xl border border-[#E7E2F0] bg-white p-5">
              <ShieldCheck className="w-6 h-6 text-[#047857]" aria-hidden />
              <h2 className="font-display font-bold text-[17px] text-[#191224] mt-2">Paiement protégé</h2>
              <p className="text-[13px] text-[#6B6478] mt-1">Fonds séquestrés avant démarrage. Libération à la validation de chaque jalon.</p>
              <ul className="mt-3 space-y-2 text-[13px] text-[#191224]">
                <li>✓ Aucun versement sans validation du client</li>
                <li>✓ Médiation en cas de litige</li>
                <li>✓ Contrat signé par les deux parties</li>
              </ul>
            </div>

            {deadline && (
              <div className="rounded-3xl p-5 text-white bg-[#4C1D95]">
                <p className="font-display font-bold text-[16px]">
                  Date limite : {deadline.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
                <p className="text-[13px] text-white/85 mt-1.5">
                  {isOwner ? "Comparez les candidatures et retenez un prestataire avant cette date." : "Les candidatures sont reçues jusqu'à cette date."}
                </p>
                {isOwner ? (
                  <Link href={proposalsHref} className="mt-3 inline-flex px-4 py-2 rounded-full bg-white text-[#4C1D95] text-[13px] font-bold hover:bg-[#F0EAFF]" style={{ textDecoration: "none" }}>
                    Comparer les profils
                  </Link>
                ) : (
                  <a href={applyHref} className="mt-3 inline-flex px-4 py-2 rounded-full bg-white text-[#4C1D95] text-[13px] font-bold hover:bg-[#F0EAFF]" style={{ textDecoration: "none" }}>
                    {applyLabel} maintenant
                  </a>
                )}
              </div>
            )}

            {isOwner ? (
              isPublished && (
                <Link href={`/missions/${m.id}`} className="block text-center text-[13px] font-semibold text-[#4C1D95] hover:underline">
                  Fiche de suivi de la mission →
                </Link>
              )
            ) : (
              <Link href="/missions/new" className="block text-center text-[13px] font-semibold text-[#4C1D95] hover:underline">
                Vous avez un besoin ? Publier une mission
              </Link>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
