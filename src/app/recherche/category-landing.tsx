import Link from "next/link";
import {
  Accessibility, Activity, Apple, ArrowRight, Baby, Battery, Bike, BookOpen, Bot, Brain, Briefcase,
  Building2, Calculator, Calendar, Car, ChevronRight, CirclePlay, ClipboardCheck, Cloud, Code, Cog,
  Cpu, Database, Droplets, Factory, FileText, Flame, Footprints, Gauge, Gem, GraduationCap, Hammer,
  HandHeart, HardHat, Headphones, HeartPulse, House, Languages, Laptop, Leaf, Lightbulb, LineChart,
  Mail, Megaphone, Microscope, Network, Newspaper, Package, Paintbrush, Palette, PartyPopper,
  PenTool, Pill as PillIcon, Plug, Recycle, Ruler, Scale, Scissors, Search, Settings, ShieldCheck, Ship, Shirt,
  Shovel, Smartphone, Snowflake, Sparkles, Stethoscope, Store, Sun, Tractor, Truck, Users, Utensils,
  Video, Warehouse, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import {
  landingTheme,
  metierIconName,
  type LandingMetier,
  type LandingTarget,
  type LandingTheme,
} from "@/lib/taxonomy-landing";
import { PillScroller } from "./pill-scroller";

// En-tête Catégorie / Métier de /recherche (2026-10-06), sur le modèle des pages catégorie de
// marketplace : héros coloré, rangée « services les plus populaires », puis grille « découvrir
// la catégorie » où chaque métier montre ses premières compétences.
//
//   catégorie → populaires = ses métiers ;   découvrir = ses métiers (grandes vignettes) ; résultats
//   métier    → populaires = ses compétences ; résultats ; autres métiers (liste compacte)
//
// Sur une page métier, les prestataires sont le contenu principal : ils passent AVANT les
// autres métiers, qui ne servent plus qu'à rebondir et prennent donc moins de place.
//
// Habillage (2026-10-06, v2) : héros en dégradé « mesh » dans la teinte de la catégorie, titre
// aligné à gauche et composition d'icônes flottantes ; pastilles arrondies ; cartes qui se
// soulèvent au survol ; apparition échelonnée des blocs (désactivée si l'utilisateur réduit
// les animations). Le contenu, les libellés et les liens sont inchangés.
//
// Composant SERVEUR : il reçoit la rubrique déjà résolue, les compétences déjà chargées et les
// résultats (`children`), qu'il place selon le cas.

const ICONS: Record<string, LucideIcon> = {
  Accessibility, Activity, Apple, Baby, Battery, Bike, BookOpen, Bot, Brain, Briefcase, Building2,
  Calculator, Calendar, Car, ClipboardCheck, Cloud, Code, Cog, Cpu, Database, Droplets, Factory,
  FileText, Flame, Footprints, Gauge, Gem, GraduationCap, Hammer, HandHeart, HardHat, Headphones,
  HeartPulse, House, Languages, Laptop, Leaf, Lightbulb, LineChart, Mail, Megaphone, Microscope,
  Network, Newspaper, Package, Paintbrush, Palette, PartyPopper, PenTool, Pill: PillIcon, Plug, Recycle, Ruler,
  Scale, Scissors, Search, Settings, ShieldCheck, Ship, Shirt, Shovel, Smartphone, Snowflake,
  Sparkles, Stethoscope, Store, Sun, Tractor, Truck, Users, Utensils, Video, Warehouse, Wrench, Zap,
};

function MetierIcon({ libelle, fallback, className }: { libelle: string; fallback?: string; className?: string }) {
  const Icon = ICONS[metierIconName(libelle, fallback)] ?? Briefcase;
  return <Icon className={className} aria-hidden />;
}

const metierHref = (m: { id: string }) => `/recherche?metier=${encodeURIComponent(m.id)}`;
const competenceHref = (metierId: string, libelle: string) =>
  `/recherche?metier=${encodeURIComponent(metierId)}&tags=${encodeURIComponent(libelle)}#prestataires`;

export type LandingService = { metierId: string; libelle: string };

export function CategoryLanding({
  target,
  services,
  activeTag,
  children,
}: {
  target: LandingTarget;
  /** Compétences de TOUS les métiers de la catégorie, triées par libellé. */
  services: LandingService[];
  /** Compétence filtrée (?tags=), mise en évidence dans la rangée des populaires. */
  activeTag: string | null;
  /** Résultats de recherche, placés selon le type de page. */
  children: React.ReactNode;
}) {
  const { categorie } = target;
  const metier = target.kind === "metier" ? target.metier : null;
  const theme = landingTheme(target.position);

  const byMetier = new Map<string, string[]>();
  for (const s of services) {
    (byMetier.get(s.metierId) ?? byMetier.set(s.metierId, []).get(s.metierId)!).push(s.libelle);
  }

  const title = metier ? metier.libelle : categorie.libelle;
  const subtitle =
    (metier ? metier.description : categorie.description) ??
    (metier
      ? `Des prestataires à l'identité vérifiée en ${metier.libelle.toLowerCase()}, payés sous séquestre.`
      : `${categorie.metiers.length} métiers, des talents à l'identité vérifiée et un paiement sous séquestre.`);

  const discover = metier ? categorie.metiers.filter((m) => m.id !== metier.id) : categorie.metiers;
  // Icônes du décor du héros : celle de la rubrique, puis celles de ses premières entrées.
  // Les autres métiers de la catégorie complètent quand les compétences partagent toutes l'icône
  // de leur métier (cas fréquent : « Figma », « Wireframes »… n'ont pas de mot-clé propre).
  const heroIcons = [
    ...(metier
      ? [metier.libelle, ...(byMetier.get(metier.id) ?? [])].map((l) => metierIconName(l, metierIconName(metier.libelle)))
      : [metierIconName(categorie.libelle)]),
    ...discover.map((m) => metierIconName(m.libelle)),
  ].filter((name) => name !== "Briefcase");

  return (
    <div className="space-y-12 lg:space-y-16">
      <Hero
        theme={theme}
        title={title}
        subtitle={subtitle}
        icons={[...new Set(heroIcons)].slice(0, 3)}
        breadcrumb={
          <nav aria-label="Fil d'Ariane" className="inline-flex flex-wrap items-center gap-1.5 rounded-2xl sm:rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[13px] text-white/75 backdrop-blur">
            <Link href="/" className="transition hover:text-white">Accueil</Link>
            <ChevronRight className="w-3.5 h-3.5 opacity-60" aria-hidden />
            {metier ? (
              <>
                <Link href={`/recherche?categorie=${encodeURIComponent(categorie.id)}`} className="transition hover:text-white">
                  {categorie.libelle}
                </Link>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" aria-hidden />
                <span className="font-medium text-white">{metier.libelle}</span>
              </>
            ) : (
              <span className="font-medium text-white">{categorie.libelle}</span>
            )}
          </nav>
        }
      />

      <Reveal delay={120}>
        <PillScroller prefix="Services les plus populaires" subject={title}>
          {metier
            ? (byMetier.get(metier.id) ?? []).map((libelle) => (
                <Pill
                  key={libelle}
                  href={competenceHref(metier.id, libelle)}
                  label={libelle}
                  theme={theme}
                  icon={<MetierIcon libelle={libelle} fallback={metierIconName(metier.libelle)} className="w-[18px] h-[18px]" />}
                  active={activeTag === libelle}
                />
              ))
            : categorie.metiers.map((m) => (
                <Pill key={m.id} href={metierHref(m)} label={m.libelle} theme={theme} icon={<MetierIcon libelle={m.libelle} className="w-[18px] h-[18px]" />} />
              ))}
        </PillScroller>
      </Reveal>

      {metier && <Reveal delay={200}>{children}</Reveal>}

      {discover.length > 0 && (
        <Reveal delay={metier ? 280 : 200}>
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
              <SectionTitle prefix={metier ? "Autres métiers" : "Découvrir la catégorie"} subject={categorie.libelle} />
              {metier && (
                <Link
                  href={`/recherche?categorie=${encodeURIComponent(categorie.id)}`}
                  className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition hover:bg-black/[0.04]"
                  style={{ color: theme.ink }}
                >
                  Voir toute la catégorie
                  <ArrowRight className="w-4 h-4 transition group-hover:translate-x-0.5" aria-hidden />
                </Link>
              )}
            </div>
            {metier ? (
              <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
                {discover.map((m) => (
                  <MetierLink key={m.id} metier={m} count={byMetier.get(m.id)?.length ?? 0} theme={theme} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
                {discover.map((m, i) => (
                  <MetierCard key={m.id} metier={m} competences={byMetier.get(m.id) ?? []} theme={theme} dark={i % 2 === 1} />
                ))}
              </div>
            )}
          </section>
        </Reveal>
      )}

      {!metier && <Reveal delay={280}>{children}</Reveal>}
    </div>
  );
}

// Section centrée (page-shell) qui apparaît en fondu montant, décalée par bloc. Pure CSS
// (tailwindcss-animate) : aucune hydratation, et `motion-reduce` la neutralise.
function Reveal({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  return (
    <div
      className="page-shell animate-in fade-in slide-in-from-bottom-3 duration-700 fill-mode-both motion-reduce:animate-none"
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// Titre de section en deux temps : préfixe discret, sujet appuyé — même texte qu'avant.
function SectionTitle({ prefix, subject }: { prefix: string; subject: string }) {
  return (
    <h2 className="text-xl sm:text-[26px] font-semibold leading-tight tracking-tight text-[#0A1931]">
      <span className="text-gray-400">{prefix} : </span>
      {subject}
    </h2>
  );
}

function Hero({
  theme,
  title,
  subtitle,
  icons,
  breadcrumb,
}: {
  theme: LandingTheme;
  title: string;
  subtitle: string;
  icons: string[];
  breadcrumb: React.ReactNode;
}) {
  const [main, ...rest] = icons.map((name) => ICONS[name] ?? Briefcase);
  return (
    <div className="page-wide">
    <section
      className="relative isolate overflow-hidden rounded-[28px] px-6 sm:px-10 lg:px-14 text-white animate-in fade-in zoom-in-[0.98] duration-700 fill-mode-both motion-reduce:animate-none"
      style={{
        backgroundColor: theme.deep,
        // Dégradé « mesh » : trois halos de la teinte de la catégorie sur son fond profond.
        backgroundImage: `radial-gradient(60% 90% at 100% 0%, ${theme.mid}cc 0%, transparent 60%),
          radial-gradient(50% 80% at 0% 100%, ${theme.mid}99 0%, transparent 65%),
          radial-gradient(40% 60% at 70% 110%, ${theme.ink} 0%, transparent 70%)`,
      }}
    >
      {/* Trame de points, estompée vers le centre. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(70% 70% at 80% 40%, black, transparent)",
          WebkitMaskImage: "radial-gradient(70% 70% at 80% 40%, black, transparent)",
        }}
      />

      <div className="page-inner grid items-center gap-10 py-10 sm:py-12 lg:grid-cols-[1.25fr_1fr] lg:py-14">
        <div className="max-w-2xl">
          {breadcrumb}
          <h1 className="mt-6 text-[34px] sm:text-[44px] lg:text-[52px] font-bold leading-[1.05] tracking-tight">{title}</h1>
          <p className="mt-4 max-w-xl text-base sm:text-lg leading-relaxed text-white/80">{subtitle}</p>
          <Link
            href="/comment-ca-marche"
            className="group mt-8 inline-flex items-center gap-2.5 rounded-full bg-white py-2 pl-2 pr-5 text-sm font-semibold text-[#0A1931] shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full text-white transition group-hover:scale-105" style={{ backgroundColor: theme.mid }}>
              <CirclePlay className="w-4 h-4" aria-hidden />
            </span>
            Comment fonctionne FlexWork
          </Link>
        </div>

        {/* Composition décorative : une tuile principale et deux satellites, en verre dépoli. */}
        <div aria-hidden className="relative hidden h-[240px] lg:block">
          <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]" />
          {main && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="animate-float motion-reduce:animate-none grid h-32 w-32 place-items-center rounded-[28px] border border-white/20 bg-white/15 shadow-2xl shadow-black/30 backdrop-blur-md">
                {(() => {
                  const Icon = main;
                  return <Icon className="h-14 w-14" strokeWidth={1.5} />;
                })()}
              </div>
            </div>
          )}
          {rest.map((Icon, i) => (
            <div
              key={i}
              className={`absolute ${i === 0 ? "left-[8%] top-[8%]" : "right-[6%] bottom-[6%]"}`}
            >
              <div
                className={`${i === 0 ? "animate-float-delayed" : "animate-float-slow"} motion-reduce:animate-none grid h-16 w-16 place-items-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md`}
              >
                <Icon className="h-7 w-7 text-white/90" strokeWidth={1.6} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
    </div>
  );
}

function Pill({
  href,
  label,
  icon,
  theme,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  theme: LandingTheme;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group snap-start shrink-0 flex items-center gap-3 rounded-full py-2 pl-2 pr-5 ring-1 transition duration-300 hover:-translate-y-0.5 ${
        active
          ? "text-white ring-transparent shadow-lg"
          : "bg-white text-[#0A1931] ring-black/[0.07] shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_24px_-8px_rgba(15,23,42,0.18)]"
      }`}
      style={active ? { backgroundColor: theme.deep } : undefined}
    >
      <span
        className="grid h-10 w-10 place-items-center rounded-full transition duration-300 group-hover:scale-105"
        style={active ? { backgroundColor: "rgba(255,255,255,0.15)" } : { backgroundColor: theme.soft, color: theme.ink }}
      >
        {icon}
      </span>
      <span className="whitespace-nowrap text-[15px] font-medium">{label}</span>
      <ArrowRight className={`w-4 h-4 -ml-1 transition duration-300 group-hover:translate-x-0.5 ${active ? "text-white/70" : "text-gray-400 group-hover:text-gray-700"}`} aria-hidden />
    </Link>
  );
}

// Lien compact vers un autre métier de la catégorie (page métier) : tuile d'icône en dégradé,
// libellé et nombre de compétences — de quoi rebondir sans repousser les résultats.
function MetierLink({ metier, count, theme }: { metier: LandingMetier; count: number; theme: LandingTheme }) {
  return (
    <Link
      href={metierHref(metier)}
      className="group relative flex items-center gap-4 overflow-hidden rounded-2xl bg-white p-4 ring-1 ring-black/[0.07] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-16px_rgba(15,23,42,0.25)]"
    >
      {/* Halo de la teinte, révélé au survol. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-2xl transition duration-500 group-hover:opacity-100"
        style={{ backgroundColor: theme.soft }}
      />
      <span
        className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow-md transition duration-300 group-hover:scale-105 group-hover:-rotate-3"
        style={{ backgroundImage: `linear-gradient(135deg, ${theme.mid}, ${theme.deep})` }}
      >
        <MetierIcon libelle={metier.libelle} className="w-5 h-5" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-[#0A1931]">{metier.libelle}</span>
        {count > 0 && <span className="block text-[13px] text-gray-500">{count} compétences</span>}
      </span>
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-50 text-gray-400 transition duration-300 group-hover:bg-[#0A1931] group-hover:text-white">
        <ArrowRight className="w-4 h-4 transition group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

// Vignette de métier : illustration générée (fenêtre stylisée + icône du métier) dans la teinte
// de la catégorie, une sur deux en fond sombre — le catalogue ne porte pas d'image par métier.
function MetierCard({
  metier,
  competences,
  theme,
  dark,
}: {
  metier: LandingMetier;
  competences: string[];
  theme: LandingTheme;
  dark: boolean;
}) {
  const shown = competences.slice(0, 4);
  return (
    <div>
      <Link href={metierHref(metier)} className="group block">
        <div
          className="relative aspect-[16/10] overflow-hidden rounded-2xl transition duration-500 group-hover:shadow-[0_24px_48px_-20px_rgba(15,23,42,0.35)]"
          style={{
            backgroundColor: dark ? theme.mid : theme.soft,
            backgroundImage: dark
              ? `radial-gradient(80% 80% at 100% 100%, ${theme.deep}aa, transparent 70%)`
              : `radial-gradient(80% 80% at 100% 100%, ${theme.mid}33, transparent 70%)`,
          }}
        >
          <div className="absolute left-[14%] right-[22%] top-[14%] bottom-[12%] rounded-xl bg-white shadow-lg transition duration-500 group-hover:-translate-y-1.5 group-hover:rotate-[-1deg]">
            <div className="flex gap-1 px-2.5 py-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-300" />
              ))}
            </div>
            <div className="mx-2.5 mb-2.5 h-[calc(100%-26px)] rounded-lg grid place-items-center" style={{ backgroundColor: theme.soft, color: theme.ink }}>
              <MetierIcon libelle={metier.libelle} className="w-10 h-10 sm:w-12 sm:h-12" />
            </div>
          </div>
          <div
            className="absolute right-[10%] bottom-[20%] w-[22%] aspect-square rounded-full shadow-lg grid place-items-center text-white transition duration-500 group-hover:scale-110"
            style={{ backgroundColor: dark ? theme.deep : theme.mid }}
          >
            <ArrowRight className="w-5 h-5 transition group-hover:translate-x-0.5" aria-hidden />
          </div>
        </div>
        <h3 className="mt-4 text-lg font-semibold leading-snug text-[#0A1931] transition group-hover:opacity-80">{metier.libelle}</h3>
      </Link>
      {shown.length > 0 && (
        <ul className="mt-3 space-y-2">
          {shown.map((c) => (
            <li key={c}>
              <Link href={competenceHref(metier.id, c)} className="text-[15px] text-gray-500 transition hover:text-[#0A1931]">
                {c}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {competences.length > shown.length && (
        <Link href={metierHref(metier)} className="mt-2.5 inline-block text-sm font-semibold hover:underline" style={{ color: theme.ink }}>
          + {competences.length - shown.length} autres
        </Link>
      )}
    </div>
  );
}
