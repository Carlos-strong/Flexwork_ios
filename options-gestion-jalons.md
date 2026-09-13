# Options de gestion des jalons — référence

Documente les options activables par le **client** en réponse aux règles §18.4 et §18.8/18.9
du modèle multi-jalons. Complète le fractionnement en jalons déjà existant (2026-08-06).

Toutes ces options sont **figées à la génération du contrat**, comme le sont déjà les
montants des jalons eux-mêmes : aucune route ne permet de les changer après coup sur un
contrat déjà généré (`termsSnapshot.jalons`/`financingMode`/`jalonsSequential` sont immuables,
au même titre que le reste du snapshot).

> **⚠️ Mise à jour 2026-09-10 — ces trois options ne se choisissent plus une par une.**
>
> Le client choisit désormais un **mode de financement** à la **publication** de la mission
> (`Mission.financingModeKey`, catalogue dans `src/lib/financing-modes.ts`), et c'est le mode
> qui fixe les trois leviers ci-dessous. Deux raisons :
>
> 1. **Le moment.** Le mode dit au prestataire *comment chiffrer* : un mode à jalons attend un
>    devis découpé en postes livrables un à un, un mode forfaitaire attend un prix unique.
>    L'annoncer à la génération du contrat — après négociation, après acceptation — arrivait
>    trop tard, le devis était déjà écrit sous une autre hypothèse.
> 2. **Le devis EST la décomposition en jalons.** Les lignes de `DevisData.lineItems`
>    (`# | Description | Qté | PU HT | Montant | Échéance`) sont les jalons. Elles sont
>    désormais **dérivées** en `Jalon[]` par `resolveFinancing()`, jamais resaisies à la main.
>    Les montants sont proratisés au prix du contrat (les lignes somment au HT hors main
>    d'œuvre, le contrat séquestre le TTC) et la dernière part absorbe le reliquat d'arrondi,
>    de sorte que `validateJalonsSum` est exact par construction.
>
> La saisie manuelle décrite plus bas subsiste en **chemin de repli** : missions publiées avant
> cette date, et missions à prix fixe sans devis à dériver (`devis_required` — dans ce cas le
> *régime* du mode s'applique quand même, seul le découpage vient du formulaire).
>
> Voir la section 6 pour le catalogue et le point d'entrée API.

## 1. Les trois options

| Option | Valeurs | Défaut | Champ contrat | Payload API |
|---|---|---|---|---|
| Fractionnement en jalons | oui / non | non | `Jalon[]` (relation) | `jalons: [{ titre, montant }, ...]` |
| Financement progressif (§18.4) | `lump_sum` / `progressive` | `lump_sum` | `PrestationContract.financingMode` | `financingMode: "progressive"` |
| Jalons séquentiels (§18.8/18.9) | oui / non | non | `PrestationContract.jalonsSequential` | `jalonsSequential: true` |

Dépendances :
- `jalonsSequential` n'a d'effet que si `jalons` est renseigné (ignoré silencieusement sinon).
- `financingMode` s'applique **avec ou sans** jalons — indépendant du fractionnement.

### Financement progressif — mécanique

- Mode `lump_sum` (historique) : `POST .../checkpoint` ne fait que tracer la progression
  constatée (`ProgressCheckpoint`) — aucun mouvement d'argent. Seul `POST .../validate` /
  `POST .../escrow/release`, à `observedProgress === 100`, transmet un RELEASE pour le montant
  plein.
- Mode `progressive` : **chaque** confirmation d'un palier plus élevé (`POST .../checkpoint`)
  déclenche en plus un RELEASE partiel :
  ```
  montant_libéré = montant_jalon × (nouveau_palier − palier_précédent) / 100
  ```
  (`progressiveReleaseIncrement`, `src/lib/jalons.ts`). `POST .../validate` reste l'action de
  clôture formelle mais ne transmet alors que le **solde restant**
  (`remainingReleasableAmount`), jamais le montant plein une seconde fois. Si les checkpoints
  ont déjà tout libéré, `/validate` (et `/escrow/release` sans jalon) répond de façon
  idempotente (`alreadyFullyReleased: true`) plutôt que de renvoyer une erreur.
- Garde-fou côté webhook (`src/lib/psp-webhook.ts`, `isFullyReleased`) : un jalon (ou une
  mission sans jalon) ne passe `libere`/`cloturee` que lorsque le **cumul confirmé** des
  RELEASE atteint le montant dû — jamais sur un simple palier intermédiaire, même en mode
  progressif à plusieurs confirmations successives.

### Jalons séquentiels — mécanique

- `canHoldJalonSequential` (`src/lib/jalons.ts`) : un jalon ne peut être financé (HOLD) que si
  tous les jalons d'ordre inférieur sont au moins `valide` (le client a validé — pas besoin
  d'attendre la confirmation PSP asynchrone du RELEASE précédent).
- Seul point de contrôle modifié : `POST .../jalons/[jalonId]/hold`. Rien en aval (soumission,
  checkpoint, validation) n'est jamais atteignable tant qu'un jalon reste bloqué à
  `en_attente` — pas besoin de dupliquer la garde ailleurs.
- UI prestataire (`deliverable/page.tsx`) : un jalon verrouillé affiche
  « Verrouillé — en attente de la validation du jalon précédent » au lieu de « Non démarré ».

## 2. Les 8 combinaisons possibles

| Jalons | Séquentiel | Financement | Comportement résultant |
|---|---|---|---|
| Non | — | `lump_sum` | Historique inchangé : 1 HOLD, 1 RELEASE à 100% du prix total |
| Non | — | `progressive` | 1 HOLD ; chaque checkpoint libère sa part du prix total ; clôture automatique une fois 100% atteint |
| Oui | Non | `lump_sum` | Jalons finançables dans n'importe quel ordre ; chacun payé en un bloc à 100% |
| Oui | Non | `progressive` | Jalons finançables dans n'importe quel ordre ; chacun payé au fil de ses propres checkpoints |
| Oui | Oui | `lump_sum` | Jalon N+1 verrouillé tant que jalon N n'est pas `valide` ; chaque jalon payé en un bloc |
| Oui | Oui | `progressive` | Jalon N+1 verrouillé tant que jalon N n'est pas `valide` ; chaque jalon payé au fil de l'eau |

## 3. Comparaison avec les options déjà existantes

| Option | Qui décide | Mécanique |
|---|---|---|
| Pointage GPS (check-in) | Client **et** prestataire (double consentement) | `clientOptedInCheckIn` + `providerOptedInCheckIn`, actif seulement si les deux ont consenti (`isCheckInToolActive`) |
| Assurance mission à risque élevé | Système (dérivé de `riskLevel`) | Bloque le HOLD si aucune couverture active |
| Médiation facultative | Toujours activée par défaut | `clauseMediationFacultative: true` dans le contrat |
| Fractionnement / progressif / séquentiel | Client seul | Choisis au même moment que les jalons, gelés dans le contrat |

Contrairement au check-in (double opt-in obligatoire), les trois options de jalons ne
dépendent que du client — cohérent avec le fait qu'il définit déjà seul les montants des
jalons aujourd'hui.

## 4. Fichiers clés

| Fichier | Rôle |
|---|---|
| `prisma/schema.prisma` | `enum FinancingMode`, `PrestationContract.financingMode`/`.jalonsSequential` |
| `src/lib/jalons.ts` | `progressiveReleaseIncrement`, `remainingReleasableAmount`, `canHoldJalonSequential`, `weightedJalonsProgress` (§18.14) |
| `src/lib/psp-webhook.ts` | `isFullyReleased`, `closeJalonFullyReleased` — clôture uniquement au cumul complet |
| `src/app/api/missions/[id]/contract/route.ts` | Accepte et gèle `financingMode`/`jalonsSequential` |
| `src/app/api/missions/[id]/jalons/[jalonId]/hold/route.ts` | Garde séquentielle |
| `src/app/api/missions/[id]/jalons/[jalonId]/checkpoint/route.ts`, `src/app/api/missions/[id]/checkpoint/route.ts` | RELEASE partiel en mode progressif |
| `src/app/api/missions/[id]/jalons/[jalonId]/validate/route.ts`, `src/app/api/missions/[id]/escrow/release/route.ts` | Solde restant, réponse idempotente si déjà tout libéré |
| `src/lib/financing-modes.ts` | Catalogue des modes, `deriveJalons`/`resolveFinancing`, `distributeExact` |
| `src/lib/escrow.ts` | `totalReleasedAmount` — cumule les RELEASE `pending` **et** `confirmed` (§18.3) |
| `src/app/missions/new/page.tsx` | UI — choix du mode à la publication |
| `src/components/financing/financing-mode-notice.tsx` | UI — consigne de chiffrage côté prestataire (`providerBrief`) |
| `src/app/missions/[id]/contract/page.tsx` | UI — récapitulatif dérivé, ou cases à cocher (repli) |
| `src/lib/progressive-release.e2e.test.ts` | E2E du chemin monétaire, en mode console (sans autoconfirm) |
| `src/app/missions/[id]/deliverable/page.tsx` | UI — libellé « Verrouillé » côté prestataire |

## 5. Limitation connue

`src/app/api/admin/mediations/[id]/respond/route.ts` (résolution de litige par un admin) libère
toujours `mission.budget` en bloc, sans tenir compte de `financingMode` ni des jalons — chemin
de dispute distinct, non couvert par cette implémentation.

## 6. Modes de financement (2026-09-10)

Catalogue : `src/lib/financing-modes.ts`. Chaque mode se ramène **obligatoirement** à une
combinaison des trois leviers du §1 — c'est ce qui garantit qu'ajouter un mode n'introduit
jamais un chemin de paiement parallèle.

| Clé | Mode | Jalons | Financement | Séquentiel | Dérivation des jalons |
|---|---|---|---|---|---|
| F2 | Fixe 100 % escrow upfront | non | `lump_sum` | — | aucune |
| F3 | Fixe 50/50 | oui | `lump_sum` | oui | 2 moitiés, indépendantes du devis |
| J1 | Jalons pondérés au coût réel | oui | `lump_sum` | non | 1 ligne de devis = 1 jalon, proratisée |
| J2 | Jalons égaux | oui | `lump_sum` | non | autant de jalons que de lignes, montants égaux |
| J3 | Jalons + progression cumulée | oui | `progressive` | non | 1 ligne de devis = 1 jalon, proratisée |

Modes **décrits mais indisponibles** (présents au catalogue avec leur motif, refusés à la
publication) : **F1** (refus structurel — aucun livrable n'est soumissible avant séquestre),
**F4** (exige `Jalon.dueDate` + un déclencheur calendaire), **J4** (retenue de garantie),
**J5** (bonus/malus — ferait varier un montant après signature).

### Points d'entrée

| Route | Rôle |
|---|---|
| `GET /api/financing-modes` | Catalogue complet (disponibles **et** indisponibles motivés) |
| `POST /api/missions` | Le mode est choisi ici, à la publication (`financingModeKey`) |
| `GET /api/missions/[id]/financing-mode` | Mode courant + **aperçu exact** des jalons dérivés |
| `PATCH /api/missions/[id]/financing-mode` | Change le mode — refusé (`financing_mode_locked`) dès qu'un contrat existe |
| `POST /api/missions/[id]/contract` | Dérive et fige ; `termsSnapshot.financingModeKey` garde le régime signé |

L'aperçu du `GET` et la création du contrat passent par **la même** fonction
(`resolveFinancing`) : ce que le client voit avant de générer est exactement ce qui sera créé.

### Côté prestataire — la consigne de chiffrage

Déplacer le choix du mode à la publication n'a de sens que si le prestataire le voit **avant
de chiffrer** : c'est toute la justification du déplacement (point 1 de l'encadré en tête de
document). `providerBrief(mode, { quoteMode })` (`src/lib/financing-modes.ts`) traduit le mode
en une consigne — ce qu'il faut chiffrer, et ce qui déclenchera les libérations.

Le texte est **dérivé** de `jalonStrategy` + `primitives`, jamais écrit mode par mode : un mode
ajouté au catalogue hérite de la bonne consigne, et aucun libellé ne peut se désynchroniser du
comportement réel de `deriveJalons`.

| Surface | Fichier | Ce qui s'affiche |
|---|---|---|
| Formulaire de devis (mode QUOTE) | `src/app/missions/[id]/devis/page.tsx` | Consigne complète, juste au-dessus du tableau des lignes |
| Détail mission — panneau devis | `src/app/missions/[id]/page.tsx` | Consigne complète |
| Détail mission — candidature à prix fixe | `src/app/missions/[id]/page.tsx` | Consigne en `quoteMode={false}` |
| Détail mission — conditions | `src/app/missions/[id]/page.tsx` | Ligne « Financement : <label> », visible aussi du client |

Composant de rendu : `src/components/financing/financing-mode-notice.tsx` (purement présentatif).

Deux garde-fous portés par la dérivation :
- **Hors mode devis**, `deriveJalons` répond `devis_required` et le découpage vient du client à
  la génération du contrat : la consigne dit alors « chiffrez un montant global » au lieu de
  promettre « une ligne = un jalon », découpage que le montant unique saisi ne déciderait pas.
- **Mission publiée avant l'introduction des modes** (`financingModeKey` nul) : rien ne
  s'affiche, plutôt qu'un régime par défaut que le contrat ne suivrait pas.
