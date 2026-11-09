"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Avatar } from "@/components/avatar";
import { IdentityBadge, DeclaredBadge } from "@/components/IdentityBadge";
import { MapPin } from "lucide-react";
import {
  AVAILABILITY_LABELS,
  DEPLACEMENTS,
  PROVIDER_KIND_LABELS,
  PROVIDER_ROLE_LABELS,
  WORK_MODES,
} from "@/lib/provider-options";
import { countryName } from "@/lib/world-countries";
import { safeCallbackUrl } from "@/lib/safe-callback";
import { BackLink } from "@/components/BackLink";
import { isExternalLink } from "@/components/profile/PortfolioEditor";
import { GigServiceCard } from "@/components/gig/GigServiceCard";
import { countryFlag } from "@/lib/country-flag";
import { languageLabel, levelLabel } from "@/lib/languages";
import type { GigView } from "@/lib/gig-serialize";

// Profil public d'un prestataire — alimenté par les DONNÉES RÉELLES de
// /api/users/[id]/public-profile (modèle v3, trois blocs strictement séparés) :
//   1. Vérifié par Flexwork — identité uniquement (badge unique « Identité vérifiée »)
//   2. Déclaré par le prestataire (non vérifié) — tout ce que remplit le parcours /profile
//   3. Activité sur la plateforme — faits d'usage constatés
//
// Points importants en tête (2026-11-07) : titre, type de prestataire et une rangée de faits
// clés (expérience, disponibilité, modes, zone, diplôme d'État, tarif) — ce qu'un client
// cherche avant de lire le reste. La page n'affichait jusque-là ni le titre, ni la
// présentation détaillée, ni les expériences, ni les diplômes saisis dans le profil, et
// « Qualification — » s'affichait vide : les diplômes ne vivent plus dans `label`.
//
// Mise en page (2026-11-08) inspirée des profils de place de marché de services : identité,
// note et langues en tête ; « À propos » et compétences ; SERVICES (Gigs à trois formules) ;
// portfolio en galerie ; parcours déclaré ; AVIS avec répartition des notes. Colonne latérale :
// tarif, action, garantie du séquestre. Rien n'est affiché sans donnée réelle : ni « en ligne »,
// ni temps de réponse, ni sous-notes — la plateforme ne les mesure pas.

type Diploma = {
  qualificationName: string;
  specialty: string | null;
  year: number | null;
  country: string | null;
  institution: string | null;
  isStateIssued: boolean;
};

type Experience = {
  role: string;
  clientType: string;
  clientName: string | null;
  domain: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
};

type PublicProfile = {
  identite: {
    prenom: string | null;
    nom: string | null;
    role: string | null;
    pays: string | null;
    ville: string | null;
    avatarPath: string | null;
  };
  verifie: { identiteVerifiee: boolean; badgeMetier?: string | null };
  declare: {
    mainDomain: string | null;
    metierId?: string | null;
    declaredLevel: string | null;
    declaredExperienceYears: number | null;
    indicativeRate: number | null;
    tarifUnite: string | null;
    tags: string[];
    description: string | null;
    title?: string | null;
    languages?: { code: string; niveau: string }[];
    confirmedSkills?: string[];
    providerKind?: string | null;
    overview?: string | null;
    currency?: string | null;
    workModes?: string[];
    coverageZones?: string[];
    deplacement?: string[];
    availability?: string | null;
    diplomas?: Diploma[];
    experiences?: Experience[];
    portfolioUrls: string[];
    cvUrl: string | null;
    zonePays: string | null;
    zoneVille: string | null;
    zoneRayonKm: number | null;
    insurance: {
      insurerName: string | null;
      policyNumber: string | null;
      coverageCeiling: number | null;
      validUntil: string | null;
    } | null;
    qualification: { label: string | null } | null;
    mention: string;
  };
  activite: {
    missionsCompleted: number;
    averageNote: number | null;
    reviewCount?: number;
    ratingBreakdown?: { note: number; count: number }[];
    memberSince: string;
  };
  services?: (Omit<GigView, "createdAt"> & { createdAt: string; ordersCount: number })[];
  avis?: { id: string; note: number; commentaire: string | null; createdAt: string; pays: string | null; metier: string | null }[];
};

const ROLE_LABELS: Record<string, string> = {
  client: "Client",
  ...PROVIDER_ROLE_LABELS,
};

const TARIF_UNITE_LABELS: Record<string, string> = {
  heure: " / heure",
  jour: " / jour",
  semaine: " / semaine",
  mois: " / mois",
  mission: " / mission",
};

// Devise du tarif (étape Configuration) — affichée en sigle court à côté du montant.
const CURRENCY_SHORT: Record<string, string> = { XOF: "FCFA", NGN: "NGN", EUR: "€", USD: "$" };

const LEVEL_LABELS: Record<string, string> = {
  debutant: "Débutant",
  intermediaire: "Intermédiaire",
  senior: "Senior",
  expert: "Expert",
};

const WORK_MODE_LABELS: Record<string, string> = Object.fromEntries(WORK_MODES.map((o) => [o.value, o.label]));
const DEPLACEMENT_LABELS: Record<string, string> = Object.fromEntries(DEPLACEMENTS.map((o) => [o.value, o.label]));

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function formatMonth(v: string | null): string | null {
  const m = v ? /^(\d{4})-(\d{2})$/.exec(v) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : v;
}
function formatPeriod(start: string | null, end: string | null): string | null {
  const a = formatMonth(start);
  const b = formatMonth(end);
  if (a && b) return `${a} → ${b}`;
  if (a) return `Depuis ${a}`;
  return b ? `Jusqu'en ${b}` : null;
}

export default function TalentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const isOwner = (session?.user as { id?: string } | undefined)?.id === id;
  const [data, setData] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [reviewsShown, setReviewsShown] = useState(5);

  // Bouton de retour, par ordre de priorité :
  //   1. `?returnTo=` sûr (recherche avec ses filtres, accueil, devis…) ;
  //   2. `?missionId=` (lien « Voir profil » des propositions) → les propositions de la mission ;
  //   3. le titulaire du profil → son espace d'édition ;
  //   4. un visiteur arrivé directement → la recherche de prestataires.
  const [origin, setOrigin] = useState<{ returnTo: string | null; missionId: string | null }>({
    returnTo: null,
    missionId: null,
  });
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const missionId = sp.get("missionId");
    setOrigin({
      returnTo: safeCallbackUrl(sp.get("returnTo")),
      missionId: missionId && /^[A-Za-z0-9_-]{1,64}$/.test(missionId) ? missionId : null,
    });
  }, []);
  const back = origin.returnTo
    ? { href: origin.returnTo, label: "Revenir à la page précédente" }
    : origin.missionId
      ? { href: `/missions/${origin.missionId}/proposals`, label: "Retour aux propositions" }
      : isOwner
        ? { href: "/profile", label: "Retour à mon profil" }
        : { href: "/recherche", label: "Retour à la recherche" };

  useEffect(() => {
    if (!id) return;
    fetch(`/api/users/${id}/public-profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) setNotFound(true);
        else setData(d);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAF9]" aria-busy="true" aria-label="Chargement du profil">
        <div className="page-shell py-8 lg:py-12 space-y-5 animate-pulse">
          <div className="h-[220px] rounded-2xl bg-white border border-[#E2E8F0]" />
          <div className="grid lg:grid-cols-[1fr_340px] gap-5">
            <div className="h-[360px] rounded-2xl bg-white border border-[#E2E8F0]" />
            <div className="h-[200px] rounded-2xl bg-white border border-[#E2E8F0]" />
          </div>
        </div>
      </div>
    );
  }
  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex flex-col items-center justify-center gap-4 text-[13px] text-[#64748B]">
        Profil introuvable.
        <BackLink href={back.href} label={back.label} />
      </div>
    );
  }

  const { identite, verifie, declare, activite } = data;
  const fullName = [identite.prenom, identite.nom].filter(Boolean).join(" ") || "Prestataire";
  // « Publier une mission » depuis ce profil (2026-11-08) : la mission part directement dans le
  // métier du prestataire, qui est invité à candidater à la publication (le serveur revérifie
  // qu'il est listé et du bon domaine). Sans métier au catalogue, formulaire vierge.
  const publishHref = declare.metierId
    ? `/missions/new?${new URLSearchParams({ metierId: declare.metierId, pour: id, nom: identite.prenom ?? fullName }).toString()}`
    : "/missions/new";
  const initials = `${identite.prenom?.[0] ?? ""}${identite.nom?.[0] ?? ""}`.toUpperCase() || "?";
  const roleLabel = ROLE_LABELS[identite.role ?? ""] ?? identite.role ?? "Prestataire";
  const kindLabel = declare.providerKind ? PROVIDER_KIND_LABELS[declare.providerKind] : null;
  const zone = [declare.zoneVille, countryName(declare.zonePays) ?? declare.zonePays].filter(Boolean).join(", ");
  const diplomas = declare.diplomas ?? [];
  const experiences = declare.experiences ?? [];
  const workModes = (declare.workModes ?? []).map((m) => WORK_MODE_LABELS[m] ?? m);
  const coverage = declare.coverageZones ?? [];
  const deplacement = (declare.deplacement ?? []).map((d) => DEPLACEMENT_LABELS[d] ?? d);
  const stateDiploma = diplomas.find((d) => d.isStateIssued);
  const currency = CURRENCY_SHORT[declare.currency ?? "XOF"] ?? declare.currency ?? "FCFA";
  const rate = declare.indicativeRate
    ? `${declare.indicativeRate.toLocaleString("fr-FR")} ${currency}${TARIF_UNITE_LABELS[declare.tarifUnite ?? "jour"] ?? ""}`
    : null;
  const experienceFact =
    declare.declaredExperienceYears != null
      ? `${declare.declaredExperienceYears} an${declare.declaredExperienceYears > 1 ? "s" : ""}${
          declare.declaredLevel ? ` · ${LEVEL_LABELS[declare.declaredLevel] ?? declare.declaredLevel}` : ""
        }`
      : declare.declaredLevel
        ? (LEVEL_LABELS[declare.declaredLevel] ?? declare.declaredLevel)
        : null;

  // Points importants : seuls les faits RENSEIGNÉS s'affichent — une case « Non renseigné »
  // n'apprend rien au client et alourdit la lecture.
  const keyFacts: { label: string; value: string; tone?: "green" }[] = [
    experienceFact && { label: "Expérience", value: experienceFact },
    declare.availability && {
      label: "Disponibilité",
      value: AVAILABILITY_LABELS[declare.availability] ?? declare.availability,
      tone: declare.availability === "indisponible" ? undefined : ("green" as const),
    },
    workModes.length > 0 && { label: "Intervient", value: workModes.join(" · ") },
    (zone || declare.zoneRayonKm) && {
      label: "Zone",
      value: [declare.zoneVille || zone, declare.zoneRayonKm ? `${declare.zoneRayonKm} km` : null].filter(Boolean).join(" · "),
    },
    stateDiploma && { label: "Diplôme d'État", value: stateDiploma.qualificationName },
    rate && { label: "Tarif indicatif", value: rate },
  ].filter(Boolean) as { label: string; value: string; tone?: "green" }[];

  function portfolioUrl(relPath: string) {
    return `/api/profile/portfolio-file?p=${encodeURIComponent(relPath)}`;
  }

  const languages = declare.languages ?? [];
  const confirmed = new Set((declare.confirmedSkills ?? []).map((t) => t.toLocaleLowerCase("fr")));
  // Compétences confirmées d'abord : ce sont celles qu'un client peut croire sur parole.
  const skills = [...declare.tags].sort((a, b) => Number(confirmed.has(b.toLocaleLowerCase("fr"))) - Number(confirmed.has(a.toLocaleLowerCase("fr"))));
  const SKILLS_SHOWN = 6;
  const services = data.services ?? [];
  const avis = data.avis ?? [];
  const reviewCount = activite.reviewCount ?? avis.length;
  const breakdown = activite.ratingBreakdown ?? [];
  const photos = declare.portfolioUrls.filter((u) => !isExternalLink(u));
  const links = declare.portfolioUrls.filter(isExternalLink);
  const featured = photos[Math.min(photoIndex, photos.length - 1)];
  const about = declare.overview?.trim() ?? "";
  const ABOUT_PREVIEW = 420;
  const country = countryName(identite.pays) ?? identite.pays;

  return (
    <div className="min-h-screen bg-[#F8FAF9]">
      <div className="page-shell py-8 lg:py-12 space-y-5">
        <BackLink href={back.href} label={back.label} />

        <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            {/* ── En-tête : identité, note, vérifications, langues ── */}
            <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 sm:p-6">
              <div className="flex flex-wrap items-start gap-4">
                <Avatar
                  src={identite.avatarPath ? `/api/users/${id}/avatar` : null}
                  initials={initials}
                  size={88}
                  gradient="from-[#008751] to-[#FCD116]"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-[22px] lg:text-[26px] font-bold leading-tight text-[#0f172a]">
                    {fullName}{" "}
                    {identite.pays && (
                      <span role="img" aria-label={country ?? undefined} title={country ?? undefined} className="text-[20px] align-middle">
                        {countryFlag(identite.pays)}
                      </span>
                    )}
                  </h1>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-[#475569]">
                    {activite.averageNote != null && reviewCount > 0 ? (
                      <a href="#avis" className="inline-flex items-center gap-1 hover:underline">
                        <span className="text-[#F7C948]" aria-hidden>
                          ★
                        </span>
                        <span className="font-semibold text-[#0f172a]">{activite.averageNote.toFixed(1)}</span>
                        <span>({reviewCount} avis)</span>
                      </a>
                    ) : (
                      <span className="rounded-full bg-[#F7F7F5] px-2 py-0.5 text-[12px] font-semibold text-[#0f172a]">Nouveau sur Flexwork</span>
                    )}
                    {activite.missionsCompleted > 0 && (
                      <span>
                        · {activite.missionsCompleted} mission{activite.missionsCompleted > 1 ? "s" : ""} terminée
                        {activite.missionsCompleted > 1 ? "s" : ""}
                      </span>
                    )}
                  </p>
                  {declare.title && <p className="mt-1.5 text-[15px] font-medium text-[#334155]">{declare.title}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[#64748B]">
                    {declare.mainDomain && (
                      <span className="px-2.5 py-0.5 rounded-full bg-[#0f172a] text-white text-[12px] font-semibold">{declare.mainDomain}</span>
                    )}
                    <span>{kindLabel ?? roleLabel}</span>
                    {zone && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {zone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Vérifié par Flexwork : identité, et badge « Vérifié » pour un métier précis. */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <IdentityBadge verified={verifie.identiteVerifiee} />
                {verifie.badgeMetier && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#008751]/25 bg-[#008751]/5 px-3 py-1 text-[12px] font-semibold text-[#008751]">
                    ✓ Vérifié pour : {verifie.badgeMetier}
                  </span>
                )}
              </div>

              {languages.length > 0 && (
                <p className="mt-3 text-[13px] text-[#475569]">
                  <span className="font-semibold text-[#0f172a]">Langues : </span>
                  {languages.map((l) => `${languageLabel(l.code)} (${levelLabel(l.niveau).toLowerCase()})`).join(" · ")}
                </p>
              )}

              {(declare.description || about) && (
                <div className="mt-5">
                  <h2 className="text-[15px] font-bold text-[#0f172a]">À propos</h2>
                  {declare.description && <p className="mt-2 text-[14px] text-[#475569] leading-relaxed">{declare.description}</p>}
                  {about && (
                    <>
                      <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-[#475569]">
                        {aboutOpen || about.length <= ABOUT_PREVIEW ? about : `${about.slice(0, ABOUT_PREVIEW).trimEnd()}…`}
                      </p>
                      {about.length > ABOUT_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => setAboutOpen((o) => !o)}
                          aria-expanded={aboutOpen}
                          className="mt-1 text-[13px] font-semibold text-[#0f172a] underline underline-offset-2"
                        >
                          {aboutOpen ? "Réduire" : "Lire la suite"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {skills.length > 0 && (
                <div className="mt-5">
                  <h2 className="text-[15px] font-bold text-[#0f172a]">Compétences</h2>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {(skillsOpen ? skills : skills.slice(0, SKILLS_SHOWN)).map((t) => {
                      const ok = confirmed.has(t.toLocaleLowerCase("fr"));
                      return (
                        <li
                          key={t}
                          title={ok ? "Confirmée par une mission ou une commande terminée sur Flexwork" : "Déclarée par le prestataire"}
                          className={`rounded-full border px-3 py-1 text-[12px] font-medium ${
                            ok ? "border-[#008751]/30 bg-[#008751]/10 text-[#008751]" : "border-[#E2E8F0] bg-white text-[#334155]"
                          }`}
                        >
                          {ok && <span aria-hidden>✓ </span>}
                          {t}
                          {ok && <span className="sr-only"> (confirmée par une mission terminée)</span>}
                        </li>
                      );
                    })}
                    {skills.length > SKILLS_SHOWN && (
                      <li>
                        <button
                          type="button"
                          onClick={() => setSkillsOpen((o) => !o)}
                          aria-expanded={skillsOpen}
                          className="rounded-full border border-[#E2E8F0] px-3 py-1 text-[12px] font-semibold text-[#0f172a] hover:bg-[#F8FAF9]"
                        >
                          {skillsOpen ? "Moins" : `+${skills.length - SKILLS_SHOWN}`}
                        </button>
                      </li>
                    )}
                  </ul>
                  {confirmed.size > 0 && (
                    <p className="mt-2 text-[11px] text-[#94A3B8]">✓ Compétence confirmée par une mission ou une commande terminée sur Flexwork.</p>
                  )}
                </div>
              )}

              {keyFacts.length > 0 && (
                <>
                  <dl className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {keyFacts.map((f) => (
                      <div key={f.label} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] px-3.5 py-2.5">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{f.label}</dt>
                        <dd className={`mt-0.5 text-[14px] font-semibold leading-snug ${f.tone === "green" ? "text-[#008751]" : "text-[#0f172a]"}`}>
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2.5 text-[11px] text-[#94A3B8]">Points déclarés par le prestataire, non vérifiés par Flexwork.</p>
                </>
              )}
            </section>

            {/* ── Services (Gigs) ── */}
            {(services.length > 0 || (!isOwner && declare.mainDomain)) && (
              <section aria-labelledby="services-titre" className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 sm:p-6">
                <h2 id="services-titre" className="text-[17px] font-bold text-[#0f172a]">
                  {services.length > 0 ? "Mes services" : "Services"}
                </h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {services.map((g) => (
                    <li key={g.id}>
                      <GigServiceCard
                        titre={g.titre}
                        domaine={g.domaine}
                        coverUrl={g.coverUrl}
                        images={g.images}
                        prixDepart={g.prixDepart}
                        currency={g.currency}
                        href={`/services/${g.id}?returnTo=${encodeURIComponent(`/profil/${id}`)}`}
                        footer={
                          <span className="whitespace-nowrap rounded-lg bg-[#FF6B35] px-3 py-1.5 text-[12px] font-semibold text-white">Voir</span>
                        }
                      />
                    </li>
                  ))}
                  {!isOwner && (
                    <li>
                      <div className="flex h-full flex-col justify-between rounded-xl border border-dashed border-[#008751]/40 bg-[#008751]/5 p-5">
                        <div>
                          <p className="text-[15px] font-semibold text-[#0f172a]">Besoin d&apos;autre chose ?</p>
                          <p className="mt-1 text-[13px] leading-relaxed text-[#475569]">
                            Décrivez votre besoin : la mission est publiée dans le domaine de {identite.prenom ?? "ce prestataire"}, qui est
                            invité(e) à candidater.
                          </p>
                        </div>
                        <Link
                          href={publishHref}
                          className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-[#0f172a] px-4 text-[13px] font-semibold text-[#0f172a] hover:bg-white"
                          style={{ textDecoration: "none" }}
                        >
                          Publier une mission
                        </Link>
                      </div>
                    </li>
                  )}
                </ul>
              </section>
            )}

            {/* ── Portfolio : photo à la une + vignettes, puis liens ── */}
            {declare.portfolioUrls.length > 0 && (
              <section aria-labelledby="portfolio-titre" className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 sm:p-6">
                <h2 id="portfolio-titre" className="text-[17px] font-bold text-[#0f172a]">
                  Portfolio
                </h2>
                {featured && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px]">
                    <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] aspect-[16/10]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- source authentifiée (bucket portfolio) */}
                      <img src={portfolioUrl(featured)} alt="Réalisation à la une" className="h-full w-full object-cover" />
                    </div>
                    {photos.length > 1 && (
                      <ul className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-y-auto sm:max-h-[360px] scrollbar-hide">
                        {photos.map((p, i) => (
                          <li key={p} className="shrink-0">
                            <button
                              type="button"
                              onClick={() => setPhotoIndex(i)}
                              aria-label={`Afficher la réalisation ${i + 1}`}
                              aria-pressed={p === featured}
                              className={`block h-16 w-24 sm:h-20 sm:w-full overflow-hidden rounded-lg border-2 ${
                                p === featured ? "border-[#0f172a]" : "border-transparent opacity-80 hover:opacity-100"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- source authentifiée (bucket portfolio) */}
                              <img src={portfolioUrl(p)} alt="" className="h-full w-full object-cover" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {links.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {links.map((u) => (
                      <li key={u} className="truncate text-[13px]">
                        <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-[#008751] hover:underline">
                          🔗 {u.replace(/^https?:\/\//i, "")}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* ── Parcours déclaré (non vérifié) ── */}
            {(experiences.length > 0 || diplomas.length > 0 || coverage.length > 0 || deplacement.length > 0 || declare.insurance || declare.qualification?.label) && (
              <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
                <div className="px-5 sm:px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-3">
                  <h2 className="text-[17px] font-bold text-[#0f172a]">Parcours</h2>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                    Déclaré, non vérifié par Flexwork
                  </span>
                </div>
                <div className="px-5 sm:px-6 py-5 space-y-6">
                {experiences.length > 0 && (
                  <Sub title={`Expériences (${experiences.length})`}>
                    <ol className="relative space-y-4 border-l border-[#E2E8F0] pl-5">
                      {experiences.map((x, i) => {
                        const period = formatPeriod(x.startDate, x.endDate);
                        return (
                          <li key={i} className="relative">
                            <span aria-hidden className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#008751] ring-1 ring-[#008751]/30" />
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <p className="text-[14px] font-semibold text-[#0f172a]">{x.role}</p>
                              <span className="text-[12px] text-[#64748B]">
                                {[x.clientType === "COMPANY" ? x.clientName || "Entreprise" : "Particulier", x.domain]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </div>
                            {period && <p className="text-[12px] text-[#94A3B8]">{period}{x.startDate && !x.endDate ? " · en cours" : ""}</p>}
                            {x.description && <p className="mt-1 text-[13px] leading-relaxed text-[#475569]">{x.description}</p>}
                          </li>
                        );
                      })}
                    </ol>
                  </Sub>
                )}

                {diplomas.length > 0 && (
                  <Sub title="Diplômes et certifications">
                    <ul className="space-y-2">
                      {diplomas.map((d, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[#0f172a]">{d.qualificationName}</p>
                            <p className="text-[12px] text-[#64748B]">
                              {[countryName(d.country) ?? d.institution, d.year].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              d.isStateIssued ? "bg-[#008751]/10 text-[#008751]" : "bg-zinc-100 text-zinc-500"
                            }`}
                          >
                            {d.isStateIssued ? "Diplôme d'État" : "Déclaratif"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Sub>
                )}

                {(coverage.length > 0 || deplacement.length > 0) && (
                  <Sub title="Zone d'intervention">
                    <div className="space-y-2 text-[13px] text-[#475569]">
                      {coverage.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {coverage.map((z) => (
                            <span key={z} className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-0.5 text-[12px]">
                              {z}
                            </span>
                          ))}
                        </div>
                      )}
                      {deplacement.length > 0 && <p>Se déplace : {deplacement.join(", ").toLowerCase()}</p>}
                    </div>
                  </Sub>
                )}

                {declare.insurance && (
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-[13px] font-semibold text-[#0f172a]">Assurance RC Pro — déclarée</p>
                      <DeclaredBadge label="Non vérifiée" />
                    </div>
                    <p className="text-[12px] text-[#64748B]">
                      {declare.insurance.insurerName}
                      {declare.insurance.policyNumber ? ` · police ${declare.insurance.policyNumber}` : ""}
                      {declare.insurance.coverageCeiling
                        ? ` · plafond ${declare.insurance.coverageCeiling.toLocaleString("fr-FR")} FCFA`
                        : ""}
                      {declare.insurance.validUntil
                        ? ` · valide au ${new Date(declare.insurance.validUntil).toLocaleDateString("fr-FR")}`
                        : ""}
                    </p>
                  </div>
                )}
                {/* Ancien format de qualification (libellé seul, depuis /declarations) : affiché
                    seulement s'il porte un libellé — les diplômes du profil sont listés plus haut. */}
                {declare.qualification?.label && diplomas.length === 0 && (
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-4">
                    <p className="text-[13px] font-semibold text-[#0f172a]">Qualification — {declare.qualification.label}</p>
                    <p className="text-[12px] text-[#64748B]">Document joint, non vérifié par Flexwork.</p>
                  </div>
                )}
                <p className="text-[12px] text-[#94A3B8]">{declare.mention}</p>
                </div>
              </section>
            )}

            {/* ── Avis ── */}
            <section id="avis" aria-labelledby="avis-titre" className="scroll-mt-6 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 sm:p-6">
              <h2 id="avis-titre" className="text-[17px] font-bold text-[#0f172a]">
                {reviewCount > 0 ? `${reviewCount} avis` : "Avis"}
                {activite.averageNote != null && reviewCount > 0 && (
                  <span className="ml-2 text-[15px] font-semibold">
                    <span className="text-[#F7C948]" aria-hidden>
                      ★
                    </span>{" "}
                    {activite.averageNote.toFixed(1)}
                  </span>
                )}
              </h2>
              {reviewCount === 0 ? (
                <p className="mt-2 text-[14px] text-[#64748B]">
                  Pas encore d&apos;avis. Les avis viennent des clients, à la fin d&apos;une mission menée sur Flexwork.
                </p>
              ) : (
                <>
                  <ul className="mt-4 max-w-md space-y-1.5" aria-label="Répartition des notes">
                    {breakdown.map((b) => (
                      <li key={b.note} className="flex items-center gap-3 text-[13px]">
                        <span className="w-16 shrink-0 text-[#475569]">
                          {b.note} étoile{b.note > 1 ? "s" : ""}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#E2E8F0]" aria-hidden>
                          <span className="block h-full rounded-full bg-[#0f172a]" style={{ width: `${reviewCount ? (b.count / reviewCount) * 100 : 0}%` }} />
                        </span>
                        <span className="w-8 shrink-0 text-right text-[#64748B]">({b.count})</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="mt-6 divide-y divide-[#E2E8F0]">
                    {avis.slice(0, reviewsShown).map((a) => (
                      <li key={a.id} className="py-4 first:pt-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                          <span className="text-[#F7C948]" aria-label={`${a.note} sur 5`}>
                            {"★".repeat(a.note)}
                            <span className="text-[#E2E8F0]">{"★".repeat(5 - a.note)}</span>
                          </span>
                          <span className="text-[#64748B]">
                            Client {a.pays ? `${countryFlag(a.pays)} ${countryName(a.pays) ?? a.pays}` : ""}
                          </span>
                          <span className="text-[#94A3B8]">
                            {new Date(a.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                          </span>
                        </div>
                        {a.commentaire && <p className="mt-1.5 text-[14px] leading-relaxed text-[#334155]">{a.commentaire}</p>}
                        {a.metier && (
                          <span className="mt-2 inline-block rounded-full bg-[#F8FAF9] border border-[#E2E8F0] px-2.5 py-0.5 text-[11px] text-[#64748B]">
                            {a.metier}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {avis.length > reviewsShown && (
                    <button
                      type="button"
                      onClick={() => setReviewsShown((n) => n + 5)}
                      className="mt-2 h-10 rounded-lg border border-[#0f172a] px-4 text-[13px] font-semibold text-[#0f172a] hover:bg-[#F8FAF9]"
                    >
                      Voir plus d&apos;avis
                    </button>
                  )}
                </>
              )}
            </section>
          </div>

          {/* ── Colonne latérale : tarif, action, garantie ── */}
          <aside className="lg:sticky lg:top-[20px] space-y-4">
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
              <div className="flex items-center gap-3">
                <Avatar src={identite.avatarPath ? `/api/users/${id}/avatar` : null} initials={initials} size={44} gradient="from-[#008751] to-[#FCD116]" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#0f172a]">{fullName}</p>
                  <p className="text-[12px] text-[#64748B]">Membre depuis {new Date(activite.memberSince).getFullYear()}</p>
                </div>
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">Tarif indicatif</p>
              {declare.indicativeRate ? (
                <p className="mt-1 text-[22px] font-bold text-[#0f172a]">
                  {declare.indicativeRate.toLocaleString("fr-FR")}{" "}
                  <span className="text-[14px] font-semibold text-[#008751]">{currency}</span>
                  <span className="text-[14px] font-medium text-[#64748B]">{TARIF_UNITE_LABELS[declare.tarifUnite ?? "jour"] ?? ""}</span>
                </p>
              ) : (
                <p className="mt-1 text-[14px] text-[#64748B]">Sur devis</p>
              )}
              {services.length > 0 && (
                <p className="mt-1 text-[12px] text-[#475569]">
                  Services dès {Math.min(...services.map((g) => g.prixDepart)).toLocaleString("fr-FR")} {services[0].currency}
                </p>
              )}

              {isOwner ? (
                <>
                  <Link
                    href="/profile"
                    className="mt-5 w-full h-11 rounded-xl bg-[#0f172a] text-white text-[14px] font-semibold flex items-center justify-center hover:bg-[#1e293b] transition"
                  >
                    Modifier mon profil
                  </Link>
                  <p className="mt-3 text-[11px] text-[#94A3B8] text-center leading-relaxed">Vous voyez votre profil tel que les clients le voient.</p>
                </>
              ) : (
                <>
                  <Link
                    href={publishHref}
                    className="mt-5 w-full min-h-11 px-3 py-2 rounded-xl bg-[#0f172a] text-white text-[14px] font-semibold flex items-center justify-center text-center hover:bg-[#1e293b] transition"
                  >
                    {declare.metierId && declare.mainDomain ? `Publier une mission en ${declare.mainDomain}` : "Publier une mission"}
                  </Link>
                  {services.length > 0 && (
                    <a
                      href="#services-titre"
                      className="mt-2 w-full h-11 rounded-xl border border-[#0f172a] text-[14px] font-semibold text-[#0f172a] flex items-center justify-center hover:bg-[#F8FAF9] transition"
                      style={{ textDecoration: "none" }}
                    >
                      Voir ses services
                    </a>
                  )}
                  <p className="mt-3 text-[11px] text-[#94A3B8] text-center leading-relaxed">
                    {declare.metierId
                      ? `La mission est publiée depuis votre compte, dans le domaine de ${identite.prenom ?? "ce prestataire"}, qui est invité(e) à candidater directement.`
                      : "Le contact et la commande passent par une mission : publiez votre besoin, les prestataires du domaine pourront candidater."}
                  </p>
                </>
              )}
            </div>

            {/* Garantie : la protection réelle de la plateforme, le séquestre. */}
            <div className="flex gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <span aria-hidden className="text-[18px]">
                🛡️
              </span>
              <p className="text-[12.5px] leading-relaxed text-[#475569]">
                <span className="font-semibold text-[#0f172a]">Paiement sous séquestre.</span> Vous payez à la commande, le prestataire
                n&apos;est payé qu&apos;une fois le travail validé. Contrat signé des deux côtés.
              </p>
            </div>

            {declare.cvUrl && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
                <p className="text-[13px] font-semibold text-[#0f172a]">📄 CV</p>
                <a
                  href={portfolioUrl(declare.cvUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[13px] font-semibold text-[#008751] hover:underline"
                >
                  Voir le CV
                </a>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-[#94A3B8]">{title}</h3>
      {children}
    </div>
  );
}
