"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECTEURS, secteurLabel } from "@/lib/secteur";

// Cascade Catégorie → Métier → Compétences, adossée à GET /api/taxonomy.
//
// Remplace les deux champs texte libres du formulaire de mission (« Domaine », « Compétences
// requises »). L'enjeu n'est pas le confort de saisie : `src/lib/domain-match.ts` rapproche
// aujourd'hui les missions des prestataires par RECHERCHE DE SOUS-CHAÎNE entre deux champs
// libres, ce qui est asymétrique (un profil « Plomberie sanitaire » n'atteint pas une mission
// « Plomberie »). Choisir dans le catalogue des deux côtés rend le rapprochement exact.
//
// ── Optimisations client ────────────────────────────────────────────────────────────────
//
//  1. L'arbre (16 Ko) part en UNE requête au montage. Les compétences (0,5 Ko par métier) ne
//     sont demandées qu'à la sélection du métier — charger les 1 306 d'avance coûterait 98 Ko
//     pour n'en afficher que six.
//  2. Les compétences déjà chargées sont mémorisées par métier : revenir sur un métier déjà
//     visité ne refait aucune requête.
//  3. Une requête en vol est annulée si l'utilisateur change de métier avant sa fin, et sa
//     réponse est ignorée si elle arrive après — sinon une réponse lente écrase une rapide et
//     la liste affiche les compétences du métier précédent.
//  4. Les listes dérivées passent par `useMemo` : changer de catégorie ne re-filtre pas les
//     220 métiers à chaque frappe ailleurs dans le formulaire.
//  5. Le composant est mémoïsé (`memo`). Il vit dans un tunnel dont l'état change à chaque
//     caractère saisi ; sans ça, React reconstruisait les 220 <option> du select Métier à
//     chaque frappe dans le titre ou la description. Ses props sont soit stables
//     (`onChange` = un setter d'état), soit des primitives comparables à l'identique.
//  6. L'arbre et les compétences sont mis en cache au niveau du MODULE, pas du composant.
//     La cascade sert désormais deux écrans (création de mission et profil prestataire) :
//     sans ce partage, passer de l'un à l'autre re-téléchargeait les 16 Ko à chaque montage.
//     Le cache vit le temps de l'onglet — la taxonomie ne change pas pendant une session.

export type TaxonomyMetier = { id: string; libelle: string; riskLevel?: RiskLevelValue };
// `secteur` (2026-09-28) : pôle DIGITAL / BTP / SERVICES posé par l'administrateur, `null` tant
// que la catégorie n'est pas classée (voir src/lib/secteur.ts).
export type TaxonomyCategorie = {
  id: string;
  libelle: string;
  icon: string | null;
  secteur: string | null;
  // Vérification OPR autorisée pour cette catégorie (2026-10-01). Facultatif : une taxonomie
  // servie avant ce champ vaut « non ».
  allowsOprVerification?: boolean;
  metiers: TaxonomyMetier[];
};
export type TaxonomyService = { id: string; libelle: string; description: string | null };

// Le palier vient du métier lui-même (voir src/lib/metier-risk.ts) : la cascade le transporte
// comme le libellé, plutôt que de laisser chaque écran redemander la règle au serveur — c'est
// cette requête séparée qui, en lisant une autre table, pouvait annoncer autre chose que la
// règle réellement appliquée.
export type RiskLevelValue = "low" | "medium" | "high";

export type TaxonomySelection = {
  categorieId: string;
  metierId: string;
  // Libellés portés avec les identifiants : le récapitulatif doit relire « Plomberie », pas
  // un cuid. Les redemander au serveur pour l'affichage serait un aller-retour pour une
  // donnée que la cascade a déjà en main.
  categorieLabel: string;
  metierLabel: string;
  competences: string[];
  // Libellé du secteur de la catégorie choisie (2026-09-28), pour le récapitulatif. DÉDUIT de
  // la catégorie, jamais saisi ni envoyé à l'API (A16) : facultatif, pour que les sélections
  // construites ailleurs (brouillon ancien, profil) restent valides sans lui.
  secteurLabel?: string;
  // Code du secteur (`digital` | `btp` | `services`, `null` = non classée), pour les choix qui
  // en dépendent — le professionnel ciblé par une mission (src/lib/secteur.ts).
  secteur?: string | null;
  // La catégorie choisie autorise-t-elle la vérification « OPR / responsable chantier » ?
  // DÉDUIT de la catégorie, jamais saisi — le serveur le revérifie à la publication.
  allowsOprVerification?: boolean;
};

// ── Filtre par secteur (2026-09-28) ─────────────────────────────────────────────────────────
// Premier niveau de la cascade : Secteur → Catégorie → Métier → Compétences. C'est un FILTRE
// de la liste des catégories, pas un champ de la mission — le secteur se lit à travers la
// catégorie. Il est facultatif (« Tous les secteurs ») et les catégories non classées restent
// accessibles sous « Autres » : tant que l'administrateur n'a pas tout classé, un secteur
// obligatoire rendrait des catégories introuvables, et la publication impossible.
const SECTEUR_ALL = "";
const SECTEUR_OTHERS = "autres";

function secteurKey(categorie: TaxonomyCategorie | undefined): string {
  return categorie?.secteur ?? SECTEUR_OTHERS;
}

function secteurLabelOf(categorie: TaxonomyCategorie | undefined): string {
  if (!categorie) return "";
  return categorie.secteur ? secteurLabel(categorie.secteur) : "";
}

const MAX_COMPETENCES = 5;

// Caches partagés par toutes les instances de la cascade, pour la durée de l'onglet.
// `treeRequest` mémorise la PROMESSE et non seulement le résultat : deux cascades montées
// simultanément partagent alors la même requête au lieu d'en lancer deux.
let treeRequest: Promise<TaxonomyCategorie[]> | null = null;
const serviceCache = new Map<string, TaxonomyService[]>();

function loadTree(): Promise<TaxonomyCategorie[]> {
  if (!treeRequest) {
    treeRequest = fetch("/api/taxonomy")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("taxonomy"))))
      .then((d) => (d.categories ?? []) as TaxonomyCategorie[])
      .catch((err) => {
        // Un échec ne doit pas être mis en cache : la prochaine cascade montée doit pouvoir
        // réessayer, sinon une coupure réseau passagère condamne la page jusqu'au rechargement.
        treeRequest = null;
        throw err;
      });
  }
  return treeRequest;
}

/**
 * Retrouve la sélection complète à partir d'un métier déjà enregistré (2026-09-23).
 *
 * Sert au formulaire prestataire : le profil ne stocke QUE le métier (`Profile.metierId`),
 * alors que la cascade demande de choisir d'abord une catégorie. Sans cette remontée, rouvrir
 * l'onglet Domaines affichait une cascade vide sur un profil qui avait bel et bien choisi son
 * métier — au mieux déroutant, au pire un reclassement dans la mauvaise catégorie.
 *
 * Réutilise l'arbre déjà téléchargé par la cascade (`loadTree`) : aucune requête
 * supplémentaire, et la sélection porte exactement les libellés affichés dans les listes.
 * `null` signifie que le métier n'est plus au catalogue — l'appelant garde alors le libellé
 * enregistré plutôt que d'effacer le travail de l'utilisateur.
 */
export async function resolveMetierSelection(
  metierId: string,
  competences: string[] = [],
): Promise<TaxonomySelection | null> {
  const categories = await loadTree();
  for (const categorie of categories) {
    const metier = categorie.metiers.find((m) => m.id === metierId);
    if (metier) {
      return {
        categorieId: categorie.id,
        categorieLabel: categorie.libelle,
        metierId: metier.id,
        metierLabel: metier.libelle,
        competences,
        secteurLabel: secteurLabelOf(categorie),
        secteur: categorie.secteur,
        allowsOprVerification: categorie.allowsOprVerification === true,
      };
    }
  }
  return null;
}

function TaxonomyCascadeImpl({
  value,
  onChange,
  inputClass,
  labelClass,
  competencesLabel = "Compétences recherchées",
  maxCompetences = MAX_COMPETENCES,
  onCatalogueCompetences,
  onMetierRisk,
  afterSecteur,
  onSecteurChange,
}: {
  value: TaxonomySelection;
  onChange: (next: TaxonomySelection) => void;
  inputClass: string;
  labelClass: string;
  // Libellés paramétrables (2026-09-23) : le profil prestataire DÉCLARE ses compétences, il
  // n'en « recherche » pas — le même composant servait les deux écrans avec le vocabulaire de
  // la mission. Le plafond l'est aussi : 5 pour une mission (au-delà, le rapprochement
  // `hasSome` ne discrimine plus), 10 pour un profil (modele-skillafrica §5).
  competencesLabel?: string;
  maxCompetences?: number;
  // Liste des compétences DU MÉTIER, remontée à l'appelant (2026-09-23) : le formulaire
  // prestataire accepte aussi des compétences ajoutées à la main, et il n'a aucun autre moyen
  // de savoir lesquelles viennent du catalogue — sans quoi il ne pourrait pas n'afficher que
  // les ajouts. Le callback est lu via une ref : une fonction recréée à chaque rendu par
  // l'appelant ferait boucler l'effet ci-dessous.
  onCatalogueCompetences?: (libelles: string[]) => void;
  // Palier de risque du métier sélectionné (2026-09-24), remonté pour la même raison : le
  // formulaire prestataire doit annoncer la conséquence du choix AU MOMENT où il est fait.
  // `null` = aucun métier choisi. Même précaution de ref que ci-dessus.
  onMetierRisk?: (risk: RiskLevelValue | null) => void;
  // Champ intercalé APRÈS le secteur (2026-10-06) : le formulaire de mission demande le type
  // de professionnel entre le secteur et la catégorie. Fourni, il réorganise la cascade en
  // deux rangées (Secteur | champ intercalé, puis Catégorie | Métier) ; absent, la cascade
  // garde sa rangée unique (profil prestataire).
  afterSecteur?: React.ReactNode;
  // Secteur choisi dans le filtre (`null` = tous / autres), remonté pour filtrer le champ
  // intercalé AVANT qu'une catégorie soit choisie. Même précaution de ref que ci-dessus.
  onSecteurChange?: (secteur: string | null) => void;
}) {
  const [categories, setCategories] = useState<TaxonomyCategorie[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState(false);
  const [services, setServices] = useState<TaxonomyService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);

  const inFlight = useRef<AbortController | null>(null);
  const [secteurFilter, setSecteurFilter] = useState(SECTEUR_ALL);

  useEffect(() => {
    let cancelled = false;
    loadTree()
      .then((categories) => {
        if (cancelled) return;
        setCategories(categories);
      })
      .catch(() => {
        if (!cancelled) setTreeError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadServices = useCallback(async (metierId: string) => {
    // Déjà en cache : aucune requête, aucun état de chargement qui clignote.
    const cached = serviceCache.get(metierId);
    if (cached) {
      setServices(cached);
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoadingServices(true);
    try {
      const res = await fetch(`/api/taxonomy?metierId=${encodeURIComponent(metierId)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("services");
      const data = await res.json();
      serviceCache.set(metierId, data.services ?? []);
      // La réponse d'une requête annulée entre-temps ne doit pas écraser l'affichage.
      if (!controller.signal.aborted) setServices(data.services ?? []);
    } catch {
      if (!controller.signal.aborted) setServices([]);
    } finally {
      if (!controller.signal.aborted) setLoadingServices(false);
    }
  }, []);

  // Options du filtre : seulement les secteurs qui ont au moins une catégorie, dans l'ordre du
  // référentiel, puis « Autres ». Aucune catégorie classée → pas de filtre du tout : un menu
  // qui ne propose que « Tous » n'aide personne.
  const secteurOptions = useMemo(() => {
    const present = new Set(categories.map((c) => secteurKey(c)));
    const options = SECTEURS.filter((s) => present.has(s.value)).map((s) => ({ value: s.value as string, label: s.label }));
    if (options.length === 0) return [];
    if (present.has(SECTEUR_OTHERS)) options.push({ value: SECTEUR_OTHERS, label: "Autres" });
    return options;
  }, [categories]);

  // La catégorie déjà choisie reste listée même si le filtre ne la couvre pas (sélection
  // restituée d'un brouillon ou d'un profil) : un <select> dont la valeur n'est pas parmi ses
  // options s'affiche vide, et le choix paraîtrait perdu.
  const visibleCategories = useMemo(
    () =>
      secteurFilter === SECTEUR_ALL
        ? categories
        : categories.filter((c) => secteurKey(c) === secteurFilter || c.id === value.categorieId),
    [categories, secteurFilter, value.categorieId],
  );

  const metiers = useMemo(
    () => categories.find((c) => c.id === value.categorieId)?.metiers ?? [],
    [categories, value.categorieId],
  );

  // ── Le SEUL endroit qui charge les compétences (2026-09-23) ──────────────────────────────
  //
  // Cette liste n'était demandée qu'au CLIC sur un métier. Quand la sélection vient d'ailleurs
  // — le métier enregistré du profil prestataire, restitué au chargement — la requête n'était
  // jamais lancée : l'écran annonçait « 3 / 10 » au-dessus d'une zone VIDE, sans les puces pour
  // lire ni corriger ce que le profil contenait déjà. La dépendance au métier, et non au geste
  // qui l'a choisi, fait suivre au clic et à la restitution le même chemin.
  useEffect(() => {
    if (value.metierId) void loadServices(value.metierId);
    else setServices([]);
  }, [value.metierId, loadServices]);

  const notifyCatalogue = useRef(onCatalogueCompetences);
  notifyCatalogue.current = onCatalogueCompetences;
  useEffect(() => {
    notifyCatalogue.current?.(services.map((s) => s.libelle));
  }, [services]);

  // Le palier suit le MÉTIER, pas le geste : il est donc lu dans la liste des métiers à partir de
  // l'identifiant sélectionné. Un métier restitué depuis le profil est ainsi couvert au même titre
  // qu'un métier cliqué, et le palier reste juste tant que l'arbre n'est pas chargé (null).
  const selectedRisk = metiers.find((m) => m.id === value.metierId)?.riskLevel ?? null;
  const notifyRisk = useRef(onMetierRisk);
  notifyRisk.current = onMetierRisk;
  useEffect(() => {
    notifyRisk.current?.(selectedRisk);
  }, [selectedRisk]);

  const notifySecteur = useRef(onSecteurChange);
  notifySecteur.current = onSecteurChange;

  function handleSecteur(next: string) {
    setSecteurFilter(next);
    notifySecteur.current?.(next === SECTEUR_ALL || next === SECTEUR_OTHERS ? null : next);
    // Un secteur qui ne couvre plus la catégorie choisie la désélectionne, avec son métier et
    // ses compétences — comme changer de catégorie invalide le métier.
    const current = categories.find((c) => c.id === value.categorieId);
    if (current && next !== SECTEUR_ALL && secteurKey(current) !== next) {
      onChange({ categorieId: "", categorieLabel: "", metierId: "", metierLabel: "", competences: [], secteurLabel: "", secteur: null, allowsOprVerification: false });
    }
  }

  function handleCategorie(categorieId: string) {
    // Changer de catégorie invalide le métier ET les compétences : garder une compétence
    // d'un autre métier produirait une mission catégorisée de façon incohérente.
    const categorie = categories.find((c) => c.id === categorieId);
    onChange({
      categorieId,
      categorieLabel: categorie?.libelle ?? "",
      metierId: "",
      metierLabel: "",
      competences: [],
      secteurLabel: secteurLabelOf(categorie),
      secteur: categorie?.secteur ?? null,
      allowsOprVerification: categorie?.allowsOprVerification === true,
    });
  }

  function handleMetier(metierId: string) {
    const label = metiers.find((m) => m.id === metierId)?.libelle ?? "";
    onChange({ ...value, metierId, metierLabel: label, competences: [] });
  }

  function toggleCompetence(libelle: string) {
    const selected = value.competences.includes(libelle);
    if (!selected && value.competences.length >= maxCompetences) return;
    onChange({
      ...value,
      competences: selected
        ? value.competences.filter((c) => c !== libelle)
        : [...value.competences, libelle],
    });
  }

  const atLimit = value.competences.length >= maxCompetences;

  if (treeError) {
    return (
      <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-800">
        Le catalogue des métiers n&apos;a pas pu être chargé. Rechargez la page pour réessayer.
      </div>
    );
  }

  const secteurField = secteurOptions.length > 0 && (
    <div>
      <label htmlFor="secteurFilter" className={labelClass}>
        Secteur
      </label>
      <select
        id="secteurFilter"
        value={secteurFilter}
        onChange={(e) => handleSecteur(e.target.value)}
        disabled={loadingTree}
        className={inputClass}
      >
        <option value={SECTEUR_ALL}>Tous les secteurs</option>
        {secteurOptions.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-zinc-400 mt-1">Grande famille du besoin — filtre les catégories.</p>
    </div>
  );
  const categorieField = (
    <div>
      <label htmlFor="categorieId" className={labelClass}>
        Catégorie <span className="text-[#E8112D]">*</span>
      </label>
      <select
        id="categorieId"
        value={value.categorieId}
        onChange={(e) => handleCategorie(e.target.value)}
        disabled={loadingTree}
        required
        className={inputClass}
      >
        <option value="">{loadingTree ? "Chargement..." : "Sélectionner une catégorie"}</option>
        {visibleCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon ? `${c.icon} ` : ""}
            {c.libelle}
          </option>
        ))}
      </select>
    </div>
  );
  const metierField = (
    <div>
      <label htmlFor="metierId" className={labelClass}>
        Métier <span className="text-[#E8112D]">*</span>
      </label>
      <select
        id="metierId"
        value={value.metierId}
        onChange={(e) => handleMetier(e.target.value)}
        disabled={!value.categorieId}
        required
        className={`${inputClass} disabled:bg-zinc-50 disabled:text-zinc-400`}
      >
        <option value="">{value.categorieId ? "Sélectionner un métier" : "Choisissez d'abord une catégorie"}</option>
        {metiers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.libelle}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      {afterSecteur !== undefined ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {secteurField}
            {afterSecteur}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {categorieField}
            {metierField}
          </div>
        </>
      ) : (
        <div className={`grid gap-4 ${secteurOptions.length > 0 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {secteurField}
          {categorieField}
          {metierField}
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className={`${labelClass} mb-0`}>{competencesLabel} <span className="text-[#E8112D]">*</span></span>
          <span className={`text-[11px] ${atLimit ? "text-[#FF7A00] font-semibold" : "text-zinc-400"}`}>
            {value.competences.length} / {maxCompetences}
          </span>
        </div>

        {!value.metierId ? (
          <p className="text-[12px] text-zinc-400 px-3 py-2.5 rounded-xl border border-dashed border-zinc-200">
            Choisissez un métier pour voir ses compétences.
          </p>
        ) : loadingServices ? (
          <div className="flex flex-wrap gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 w-28 rounded-full bg-zinc-100 animate-pulse" />
            ))}
          </div>
        ) : services.length === 0 ? (
          // Ni puces ni explication laisserait l'utilisateur devant un blanc, à côté d'un
          // compteur qui, lui, affiche un nombre. Un métier sans compétence listée (ou une
          // coupure réseau) doit se lire, pas se deviner.
          <p className="text-[12px] text-zinc-400 px-3 py-2.5 rounded-xl border border-dashed border-zinc-200">
            Aucune compétence n&apos;est listée pour ce métier. Vos compétences déjà enregistrées sont
            conservées telles quelles.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const selected = value.competences.includes(s.libelle);
              // Une compétence non retenue est désactivée une fois le plafond atteint : le
              // clic sans effet est plus déroutant qu'un bouton visiblement indisponible.
              const blocked = !selected && atLimit;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleCompetence(s.libelle)}
                  disabled={blocked}
                  aria-pressed={selected}
                  title={s.description ?? undefined}
                  className={`h-9 px-4 rounded-full text-[13px] font-medium border transition ${
                    selected
                      ? "bg-[#008751] border-[#008751] text-white"
                      : blocked
                        ? "bg-white border-zinc-100 text-zinc-300 cursor-not-allowed"
                        : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {s.libelle}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Mémoïsé : voir le point 5 des optimisations en tête de fichier.
export const TaxonomyCascade = memo(TaxonomyCascadeImpl);
