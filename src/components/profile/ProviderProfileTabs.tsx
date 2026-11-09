"use client";

// Profil prestataire en FORMULAIRE PAR ÉTAPES (2026-11-07).
//
// ── Ce que remplace ce shell ────────────────────────────────────────────────────────────
//
// Cinq onglets libres (2026-09-23), qui avaient eux-mêmes remplacé un formulaire d'une page.
// Les onglets laissaient tout ouvrir dans n'importe quel ordre — y compris Présentation ou
// Localisation AVANT le métier principal, alors que sans lui aucun enregistrement ne passe
// (`main_domain_required`). Le parcours est désormais guidé :
//
//   1. Domaines  2. Présentation  3. Expérience  4. Localisation  5. Configuration
//
//   - Domaines d'abord : c'est lui qui CRÉE le profil. Tant qu'il n'existe pas, les étapes
//     suivantes sont verrouillées (visibles, non cliquables).
//   - On arrive sur la première étape incomplète ; `?tab=` force une étape (liens existants).
//   - Chaque étape s'enregistre séparément, comme avant — l'une échoue, les autres sont
//     acquises. Enregistrer mène à l'étape incomplète SUIVANTE ; « Passer » avance sans rien
//     enregistrer ; « Précédent » recule. Une étape déjà ouverte garde sa saisie (montée,
//     masquée) : passer n'efface rien.
//   - Profil complet : écran de fin. En MISE À JOUR (profil déjà complet), toutes les étapes
//     sont libres, on navigue comme on veut.
//
// ── Chronologie : édition → enregistrement → vue du profil → modification par rubrique ──
//
// (2026-11-08) Le formulaire par étapes ne sert qu'à CONSTRUIRE le profil. Dès qu'il est à
// 100 %, /profile bascule en VUE : chaque rubrique s'affiche telle qu'enregistrée, avec un
// bouton « Modifier » qui n'ouvre que SON formulaire. Enregistrer referme la rubrique et
// revient à la vue. Le parcours par étapes ne réapparaît plus. `?tab=<rubrique>` ouvre
// directement la rubrique en modification (liens existants : /declarations, devis…).
//
// ── Ce que le pourcentage est, et n'est pas ─────────────────────────────────────────────
//
// Il vient du SERVEUR (`GET /api/profile/completion`), jamais d'un calcul local. Il est
// INFORMATIF — il ne débloque rien (modele-skillafrica-v3 §9 : seul le KYC conditionne des
// actions précises). Le seul verrou du parcours est l'existence du profil.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StepSaveLabelContext, type ProviderIdentity, type ProviderProfile } from "@/components/profile/profile-shared";
import { PresentationTab } from "@/components/profile/tabs/PresentationTab";
import { DomainesTab } from "@/components/profile/tabs/DomainesTab";
import { ExperienceTab } from "@/components/profile/tabs/ExperienceTab";
import { LocalisationTab } from "@/components/profile/tabs/LocalisationTab";
import { ConfigurationTab } from "@/components/profile/tabs/ConfigurationTab";
import { PortfolioEditor } from "@/components/profile/PortfolioEditor";
import { GigManager } from "@/components/gig/GigManager";
import {
  ProfileSectionSummary,
  type SummaryDiploma,
  type SummaryExperience,
} from "@/components/profile/ProfileSectionSummary";

type CompletionSection = {
  key: string;
  label: string;
  weight: number;
  done: boolean;
  items: { key: string; label: string; done: boolean }[];
};

type Completion = {
  percent: number;
  done: number;
  total: number;
  sections: CompletionSection[];
  missing: string[];
  hasProfile: boolean;
};

type StepKey = "domaines" | "presentation" | "experience" | "localisation" | "configuration";

// Les clés sont celles des sections du barème : l'étape, la barre de progression et le
// pourcentage parlent de la même chose, sans table de correspondance.
const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "domaines", label: "Domaines", hint: "Votre métier principal et vos compétences." },
  { key: "presentation", label: "Présentation", hint: "Photo, titre et bio : ce que le client voit en premier." },
  { key: "experience", label: "Expérience", hint: "Niveau, expériences, diplômes et portfolio." },
  { key: "localisation", label: "Localisation", hint: "Où et comment vous intervenez." },
  { key: "configuration", label: "Configuration", hint: "Tarif, devise et mode de contact." },
];

// Rubriques de la vue « profil complet » (2026-11-08) : les cinq étapes, plus « Portfolio et
// CV », sorti de l'étape Expérience où personne ne le retrouvait en modification. Ce n'est pas
// une section du barème : il n'a ni poids ni badge « À compléter ».
type RubriqueKey = StepKey | "portfolio" | "services";
const RUBRIQUES: { key: RubriqueKey; label: string; hint: string }[] = [
  { key: "domaines", label: "Domaines", hint: "Votre métier principal et vos compétences." },
  { key: "presentation", label: "Présentation", hint: "Photo, titre et bio : ce que le client voit en premier." },
  { key: "experience", label: "Expérience", hint: "Niveau, expériences professionnelles et diplômes." },
  { key: "portfolio", label: "Portfolio et CV", hint: "Photos de réalisations, liens vers vos travaux et CV." },
  // Services à prix fixe (Gigs), 2026-11-08 : gérés ici, depuis le profil, comme sur la page
  // publique où ils s'affichent sous la présentation.
  { key: "services", label: "Mes services", hint: "Vos offres à prix fixe : 3 formules, visuel, mots-clés." },
  { key: "localisation", label: "Localisation", hint: "Où et comment vous intervenez." },
  { key: "configuration", label: "Configuration", hint: "Tarif, devise et mode de contact." },
];
const isRubriqueKey = (v: string | null | undefined): v is RubriqueKey => !!v && RUBRIQUES.some((r) => r.key === v);

function isStepKey(value: string | null | undefined): value is StepKey {
  return !!value && STEPS.some((s) => s.key === value);
}

const PROVIDER_DASHBOARD = "/dashboard/provider";

function isComplete(c: Completion | null): boolean {
  return !!c && c.percent >= 100;
}

function sectionOf(completion: Completion | null, key: StepKey) {
  return completion?.sections.find((s) => s.key === key);
}

/** Étape incomplète suivante, dans l'ordre du parcours, en repartant du début au besoin. */
function nextIncompleteStep(from: StepKey, completion: Completion | null): StepKey | null {
  if (!completion) return null;
  const start = STEPS.findIndex((s) => s.key === from);
  for (let i = 1; i < STEPS.length; i++) {
    const key = STEPS[(start + i) % STEPS.length].key;
    if (!sectionOf(completion, key)?.done) return key;
  }
  return null;
}

export default function ProviderProfileTabs({
  initialTab,
  returnTo,
  userId,
}: {
  initialTab?: string;
  returnTo?: string | null;
  /** Compte connecté : lien vers son profil public (/profil/[id]), tel que les clients le voient. */
  userId?: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStepState] = useState<StepKey>("domaines");
  // Étapes déjà ouvertes : elles restent MONTÉES (masquées) quand on en change — une saisie
  // non enregistrée survit à « Passer » et « Précédent ». Montage paresseux : une étape jamais
  // ouverte ne charge rien.
  const [visited, setVisited] = useState<Set<StepKey>>(() => new Set());
  const [finished, setFinished] = useState(false);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [identity, setIdentity] = useState<ProviderIdentity | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [loading, setLoading] = useState(true);
  // « wizard » : construction guidée. « overview » : profil complet, vue + modification par
  // rubrique. On ne revient jamais de « overview » à « wizard » dans la session.
  const [mode, setMode] = useState<"wizard" | "overview">("wizard");
  const [editing, setEditing] = useState<RubriqueKey | null>(null);
  const [declared, setDeclared] = useState<{ experiences: SummaryExperience[]; diplomas: SummaryDiploma[] }>({
    experiences: [],
    diplomas: [],
  });

  const hasProfile = !!profile;
  const isLocked = useCallback((key: StepKey) => !hasProfile && key !== "domaines", [hasProfile]);

  const goTo = useCallback(
    (key: StepKey, opts: { scroll?: boolean } = {}) => {
      if (isLocked(key)) return;
      // Navigation choisie par l'utilisateur : l'annonce de l'enregistrement précédent n'a
      // plus d'objet.
      setNotice(null);
      setFinished(false);
      setStepState(key);
      setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [isLocked],
  );

  const loadCompletion = useCallback(async (): Promise<Completion | null> => {
    const res = await fetch("/api/profile/completion");
    if (!res.ok) return null;
    const data = (await res.json()) as Completion;
    setCompletion(data);
    return data;
  }, []);

  // Expériences et diplômes (déclarations les plus récentes) pour la vue du profil.
  const loadDeclared = useCallback(async (profileId: string) => {
    const res = await fetch(`/api/declarations?profileId=${encodeURIComponent(profileId)}`).catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as { items?: { experiences?: SummaryExperience[]; diplomas?: SummaryDiploma[] }[] };
    const items = d.items ?? [];
    setDeclared({
      experiences: items.flatMap((i) => i.experiences ?? []),
      diplomas: items.flatMap((i) => i.diplomas ?? []),
    });
  }, []);

  useEffect(() => {
    if (mode === "overview" && profile?.id) void loadDeclared(profile.id);
  }, [mode, profile?.id, loadDeclared]);

  // Chargement initial : profil, identité ET barème avant le premier rendu — c'est le barème
  // qui dit sur quelle étape ouvrir.
  //
  // Chargement ANNULABLE (2026-11-08) : une réponse tardive d'un chargement abandonné — double
  // exécution des effets en développement (Strict Mode), démontage — écrasait l'état courant :
  // elle refermait la rubrique en cours de modification et remettait un profil périmé.
  useEffect(() => {
    let alive = true;
    Promise.all([
      // 404 = pas encore de profil : un compte fraîchement promu prestataire commence ici.
      fetch("/api/profile").then(async (r) => (r.ok ? ((await r.json()) as ProviderProfile) : null)),
      fetch("/api/users/me").then(async (r) => (r.ok ? ((await r.json()) as ProviderIdentity) : null)),
      loadCompletion(),
    ])
      .then(([p, i, c]) => {
        if (!alive) return;
        setProfile(p);
        setIdentity(i);
        if (p && isComplete(c)) {
          // Profil complet : la vue, avec la rubrique demandée par l'URL ouverte en modification.
          setMode("overview");
          setEditing(isRubriqueKey(initialTab) ? initialTab : null);
          return;
        }
        // Étape d'arrivée : celle demandée par l'URL si elle est ouverte, sinon la première
        // incomplète, sinon (profil complet, mise à jour) la première.
        const first: StepKey = !p
          ? "domaines"
          : isStepKey(initialTab)
            ? initialTab
            : (STEPS.find((s) => !sectionOf(c, s.key)?.done)?.key ?? "domaines");
        setStepState(first);
        setVisited(new Set([first]));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // `initialTab` ne sert qu'à l'arrivée : la suite du parcours est pilotée par l'état.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCompletion]);

  // Étape reflétée dans l'URL (`?tab=`, nom conservé pour les liens existants) : un
  // rechargement rouvre la même étape.
  useEffect(() => {
    if (loading) return;
    const url = new URL(window.location.href);
    const tab = mode === "overview" ? editing : step;
    if (tab) url.searchParams.set("tab", tab);
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  }, [step, loading, mode, editing]);

  // Bascule vers la vue du profil (fin du parcours à 100 %).
  const showOverview = useCallback((message: string | null) => {
    setMode("overview");
    setEditing(null);
    setFinished(false);
    setNotice(message);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const openEditor = useCallback((key: RubriqueKey) => {
    setNotice(null);
    setEditing(key);
    requestAnimationFrame(() =>
      document.getElementById(`rubrique-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  const closeEditor = useCallback((key: RubriqueKey, message: string | null) => {
    setEditing(null);
    setNotice(message);
    requestAnimationFrame(() =>
      document.getElementById(`rubrique-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  // Enregistrement d'une rubrique en mode vue : retour à la page d'origine si elle attend
  // (`returnTo`), sinon la rubrique se referme sur son résumé à jour.
  const handleSectionSaved = useCallback(
    async (from: StepKey, p: ProviderProfile) => {
      setProfile(p);
      await loadCompletion();
      if (returnTo) {
        router.push(returnTo);
        return;
      }
      closeEditor(from, `${STEPS.find((s) => s.key === from)?.label ?? from} : modifications enregistrées.`);
    },
    [closeEditor, loadCompletion, returnTo, router],
  );

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Après l'enregistrement d'une étape (formulaires à bouton unique) — ordre standard :
  //   1. `returnTo` : retour à la page d'origine (mission, devis) où attend un brouillon ;
  //   2. sinon l'étape incomplète suivante ;
  //   3. profil complet : écran de fin.
  // Calculé sur le barème RAFRAÎCHI, jamais sur l'ancien.
  const handleStepSaved = useCallback(
    async (from: StepKey, p: ProviderProfile) => {
      setProfile(p);
      const fresh = await loadCompletion();
      if (returnTo) {
        router.push(returnTo);
        return;
      }
      const label = STEPS.find((s) => s.key === from)?.label ?? from;
      const next = nextIncompleteStep(from, fresh);
      if (next) {
        // `isLocked` lit encore l'ancien `profile` (création à l'étape Domaines) : l'étape
        // suivante est ouverte puisqu'un profil vient d'être renvoyé.
        setFinished(false);
        setStepState(next);
        setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
        window.scrollTo({ top: 0, behavior: "smooth" });
        setNotice(`${label} : enregistré. Étape suivante : ${STEPS.find((s) => s.key === next)?.label}.`);
        return;
      }
      if (isComplete(fresh)) {
        showOverview("Votre profil est complet. Voici ce que vous avez enregistré : modifiez une rubrique à la fois.");
        return;
      }
      setFinished(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [loadCompletion, returnTo, router, showOverview],
  );

  const index = STEPS.findIndex((s) => s.key === step);
  const current = STEPS[index];
  const prev = index > 0 ? STEPS[index - 1] : null;
  const next = index < STEPS.length - 1 ? STEPS[index + 1] : null;
  const activeSection = sectionOf(completion, step);
  const doneCount = useMemo(() => STEPS.filter((s) => sectionOf(completion, s.key)?.done).length, [completion]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 py-6 sm:py-10 px-4" aria-busy="true" aria-label="Chargement du profil">
        <div className="mx-auto fluid-form [--fw:820px] space-y-4 animate-pulse">
          <div className="h-7 w-72 max-w-full rounded-lg bg-zinc-200" />
          <div className="h-[150px] rounded-[20px] bg-white border border-gray-100" />
          <div className="h-[320px] rounded-[20px] bg-white border border-gray-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-6 sm:py-10 px-4">
      <div className="mx-auto fluid-form [--fw:820px] space-y-4 sm:space-y-5">
        {mode === "overview" && profile ? (
          <ProfileOverview
            profile={profile}
            identity={identity}
            completion={completion}
            declared={declared}
            editing={editing}
            notice={notice}
            userId={userId}
            onEdit={openEditor}
            onCancel={(key) => closeEditor(key, null)}
            renderEditor={(key) => (
              <StepSaveLabelContext.Provider value="Enregistrer les modifications">
                {key === "domaines" && <DomainesTab profile={profile} onSaved={(p) => void handleSectionSaved("domaines", p)} />}
                {key === "presentation" && (
                  <PresentationTab
                    profile={profile}
                    identity={identity}
                    onSaved={(p) => void handleSectionSaved("presentation", p)}
                    onIdentity={setIdentity}
                  />
                )}
                {key === "portfolio" && <PortfolioEditor profile={profile} onSaved={setProfile} />}
                {key === "services" && (
                  <GigManager defaultDomaine={profile.mainDomain} publicProfileHref={userId ? `/profil/${userId}#services-titre` : undefined} />
                )}
                {key === "experience" && (
                  <ExperienceTab
                    profile={profile}
                    showPortfolio={false}
                    onSaved={setProfile}
                    onCompletionChanged={() => {
                      void loadCompletion();
                      void loadDeclared(profile.id);
                    }}
                  />
                )}
                {key === "localisation" && <LocalisationTab profile={profile} onSaved={(p) => void handleSectionSaved("localisation", p)} />}
                {key === "configuration" && <ConfigurationTab profile={profile} onSaved={(p) => void handleSectionSaved("configuration", p)} />}
              </StepSaveLabelContext.Provider>
            )}
          />
        ) : (
        <>
        <div>
          <h1 className="text-[clamp(1.375rem,1.1rem+1.1vw,1.75rem)] font-bold leading-tight text-[#0A1931]">
            {hasProfile ? "Mon profil prestataire" : "Créer mon profil prestataire"}
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-zinc-500">
            {hasProfile
              ? "Cinq étapes, chacune enregistrée séparément. Rien ici ne bloque votre candidature : seul le KYC conditionne votre droit à postuler."
              : "Commencez par votre métier principal : il crée votre profil et ouvre les étapes suivantes."}
          </p>
        </div>

        {/* ── Progression + étapes ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-[20px] border border-gray-100 shadow-[0_1px_2px_rgba(10,25,49,0.04)] p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3 mb-2.5">
            <span className="text-[14px] font-semibold text-[#0A1931]">
              {finished ? "Profil complet" : `Étape ${index + 1} sur ${STEPS.length} · ${current.label}`}
            </span>
            <span className="text-[18px] font-bold tabular-nums text-[#008751]">{completion ? `${completion.percent} %` : "—"}</span>
          </div>
          <div
            className="h-2 rounded-full bg-gray-100 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion?.percent ?? 0}
            aria-label="Complétion du profil"
          >
            <div
              className="h-full rounded-full bg-[#008751] transition-[width] duration-700 ease-out"
              style={{ width: `${completion?.percent ?? 0}%` }}
            />
          </div>

          <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Étapes du profil">
            {STEPS.map((s, i) => {
              const done = !!sectionOf(completion, s.key)?.done;
              const active = !finished && s.key === step;
              const locked = isLocked(s.key);
              return (
                <li key={s.key} className="relative flex flex-col items-center text-center">
                  {/* Trait vers l'étape suivante, vert une fois l'étape acquise. */}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={`absolute top-[17px] left-[calc(50%+20px)] right-[calc(-50%+20px)] h-0.5 rounded-full ${
                        done ? "bg-[#008751]" : "bg-zinc-200"
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => goTo(s.key)}
                    disabled={locked}
                    aria-current={active ? "step" : undefined}
                    aria-label={`Étape ${i + 1} : ${s.label}${done ? " (complète)" : ""}${locked ? " (verrouillée)" : ""}`}
                    className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008751]/40 disabled:cursor-not-allowed ${
                      active
                        ? "border-[#0A1931] bg-[#0A1931] text-white"
                        : done
                          ? "border-[#008751] bg-[#008751] text-white hover:bg-[#006e43]"
                          : locked
                            ? "border-zinc-200 bg-zinc-50 text-zinc-300"
                            : "border-zinc-300 bg-white text-zinc-500 hover:border-[#0A1931] hover:text-[#0A1931]"
                    }`}
                  >
                    {locked ? <LockIcon /> : done && !active ? "✓" : i + 1}
                  </button>
                  <span
                    className={`mt-1.5 text-[11px] sm:text-[12px] leading-tight ${
                      active ? "font-semibold text-[#0A1931]" : locked ? "text-zinc-300" : "text-zinc-500"
                    } ${active ? "" : "hidden sm:block"}`}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {!finished && (
            <p className="mt-3 text-[13px] leading-relaxed text-zinc-500">
              {activeSection && !activeSection.done ? (
                <>
                  Pour valider cette étape ({activeSection.weight} %) :{" "}
                  {activeSection.items.filter((i) => !i.done).map((i) => i.label.toLowerCase()).join(", ")}.
                </>
              ) : activeSection?.done ? (
                <span className="text-emerald-700">✓ Étape complète — vous pouvez la modifier à tout moment.</span>
              ) : (
                current.hint
              )}
            </p>
          )}
        </div>

        {notice && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 motion-safe:animate-in motion-safe:fade-in"
          >
            <span aria-hidden>✓</span>
            {notice}
          </div>
        )}

        {finished ? (
          <FinishedPanel returnTo={returnTo} doneCount={doneCount} userId={userId} onReview={() => goTo("domaines")} />
        ) : (
          <StepSaveLabelContext.Provider value={next ? "Enregistrer et continuer" : "Enregistrer et terminer"}>
            <StepPanel id="presentation" active={step} visited={visited}>
              <PresentationTab
                profile={profile}
                identity={identity}
                onSaved={(p) => void handleStepSaved("presentation", p)}
                onIdentity={setIdentity}
              />
            </StepPanel>
            <StepPanel id="domaines" active={step} visited={visited}>
              {/* `key` : un profil nouvellement créé réinitialise la cascade. */}
              <DomainesTab key={profile?.id ?? "nouveau"} profile={profile} onSaved={(p) => void handleStepSaved("domaines", p)} />
            </StepPanel>
            <StepPanel id="experience" active={step} visited={visited}>
              {/* Plusieurs ajouts indépendants, pas de bouton unique : on avance avec « Continuer ». */}
              <ExperienceTab profile={profile} onSaved={setProfile} onCompletionChanged={() => void loadCompletion()} />
            </StepPanel>
            <StepPanel id="localisation" active={step} visited={visited}>
              <LocalisationTab profile={profile} onSaved={(p) => void handleStepSaved("localisation", p)} />
            </StepPanel>
            <StepPanel id="configuration" active={step} visited={visited}>
              <ConfigurationTab profile={profile} onSaved={(p) => void handleStepSaved("configuration", p)} />
            </StepPanel>

            {/* ── Navigation du parcours ───────────────────────────────────────────────── */}
            <nav className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4" aria-label="Navigation entre les étapes">
              {prev ? (
                <button
                  type="button"
                  onClick={() => goTo(prev.key)}
                  className="h-10 px-4 rounded-full text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                >
                  ← <span className="hidden sm:inline">{prev.label}</span>
                  <span className="sm:hidden">Précédent</span>
                </button>
              ) : (
                <span />
              )}
              {next ? (
                <button
                  type="button"
                  onClick={() => goTo(next.key)}
                  disabled={isLocked(next.key)}
                  title={isLocked(next.key) ? "Enregistrez d'abord votre métier principal." : undefined}
                  className="h-10 px-5 rounded-full border border-zinc-200 bg-white text-[13px] font-semibold text-[#0A1931] hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {activeSection?.done ? "Continuer" : "Passer cette étape"}
                  <span className="hidden sm:inline"> : {next.label}</span> →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (isComplete(completion)) {
                      showOverview("Votre profil est complet. Voici ce que vous avez enregistré : modifiez une rubrique à la fois.");
                      return;
                    }
                    setNotice(null);
                    setFinished(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={!hasProfile}
                  className="h-10 px-5 rounded-full border border-zinc-200 bg-white text-[13px] font-semibold text-[#0A1931] hover:bg-zinc-50 transition-colors disabled:opacity-40"
                >
                  Terminer →
                </button>
              )}
            </nav>
          </StepSaveLabelContext.Provider>
        )}
        </>
        )}

        <nav className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-[13px]" aria-label="Liens du profil">
          {returnTo ? (
            <Link href={returnTo} className="font-medium text-zinc-500 hover:text-[#0A1931] hover:underline">
              ← Revenir à la page précédente
            </Link>
          ) : (
            <Link href={PROVIDER_DASHBOARD} className="font-medium text-zinc-500 hover:text-[#0A1931] hover:underline">
              ← Retour au tableau de bord
            </Link>
          )}
          {userId && hasProfile && mode === "wizard" && (
            <Link href={`/profil/${userId}`} className="font-medium text-[#008751] hover:underline">
              Voir mon profil public
            </Link>
          )}
          <Link href="/badge?returnTo=%2Fprofile" className="font-medium text-zinc-500 hover:text-[#0A1931] hover:underline">
            Badge « Vérifié »
          </Link>
        </nav>
      </div>
    </div>
  );
}

/**
 * Vue du profil complet : une carte par rubrique, résumé en lecture + « Modifier ». Une seule
 * rubrique en modification à la fois ; son formulaire remplace son résumé, dans sa carte.
 */
function ProfileOverview({
  profile,
  identity,
  completion,
  declared,
  editing,
  notice,
  userId,
  onEdit,
  onCancel,
  renderEditor,
}: {
  profile: ProviderProfile;
  identity: ProviderIdentity | null;
  completion: Completion | null;
  declared: { experiences: SummaryExperience[]; diplomas: SummaryDiploma[] };
  editing: RubriqueKey | null;
  notice: string | null;
  userId?: string;
  onEdit: (key: RubriqueKey) => void;
  onCancel: (key: RubriqueKey) => void;
  renderEditor: (key: RubriqueKey) => ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(1.375rem,1.1rem+1.1vw,1.75rem)] font-bold leading-tight text-[#0A1931]">Mon profil prestataire</h1>
          <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-zinc-500">
            Votre profil est complet. Modifiez une rubrique à la fois : vos changements sont visibles des clients dès
            l&apos;enregistrement.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-semibold text-[#008751]">
          ✓ Complet · {completion?.percent ?? 100} %
        </span>
      </div>

      {userId && (
        <Link
          href={`/profil/${userId}?returnTo=%2Fprofile`}
          className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[14px] font-medium text-[#0A1931] shadow-sm hover:bg-zinc-50 transition"
          style={{ textDecoration: "none" }}
        >
          <span>
            Voir mon profil public
            <span className="ml-2 text-[13px] font-normal text-zinc-500">tel que les clients le voient</span>
          </span>
          <span aria-hidden className="text-zinc-400">→</span>
        </Link>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 motion-safe:animate-in motion-safe:fade-in"
        >
          <span aria-hidden>✓</span>
          {notice}
        </div>
      )}

      {RUBRIQUES.map((s) => {
        const open = editing === s.key;
        // Portfolio et services ne sont pas des sections du barème : jamais « À compléter ».
        const done = s.key === "portfolio" || s.key === "services" || !!sectionOf(completion, s.key)?.done;
        return (
          <section
            key={s.key}
            id={`rubrique-${s.key}`}
            aria-labelledby={`rubrique-${s.key}-titre`}
            className={`scroll-mt-6 rounded-[20px] border bg-white shadow-[0_1px_2px_rgba(10,25,49,0.04)] ${
              open ? "border-[#0A1931]/20" : "border-gray-100"
            }`}
          >
            <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                <h2 id={`rubrique-${s.key}-titre`} className="flex items-center gap-2 text-[17px] font-bold text-[#0A1931]">
                  {s.label}
                  {!done && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">À compléter</span>
                  )}
                </h2>
                <p className="mt-0.5 text-[13px] text-zinc-500">{open ? "Modification en cours" : s.hint}</p>
              </div>
              {open ? (
                <button
                  type="button"
                  onClick={() => onCancel(s.key)}
                  className="h-9 shrink-0 rounded-full px-4 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 transition"
                >
                  {s.key === "experience" || s.key === "portfolio" || s.key === "services" ? "Terminer" : "Annuler"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onEdit(s.key)}
                  aria-label={`Modifier la rubrique ${s.label}`}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 text-[13px] font-semibold text-[#0A1931] hover:bg-zinc-50 transition"
                >
                  <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5">
                    <path
                      d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Modifier
                </button>
              )}
            </header>
            <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
              {open ? (
                <div className="motion-safe:animate-in motion-safe:fade-in">{renderEditor(s.key)}</div>
              ) : (
                <ProfileSectionSummary
                  step={s.key}
                  profile={profile}
                  identity={identity}
                  experiences={declared.experiences}
                  diplomas={declared.diplomas}
                />
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Fin du parcours : profil complet, ou parcours terminé avec des étapes passées. */
function FinishedPanel({
  returnTo,
  doneCount,
  userId,
  onReview,
}: {
  returnTo?: string | null;
  doneCount: number;
  userId?: string;
  onReview: () => void;
}) {
  const complete = doneCount === STEPS.length;
  return (
    <section className="rounded-[20px] border border-gray-100 bg-white p-6 sm:p-8 text-center shadow-[0_1px_2px_rgba(10,25,49,0.04)] motion-safe:animate-in motion-safe:fade-in">
      <div
        aria-hidden
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-[26px] ${
          complete ? "bg-emerald-50 text-[#008751]" : "bg-amber-50 text-amber-600"
        }`}
      >
        {complete ? "✓" : "…"}
      </div>
      <h2 className="mt-4 text-[20px] font-bold text-[#0A1931]">
        {complete ? "Votre profil est complet" : `${doneCount} étape${doneCount > 1 ? "s" : ""} sur ${STEPS.length} complète${doneCount > 1 ? "s" : ""}`}
      </h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-[14px] leading-relaxed text-zinc-500">
        {complete
          ? "Les clients voient désormais un profil abouti. Vous pouvez le modifier à tout moment."
          : "Votre profil est enregistré tel quel. Complétez les étapes restantes quand vous le souhaitez : un profil complet inspire davantage confiance."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          href={returnTo ?? PROVIDER_DASHBOARD}
          className="h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition flex items-center"
        >
          {returnTo ? "Revenir à la page précédente" : "Aller au tableau de bord"}
        </Link>
        <button
          type="button"
          onClick={onReview}
          className="h-10 px-5 rounded-full border border-zinc-200 bg-white text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition"
        >
          {complete ? "Revoir mon profil" : "Reprendre les étapes"}
        </button>
        {userId && (
          <Link
            href={`/profil/${userId}`}
            className="h-10 px-5 rounded-full border border-zinc-200 bg-white text-[13px] font-medium text-[#008751] hover:bg-zinc-50 transition flex items-center"
          >
            Voir mon profil public
          </Link>
        )}
      </div>
    </section>
  );
}

function StepPanel({ id, active, visited, children }: { id: StepKey; active: StepKey; visited: Set<StepKey>; children: ReactNode }) {
  if (!visited.has(id)) return null;
  return (
    <div
      id={`step-${id}`}
      role="region"
      aria-label={STEPS.find((s) => s.key === id)?.label}
      hidden={active !== id}
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
    >
      {children}
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
