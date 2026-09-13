"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { IdentityBadge, DeclaredBadge } from "@/components/IdentityBadge";
import { MapPin } from "lucide-react";

// Profil public d'un prestataire — alimenté par les DONNÉES RÉELLES de
// /api/users/[id]/public-profile (modèle v3, trois blocs strictement séparés) :
//   1. Vérifié par Flexwork — identité uniquement (badge unique « Identité vérifiée »)
//   2. Déclaré par le prestataire (non vérifié) — domaine, tarif FCFA, tags, portfolio, CV
//   3. Activité sur la plateforme — faits d'usage constatés
// Remplace l'ancienne reproduction statique de la maquette (contenu Fiverr en €, badges
// « Expert Vérifié »/« Badge Or »/« Entreprise Vérifiée » contraires au modèle).

type PublicProfile = {
  identite: {
    prenom: string | null;
    nom: string | null;
    role: string | null;
    pays: string | null;
    ville: string | null;
    avatarPath: string | null;
  };
  verifie: { identiteVerifiee: boolean };
  declare: {
    mainDomain: string | null;
    declaredLevel: string | null;
    declaredExperienceYears: number | null;
    indicativeRate: number | null;
    tarifUnite: string | null;
    tags: string[];
    description: string | null;
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
  activite: { missionsCompleted: number; averageNote: number | null; memberSince: string };
};

const ROLE_LABELS: Record<string, string> = {
  client: "Client",
  expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP / Autres",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
};

const TARIF_UNITE_LABELS: Record<string, string> = {
  heure: " / heure",
  jour: " / jour",
  semaine: " / semaine",
  mois: " / mois",
  mission: " / mission",
};

export default function TalentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

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
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">
        Chargement...
      </div>
    );
  }
  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">
        Profil introuvable.
      </div>
    );
  }

  const { identite, verifie, declare, activite } = data;
  const fullName = [identite.prenom, identite.nom].filter(Boolean).join(" ") || "Prestataire";
  const initials = `${identite.prenom?.[0] ?? ""}${identite.nom?.[0] ?? ""}`.toUpperCase() || "?";
  const roleLabel = ROLE_LABELS[identite.role ?? ""] ?? identite.role ?? "Prestataire";
  const zone = [declare.zoneVille, declare.zonePays].filter(Boolean).join(", ");

  function portfolioUrl(relPath: string) {
    return `/api/profile/portfolio-file?p=${encodeURIComponent(relPath)}`;
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9]">
      <div className="max-w-[1100px] mx-auto px-4 py-8 lg:py-12 space-y-5">
        {/* ── Carte identité + badge Vérifié ── */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar
              src={identite.avatarPath ? `/api/users/${id}/avatar` : null}
              initials={initials}
              size={72}
              gradient="from-[#008751] to-[#FCD116]"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] lg:text-[22px] font-bold text-[#0f172a] truncate">{fullName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[#64748B]">
                <span>{roleLabel}</span>
                {zone && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {zone}
                  </span>
                )}
                {declare.mainDomain && (
                  <span className="px-2 py-0.5 rounded-full bg-[#0f172a] text-white text-[11px] font-semibold">{declare.mainDomain}</span>
                )}
              </div>
            </div>
            <IdentityBadge verified={verifie.identiteVerifiee} />
          </div>
          {declare.description && (
            <p className="mt-4 text-[14px] text-[#475569] leading-relaxed">{declare.description}</p>
          )}
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-5">
          {/* ── Colonne principale : trois blocs ── */}
          <div className="space-y-5">
            {/* Bloc 2 — Déclaré par le prestataire (non vérifié) */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-[#0f172a]">Déclaré par le prestataire</h2>
                <span className="text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">Non vérifié par Flexwork</span>
              </div>
              <div className="px-6 py-5 space-y-4">
                {declare.declaredLevel && declare.declaredExperienceYears != null && (
                  <p className="text-[14px] text-[#475569]">
                    Niveau : <strong className="text-[#0f172a] capitalize">{declare.declaredLevel}</strong> ·{" "}
                    {declare.declaredExperienceYears} an(s) d&apos;expérience déclaré(s)
                  </p>
                )}
                {declare.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {declare.tags.map((t) => (
                      <span key={t} className="px-3 py-1 rounded-full bg-[#008751]/5 border border-[#008751]/15 text-[12px] font-medium text-[#008751]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {declare.insurance && (
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-[13px] font-semibold text-[#0f172a]">Assurance RC Pro — déclarée</p>
                      <DeclaredBadge label="Non vérifiée" />
                    </div>
                    <p className="text-[12px] text-[#64748B]">
                      {declare.insurance.insurerName}
                      {/* Numéro de police masqué au visiteur non connecté par l'API — on
                          n'affiche pas « police  » vide. */}
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
                {declare.qualification && (
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-4">
                    <p className="text-[13px] font-semibold text-[#0f172a]">
                      Qualification — {declare.qualification.label}
                    </p>
                    <p className="text-[12px] text-[#64748B]">Document joint, non vérifié par Flexwork.</p>
                  </div>
                )}
                <p className="text-[12px] text-[#94A3B8]">{declare.mention}</p>
              </div>
            </div>

            {/* Portfolio (photos de chantiers) */}
            {declare.portfolioUrls.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-[#E2E8F0]">
                  <h2 className="text-[15px] font-bold text-[#0f172a]">Portfolio</h2>
                </div>
                <div className="px-6 py-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {declare.portfolioUrls.map((rel) => (
                    <div key={rel} className="rounded-xl overflow-hidden border border-[#E2E8F0] aspect-[4/3] bg-[#F8FAF9]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- source authentifiée (bucket portfolio) */}
                      <img src={portfolioUrl(rel)} alt="Réalisation" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bloc 3 — Activité sur la plateforme */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[#E2E8F0]">
                <h2 className="text-[15px] font-bold text-[#0f172a]">Activité sur la plateforme</h2>
              </div>
              <div className="px-6 py-5 grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[22px] font-bold text-[#0f172a]">{activite.missionsCompleted}</p>
                  <p className="text-[12px] text-[#64748B]">Missions complétées</p>
                </div>
                <div>
                  <p className="text-[22px] font-bold text-[#0f172a]">
                    {activite.averageNote ? `${activite.averageNote.toFixed(1)} ★` : "—"}
                  </p>
                  <p className="text-[12px] text-[#64748B]">Note moyenne</p>
                </div>
                <div>
                  <p className="text-[22px] font-bold text-[#0f172a]">
                    {new Date(activite.memberSince).getFullYear()}
                  </p>
                  <p className="text-[12px] text-[#64748B]">Membre depuis</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Colonne latérale : tarif FCFA + CTA ── */}
          <div className="lg:sticky lg:top-[20px] h-fit space-y-4">
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">Tarif indicatif</p>
              {declare.indicativeRate ? (
                <p className="mt-1 text-[22px] font-bold text-[#0f172a]">
                  {declare.indicativeRate.toLocaleString("fr-FR")}{" "}
                  <span className="text-[14px] font-semibold text-[#008751]">FCFA</span>
                  <span className="text-[14px] font-medium text-[#64748B]">
                    {TARIF_UNITE_LABELS[declare.tarifUnite ?? "jour"] ?? ""}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-[14px] text-[#64748B]">Non renseigné</p>
              )}
              <p className="mt-1 text-[11px] text-[#94A3B8]">Déclaré par le prestataire, non vérifié.</p>

              <Link
                href="/missions/new"
                className="mt-5 block w-full h-11 rounded-xl bg-[#008751] text-white text-[14px] font-semibold flex items-center justify-center hover:bg-[#006e43] transition"
              >
                Publier une mission
              </Link>
              <p className="mt-3 text-[11px] text-[#94A3B8] text-center leading-relaxed">
                Le contact et la commande passent par une mission : publiez votre besoin, ce prestataire pourra
                candidater.
              </p>
            </div>

            {declare.cvUrl && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
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
          </div>
        </div>
      </div>
    </div>
  );
}
