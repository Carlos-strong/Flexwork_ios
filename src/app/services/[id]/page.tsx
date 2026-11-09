import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { LISTED_PROVIDER_WHERE } from "@/lib/profile-visibility";
import { serializeGig } from "@/lib/gig-serialize";
import { countryFlag } from "@/lib/country-flag";
import { countryName } from "@/lib/world-countries";
import { BackLink } from "@/components/BackLink";
import { Avatar } from "@/components/avatar";
import { ServiceOrderPanel } from "@/components/gig/ServiceOrderPanel";
import { GigImageCarousel } from "@/components/gig/GigImageCarousel";
import { safeCallbackUrl } from "@/lib/safe-callback";

// Page PUBLIQUE d'un service (Gig), 2026-11-08.
//
// Les cartes « Nouveaux services publiés » (accueil) et « Mes services » (profil public)
// menaient à /client/offres : une page du TABLEAU DE BORD client. Un visiteur était renvoyé à
// la connexion pour simplement regarder un service, et un compte connecté se retrouvait dans
// son espace client. Ici, on regarde sans compte : description, visuels, trois formules ;
// seul « Commander » passe par la connexion puis la rubrique Offres.
//
// Visibilité : celle de la vitrine — un service PUBLIÉ d'un prestataire LISTÉ (identité
// vérifiée, compte actif). Sinon 404, sans dire si le service existe.

type Params = { params: { id: string }; searchParams: { returnTo?: string | string[] } };

async function loadService(id: string) {
  return prisma.gig.findFirst({
    where: { id, status: "publie", provider: LISTED_PROVIDER_WHERE },
    include: {
      packages: true,
      _count: { select: { orders: true } },
      provider: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          avatarPath: true,
          country: true,
          profiles: { where: { isDefault: true }, select: { title: true, mainDomain: true }, take: 1 },
        },
      },
    },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const gig = await loadService(params.id);
  if (!gig) return { title: "Service introuvable — Flexwork" };
  return { title: `${gig.titre} — Flexwork`, description: gig.description.slice(0, 160) };
}

export default async function ServicePage({ params, searchParams }: Params) {
  const gig = await loadService(params.id);
  if (!gig) notFound();

  const session = await auth();
  const isOwner = (session?.user as { id?: string } | undefined)?.id === gig.providerId;
  const view = serializeGig(gig);
  const p = gig.provider;
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "Prestataire";
  const initials = `${p.firstname?.[0] ?? ""}${p.lastname?.[0] ?? ""}`.toUpperCase() || "?";
  const reviews = await prisma.review.aggregate({
    where: { targetId: p.id, suspendu: false },
    _avg: { note: true },
    _count: { note: true },
  });
  const returnTo = safeCallbackUrl(typeof searchParams.returnTo === "string" ? searchParams.returnTo : null);
  const back =
    returnTo && returnTo !== "/" ? { href: returnTo, label: "Revenir à la page précédente" } : { href: "/", label: "Retour à l'accueil" };

  return (
    <div className="min-h-screen bg-[#F8FAF9]">
      <div className="page-shell py-8 lg:py-12 space-y-5">
        <BackLink href={back.href} label={back.label} />

        <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
          <article className="min-w-0 rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-7 shadow-sm">
            <span className="rounded-full bg-[#F7F7F5] px-2.5 py-1 text-[11px] font-semibold text-[#0A1931]">{view.domaine}</span>
            <h1 className="mt-3 text-[24px] lg:text-[28px] font-bold leading-tight text-[#0f172a]">{view.titre}</h1>

            {/* Prestataire */}
            <Link
              href={`/profil/${p.id}?returnTo=${encodeURIComponent(`/services/${gig.id}`)}`}
              className="mt-4 inline-flex items-center gap-3 rounded-xl pr-3 hover:bg-[#F8FAF9]"
              style={{ textDecoration: "none" }}
            >
              <Avatar src={p.avatarPath ? `/api/users/${p.id}/avatar` : null} initials={initials} size={44} gradient="from-[#008751] to-[#FCD116]" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[#0f172a]">
                  {name}{" "}
                  {p.country && (
                    <span role="img" aria-label={countryName(p.country) ?? p.country}>
                      {countryFlag(p.country)}
                    </span>
                  )}
                </span>
                <span className="block text-[13px] text-[#64748B]">
                  {reviews._count.note > 0 && reviews._avg.note != null ? (
                    <>
                      <span className="text-[#F7C948]">★</span> {reviews._avg.note.toFixed(1)} ({reviews._count.note} avis)
                    </>
                  ) : (
                    "Nouveau sur Flexwork"
                  )}
                  {p.profiles[0]?.title ? ` · ${p.profiles[0].title}` : ""}
                </span>
              </span>
            </Link>

            {/* Visuels */}
            {(view.images.length > 0 || view.videoEmbedUrl) && (
              <div className="mt-6 grid gap-3">
                {view.images.length > 0 && <GigImageCarousel images={view.images} alt={view.titre} aspect="aspect-[16/9]" rounded="rounded-xl" autoplay />}
                {view.videoEmbedUrl && (
                  <div className="aspect-video overflow-hidden rounded-xl bg-black">
                    <iframe
                      src={view.videoEmbedUrl}
                      title={`Vidéo — ${view.titre}`}
                      className="h-full w-full"
                      allow="encrypted-media; picture-in-picture"
                      allowFullScreen
                      sandbox="allow-scripts allow-same-origin allow-presentation"
                    />
                  </div>
                )}
              </div>
            )}

            <h2 className="mt-7 text-[17px] font-bold text-[#0f172a]">À propos de ce service</h2>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-[#475569]">{view.description}</p>

            {view.packages.length > 0 && (
              <>
                <h2 className="mt-7 text-[17px] font-bold text-[#0f172a]">Comparer les formules</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] text-[#64748B]">
                        <th className="py-2 pr-3 font-medium" />
                        {view.packages.map((pk) => (
                          <th key={pk.tier} scope="col" className="py-2 px-3 font-semibold text-[#0f172a] capitalize">
                            {pk.tier}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      <tr>
                        <th scope="row" className="py-2 pr-3 font-medium text-[#64748B]">Formule</th>
                        {view.packages.map((pk) => (
                          <td key={pk.tier} className="py-2 px-3 font-medium text-[#0f172a]">{pk.titre}</td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row" className="py-2 pr-3 font-medium text-[#64748B]">Inclus</th>
                        {view.packages.map((pk) => (
                          <td key={pk.tier} className="py-2 px-3 align-top text-[#475569]">{pk.description}</td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row" className="py-2 pr-3 font-medium text-[#64748B]">Délai</th>
                        {view.packages.map((pk) => (
                          <td key={pk.tier} className="py-2 px-3">{pk.delaiJours} j</td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row" className="py-2 pr-3 font-medium text-[#64748B]">Révisions</th>
                        {view.packages.map((pk) => (
                          <td key={pk.tier} className="py-2 px-3">{pk.revisions}</td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row" className="py-2 pr-3 font-medium text-[#64748B]">Prix</th>
                        {view.packages.map((pk) => (
                          <td key={pk.tier} className="py-2 px-3 font-bold text-[#0f172a]">
                            {pk.prix.toLocaleString("fr-FR")} {view.currency}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {view.tags.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Mots-clés">
                {view.tags.map((t) => (
                  <li key={t} className="rounded-full bg-[#f0faf5] px-2.5 py-0.5 text-[12px] font-medium text-[#008751]">
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <aside className="space-y-3 lg:sticky lg:top-6">
            {isOwner ? (
              <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 text-[13px] text-[#475569]">
                <p className="font-semibold text-[#0f172a]">C&apos;est votre service.</p>
                <p className="mt-1">Les clients le voient tel quel.</p>
                <Link
                  href="/profile?tab=services"
                  className="mt-4 inline-flex h-10 items-center rounded-full bg-[#0f172a] px-4 text-[13px] font-semibold text-white"
                  style={{ textDecoration: "none" }}
                >
                  Gérer mes services
                </Link>
              </div>
            ) : (
              <ServiceOrderPanel
                gigId={gig.id}
                packages={view.packages}
                currency={view.currency}
                fallback={{ prix: view.prixDepart, delaiJours: view.delaiJours }}
              />
            )}
            <div className="flex gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <span aria-hidden className="text-[18px]">
                🛡️
              </span>
              <p className="text-[12.5px] leading-relaxed text-[#475569]">
                <span className="font-semibold text-[#0f172a]">Paiement sous séquestre.</span> Vous payez à la commande ; le prestataire
                n&apos;est payé qu&apos;une fois la livraison validée, et vous êtes remboursé s&apos;il ne signe pas sous 24 h.
              </p>
            </div>
            {gig._count.orders > 0 && (
              <p className="px-1 text-[12px] text-[#64748B]">
                {gig._count.orders} commande{gig._count.orders > 1 ? "s" : ""} passée{gig._count.orders > 1 ? "s" : ""} sur Flexwork.
              </p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
