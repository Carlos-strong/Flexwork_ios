"use client";

// Résumé EN LECTURE d'une rubrique du profil (2026-11-08) — vue « profil complet » de /profile.
//
// Une fois le profil à 100 %, /profile n'affiche plus le formulaire par étapes : chaque
// rubrique se présente telle qu'enregistrée, avec un bouton « Modifier » qui n'ouvre QUE son
// formulaire. Ce composant dessine la partie lecture ; le shell (ProviderProfileTabs) gère
// l'ouverture du formulaire et le retour à la vue après enregistrement.

import { useEffect, useState, type ReactNode } from "react";
import type { ProviderIdentity, ProviderProfile } from "@/components/profile/profile-shared";
import {
  AVAILABILITY_LABELS,
  DEPLACEMENTS,
  MODE_CONTACTS,
  PROVIDER_KIND_LABELS,
  TARIF_UNITES,
  WORK_MODES,
} from "@/lib/provider-options";
import { countryName } from "@/lib/world-countries";
import { languageLabel, levelLabel, readLanguages } from "@/lib/languages";
import { isExternalLink, portfolioFileName, portfolioFileUrl } from "@/components/profile/PortfolioEditor";

export type SummaryExperience = { role?: string | null; clientName?: string | null; clientType?: string | null };
export type SummaryDiploma = { qualificationName?: string | null; year?: number | string | null };

const LEVEL_LABELS: Record<string, string> = {
  debutant: "Débutant",
  intermediaire: "Intermédiaire",
  senior: "Senior",
  expert: "Expert",
};
const CURRENCY_SHORT: Record<string, string> = { XOF: "FCFA", NGN: "NGN", EUR: "€", USD: "$" };

const labelOf = (options: { value: string; label: string }[], value: string | null | undefined) =>
  value ? (options.find((o) => o.value === value)?.label ?? value) : null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "" || (Array.isArray(children) && children.length === 0);
  return (
    <div className="grid gap-0.5 sm:grid-cols-[170px_1fr] sm:gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-[13px] text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-[14px] text-[#0A1931]">
        {empty ? <span className="text-zinc-400">Non renseigné</span> : children}
      </dd>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[12px] font-medium text-zinc-700">
          {t}
        </span>
      ))}
    </div>
  );
}

function Clamp({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return <p className="line-clamp-3 whitespace-pre-line leading-relaxed text-zinc-700">{text}</p>;
}

export function ProfileSectionSummary({
  step,
  profile,
  identity,
  experiences,
  diplomas,
}: {
  step: "domaines" | "presentation" | "experience" | "portfolio" | "services" | "localisation" | "configuration";
  profile: ProviderProfile;
  identity: ProviderIdentity | null;
  experiences: SummaryExperience[];
  diplomas: SummaryDiploma[];
}) {
  const p = profile;
  switch (step) {
    case "domaines":
      return (
        <dl className="divide-y divide-zinc-100">
          <Row label="Métier principal">{p.mainDomain}</Row>
          <Row label="Domaine secondaire">{p.secondaryDomain}</Row>
          <Row label="Compétences">{(p.tags ?? []).length ? <Chips items={p.tags ?? []} /> : null}</Row>
        </dl>
      );

    case "presentation":
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {identity?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={identity.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover border border-zinc-200" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-[12px] text-zinc-400">
                Photo
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-[#0A1931]">{identity?.fullName}</p>
              <p className="text-[13px] text-zinc-500">{p.title || "Titre non renseigné"}</p>
            </div>
          </div>
          <dl className="divide-y divide-zinc-100">
            <Row label="Type de prestataire">{p.providerKind ? (PROVIDER_KIND_LABELS[p.providerKind] ?? p.providerKind) : null}</Row>
            <Row label="Bio">{p.description?.trim() ? <Clamp text={p.description} /> : null}</Row>
            <Row label="Présentation détaillée">{p.overview?.trim() ? <Clamp text={p.overview} /> : null}</Row>
            <Row label="Langues">
              {readLanguages(p.languages).length ? (
                <Chips items={readLanguages(p.languages).map((l) => `${languageLabel(l.code)} · ${levelLabel(l.niveau)}`)} />
              ) : null}
            </Row>
          </dl>
        </div>
      );

    case "experience": {
      const level = p.declaredLevel ? (LEVEL_LABELS[p.declaredLevel] ?? p.declaredLevel) : null;
      const years = typeof p.declaredExperienceYears === "number" ? `${p.declaredExperienceYears} an${p.declaredExperienceYears > 1 ? "s" : ""}` : null;
      return (
        <dl className="divide-y divide-zinc-100">
          <Row label="Niveau et ancienneté">{[level, years].filter(Boolean).join(" · ") || null}</Row>
          <Row label={`Expériences (${experiences.length})`}>
            {experiences.length ? (
              <ul className="space-y-1">
                {experiences.slice(0, 4).map((x, i) => (
                  <li key={i}>
                    <span className="font-medium">{x.role || "Expérience"}</span>
                    <span className="text-zinc-500">
                      {" — "}
                      {x.clientType === "INDIVIDUAL" ? "Particulier" : x.clientName || "Entreprise"}
                    </span>
                  </li>
                ))}
                {experiences.length > 4 && <li className="text-[13px] text-zinc-500">+ {experiences.length - 4} autre(s)</li>}
              </ul>
            ) : null}
          </Row>
          <Row label={`Diplômes (${diplomas.length})`}>
            {diplomas.length ? (
              <ul className="space-y-1">
                {diplomas.map((d, i) => (
                  <li key={i}>
                    {d.qualificationName}
                    {d.year ? <span className="text-zinc-500"> · {d.year}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Row>
        </dl>
      );
    }

    case "portfolio": {
      const all = p.portfolioUrls ?? [];
      const photos = all.filter((u) => !isExternalLink(u));
      const links = all.filter(isExternalLink);
      return (
        <div className="space-y-3">
          {photos.length > 0 && (
            <ul className="grid grid-cols-4 gap-2 sm:max-w-md">
              {photos.slice(0, 4).map((u, i) => (
                <li key={u} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fichier servi par une route authentifiée */}
                  <img src={portfolioFileUrl(u)} alt={portfolioFileName(u)} className="h-full w-full object-cover" />
                  {i === 3 && photos.length > 4 && (
                    <span className="absolute inset-0 grid place-items-center bg-black/50 text-[13px] font-semibold text-white">
                      +{photos.length - 4}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <dl className="divide-y divide-zinc-100">
            <Row label="Photos">{photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : null}</Row>
            <Row label="Liens">
              {links.length ? (
                <ul className="space-y-0.5">
                  {links.map((u) => (
                    <li key={u} className="truncate">
                      <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-[#008751] hover:underline">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Row>
            <Row label="CV">
              {p.cvUrl ? (
                <a href={portfolioFileUrl(p.cvUrl)} target="_blank" rel="noopener noreferrer" className="text-[#008751] hover:underline">
                  📄 {portfolioFileName(p.cvUrl)}
                </a>
              ) : null}
            </Row>
          </dl>
        </div>
      );
    }

    case "services":
      return <ServicesSummary />;

    case "localisation": {
      const place = [p.quartier, p.zoneVille, countryName(p.zonePays) ?? p.zonePays].filter(Boolean).join(", ");
      return (
        <dl className="divide-y divide-zinc-100">
          <Row label="Localisation">
            {place ? `${place}${p.zoneRayonKm ? ` · rayon ${p.zoneRayonKm} km` : ""}` : null}
          </Row>
          <Row label="Zones couvertes">{(p.coverageZones ?? []).length ? <Chips items={p.coverageZones ?? []} /> : null}</Row>
          <Row label="Modes d'intervention">{(p.workModes ?? []).map((m) => labelOf(WORK_MODES, m)!).join(" · ") || null}</Row>
          <Row label="Disponibilité">{p.availability ? (AVAILABILITY_LABELS[p.availability] ?? p.availability) : null}</Row>
          <Row label="Déplacement">{(p.deplacement ?? []).map((d) => labelOf(DEPLACEMENTS, d)!).join(" · ") || null}</Row>
        </dl>
      );
    }

    case "configuration": {
      const currency = CURRENCY_SHORT[p.currency ?? "XOF"] ?? p.currency ?? "FCFA";
      const unit = labelOf(TARIF_UNITES, p.tarifUnite)?.toLowerCase();
      return (
        <dl className="divide-y divide-zinc-100">
          <Row label="Tarif indicatif">
            {typeof p.indicativeRate === "number" ? `${p.indicativeRate.toLocaleString("fr-FR")} ${currency}${unit ? ` / ${unit}` : ""}` : null}
          </Row>
          <Row label="Devise">{p.currency ?? "XOF"}</Row>
          <Row label="Mode de contact">{labelOf(MODE_CONTACTS, p.modeContact)}</Row>
        </dl>
      );
    }
  }
}

/** Résumé « Mes services » : titre, statut et prix de départ de chaque Gig. */
function ServicesSummary() {
  const [gigs, setGigs] = useState<
    { id: string; titre: string; status: string; prixDepart: number; currency: string; coverUrl: string | null }[] | null
  >(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/gigs?mine=true")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => alive && setGigs(d.items ?? []))
      .catch(() => alive && setGigs([]));
    return () => {
      alive = false;
    };
  }, []);
  if (gigs === null) return <p className="text-[13px] text-zinc-400">Chargement…</p>;
  if (gigs.length === 0) {
    return (
      <p className="text-[14px] text-zinc-500">
        Aucun service. Proposez une offre à prix fixe en trois formules : les clients la commandent en quelques clics, paiement
        sous séquestre.
      </p>
    );
  }
  const STATUS: Record<string, string> = { publie: "En ligne", brouillon: "Brouillon", cloture: "Clôturé" };
  return (
    <ul className="divide-y divide-zinc-100">
      {gigs.map((g) => (
        <li key={g.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <span className="h-10 w-16 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-[#0A1931] to-[#1B9C6A]">
            {/* eslint-disable-next-line @next/next/no-img-element -- servie par /api/gigs/[id]/images */}
            {g.coverUrl && <img src={g.coverUrl} alt="" className="h-full w-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] text-[#0A1931]">{g.titre}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              g.status === "publie" ? "bg-emerald-50 text-[#008751]" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {STATUS[g.status] ?? g.status}
          </span>
          <span className="hidden sm:inline shrink-0 text-[13px] text-zinc-500">
            dès {g.prixDepart.toLocaleString("fr-FR")} {g.currency}
          </span>
        </li>
      ))}
    </ul>
  );
}
