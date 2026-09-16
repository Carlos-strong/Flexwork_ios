# Diagnostic financier — avant implémentation Spot / moteur unifié

> Produit en réponse au §2 du prompt maître de `financement.md` (« Produire d'abord un
> diagnostic technique court […] puis implémenter »).
>
> Date : 2026-09-14 · Branche : `fix/workflow-escrow-jalons`
> Périmètre audité : `src/lib/escrow.ts`, `src/lib/jalons.ts`, `src/lib/financing-modes.ts`,
> `src/lib/psp-webhook.ts`, `src/lib/deliverable-actions.ts`, `prisma/schema.prisma`,
> routes `api/missions/*`, `api/gigs/*`, `api/admin/mediations/*`, `api/cron/*`.

---

## 0. Résumé exécutif

Le socle financier existant est **nettement plus mûr** que ne le suppose `financement.md` :
`PspEscrowOperation` est déjà un journal de mouvements immuables, les libérations sont
sérialisées sous `SELECT … FOR UPDATE`, et l'idempotence webhook est correctement gardée par un
état terminal. Les modes J1/J3/J4 sont complets et testés.

Deux défauts **antérieurs au projet Spot** dominent néanmoins le diagnostic, et aucun des deux
n'est mentionné par le cahier des charges :

| | Constat | Impact |
|---|---|---|
| **P0-1** | Le « deuxième moteur financier » que le document interdit de créer **existe déjà** (`GigOrderEscrowOperation`), et il n'émet aucune libération : un gig livré ne paie jamais le prestataire. | Fonds bloqués sans issue |
| **P0-2** | Aucun chemin de remboursement n'existe pour un contrat de mission. | Soldes orphelins |

S'y ajoute un écart entre le contrat et le code : **l'acceptation tacite est promise en quatre
endroits et appliquée nulle part** (P1).

Conclusion : **corriger l'existant avant d'ajouter S1/S2**, sous peine de construire un
troisième moteur sur un socle défaillant.

---

## 1. Ce que le document ignore (constats P0/P1)

### P0-1 — Le second moteur financier existe déjà, et il ne paie personne

`GigOrderEscrowOperation` est une table parallèle à `PspEscrowOperation` : mêmes colonnes,
mêmes enums (`EscrowInstructionType`, `PspOperationStatus`), **aucun code partagé**. Elle n'est
écrite qu'à deux endroits : `api/gigs/orders/[orderId]/sign/route.ts:87` et
`src/lib/gig-expiry.ts:55`.

Le moteur gig est incomplet :

- il n'émet que `hold` et `refund` — **aucune instruction `release` n'existe dans tout le
  domaine gig** (la seule du dépôt est dans `src/lib/escrow.ts`, qui n'écrit que
  `PspEscrowOperation`) ;
- `GigOrderStatus.completed` est déclaré (« livraison validée / clôturée ») mais **aucune ligne
  de code ne l'écrit jamais**.

**Conséquence** : un gig payé et livré laisse les fonds séquestrés définitivement. Le seul
mouvement sortant possible est un remboursement au client.

### P0-2 — Aucun remboursement possible sur un contrat de mission

`instructionType: "refund"` n'est émis que par `gig-expiry.ts:61`. Une mission interrompue,
abandonnée, ou close avec un reliquat (médiation partielle, jalon annulé après HOLD) laisse un
solde qu'aucune instruction ne vient chercher. `heldBalance` le voit ; personne ne le récupère.
C'est exactement ce que le §18 du document interdit (« ne jamais laisser un solde orphelin »).

### P1 — Acceptation tacite promise, jamais appliquée

`acceptanceDeadlineDays` (défaut 7) est stocké et affiché, jamais appliqué. La promesse figure
dans :

- `src/lib/contract-clauses.ts:208` — « le jalon est réputé accepté et son paiement est
  **déclenché automatiquement** » ;
- `src/app/missions/[id]/escrow/page.tsx:168` ;
- `src/app/(public)/cgu/page.tsx:21` ;
- `src/app/(public)/comment-ca-marche/page.tsx:10`.

`src/lib/checkin-tool.ts:7` aligne même son délai de contestation « sur le délai d'acceptation
tacite » — sur une règle inexistante.

L'infrastructure cron existe (`contract-expirations`, `devis-expirations`,
`gig-order-expirations`) ; il manque une quatrième route.

### P1 — Conflit de gouvernance A12 vs pointage opposable

`CheckInEvent` ressemble au module de pointage demandé (§8), mais `src/lib/checkin-tool.ts:1`
porte une interdiction explicite :

> AUCUNE fonction de ce fichier ne doit jamais alimenter un score, un classement, une
> visibilité, une **pénalité** ou une **décision de litige** — règle A12. Si un futur besoin
> apparaît, c'est un signal que la fonctionnalité bascule du service vers le contrôle :
> **refuser**.

S2 demande l'inverse : un pointage opposable qui calcule une rémunération et tranche un litige.
Trois incompatibilités de fond :

1. **Consentement** — `isCheckInToolActive` exige l'accord des deux parties ; un pointage qui
   conditionne le salaire ne peut pas être optionnel ;
2. **Rétention** — purge à fin de mission + 7 j ; une pièce de paie se conserve des années ;
3. **Statuts** — ni `SUBMITTED`/`APPROVED`/`DISPUTED`, ni validateur, ni historique de
   correction.

**`Attendance` doit être un module distinct de `CheckInEvent`.** C'est une décision produit et
juridique, pas technique.

---

## 2. Comparaison section par section (`financement.md` §2, prompt maître)

| | Sections | Nb |
|---|---|---|
| Déjà satisfait | §15, §16, §17, §20, §23, §25 | 6 |
| Partiel | §1, §2, §3, §13, §14, §21, §22, §24 | 8 |
| Inexistant | §4, §5, §6, §7, §8, §9, §10, §11, §12, §18 | 10 |
| Écart promesse/code | §19 | 1 |

### §1 — Invariants financiers

| Invariant | État |
|---|---|
| 1. `paidAmount <= fundedAmount` | Dérivé, non vérifié |
| 2. `releasedAmount <= escrowFundedAmount` | Dérivé, non vérifié |
| 3. `refundedAmount <= funded − released − blocked` | Absent (pas de remboursement) |
| 4. `payableAmount <= availableEscrowAmount` | **Seulement sur le chemin médiation** |
| 5. Pas de payout sans payable | Absent (pas de payable) |
| 6. Pas de double exécution | OK — `emitScopedRelease` sous `FOR UPDATE` |
| 7. Pas de double crédit webhook | OK — garde d'état terminal |
| 8. Litigieux reste séquestré | OK — `freeze` neutre dans `heldBalance` |
| 9. Retenues restent séquestrées | OK — J4 complet |
| 10. Solde résiduel remboursable | Absent |

Le point dur est l'**invariant 4** : `emitScopedRelease` (`escrow.ts:217`) plafonne par le
montant **contractuel** de la portée (`jalon.montant`, retenue déduite), jamais par
`heldBalance`. Seul `emitMediationRelease` borne par le solde réel. Les deux coïncident en
pratique parce que `canSubmitJalonDeliverable` exige `fonds_sous_sequestre` — mais c'est une
garantie **dérivée d'un statut**, pas un contrôle de solde. C'est précisément ce que le document
refuse : « Ne jamais utiliser le budget contractuel comme substitut du solde réellement
séquestré. »

### §3 — Ledger

Plus avancé que supposé. `PspEscrowOperation` est un journal immuable ; les soldes sont
**dérivés**, jamais stockés (`heldBalance` = `hold − tout ce qui sort`, `freeze` neutre).

| Mouvement demandé | Existant |
|---|---|
| `ESCROW_FUNDING` | `hold` |
| `ESCROW_RELEASE` / `ESCROW_PAYMENT` | `release` (fusionnés) |
| `ESCROW_REFUND` | `refund` — enum présent, **jamais émis côté contrat** |
| `ESCROW_RETENTION_HOLD` | Implicite (calculé, pas de ligne) |
| `ESCROW_RETENTION_RELEASE` | `retention_release` |
| `ESCROW_DISPUTE_HOLD` | `freeze` |
| `ESCROW_ADJUSTMENT` | Absent |

Manquent les 4 notions de solde : `available`, `blocked`, `disputed`, `retained`.

### §4 — Payable

**Inexistant.** La validation métier émet **directement** l'instruction PSP
(`handleValidate` → `emitScopedRelease` → ligne PSP). Pas d'étape « somme autorisée mais pas
encore payée ». C'est la pièce dont l'absence bloque tout le reste : sous-tâches S1, pointages
S2, recharge, litige partiel.

### §5 — S1 Spot forfait

Le mode n'existe pas, mais **`GigOrder` est S1 variante « paiement unique »** : achat direct,
`termsSnapshot` immuable, double signature, séquestre, audit chaîné. Voir P0-1.

La variante « sous-tâches » (`SpotTask`) est fonctionnellement **identique à J1** : découper un
montant financé une seule fois en lots validables indépendamment. `distributeExact`,
`validateJalonsSum` et `emitScopedRelease` s'appliqueraient tels quels.

### §6–§12 — S2 et pointage

Inexistants intégralement. Ni `rateUnit`, ni `settlementFrequency`, ni plafonds, ni
`overtimeRate`, ni `Worksite`/`Attendance`. Le rôle **responsable chantier** n'existe pas dans
le modèle utilisateur.

Note : `FinancingModeKey` est une union fermée de 9 clés, verrouillée par le test « le catalogue
proposé est exactement F2, J1, J3, J4 ». Ajouter S1/S2 impose de toucher ce type, la migration
`financingModeKey` et ce test.

### §13 — Recharge

Le manque est détectable (`heldBalance`), l'action ne l'est pas : `hasInFlightHold`
(`escrow.ts:197`) refuse tout HOLD supplémentaire sur la même portée. Ni erreur
`ESCROW_INSUFFICIENT`, ni notification client.

### §14 — Litiges

`freeze` gèle correctement, la médiation est complète (US-603). Manque le **litige partiel** :
aujourd'hui on gèle tout ou rien. Le scénario « 4 jours payables + 2 litigieux » suppose §4.

### §15 — J4 retenue

**Conforme et supérieur à la demande.** Retenue séquestrée, jamais comptée comme payée, libérée
une seule fois, idempotence sous `FOR UPDATE`, `instructionType` dédié (`retention_release`) —
`schema.prisma:978` explique pourquoi ce n'est pas un `release` scopé contrat (collision avec la
médiation). `totalRetentionAmount` somme jalon par jalon pour éviter tout résidu.

Seul écart : taux figé à 5 %, non 5–10 %.

### §16 — Idempotence PSP

Solide : `pspReference @unique`, état terminal (`pending` → `confirmed`|`failed`), rejeu du même
dénouement sans écriture, `operation_already_settled` sinon.

Manque : clé d'idempotence **technique** (`release_<uuid>`) et non **métier**
(`contractId + payableId`). Impossible sans payable.

### §17 — Transactions

Conforme. `$transaction` + `SELECT … FOR UPDATE` sur la ligne du contrat,
`maxWait: 10s / timeout: 20s`, confirmation PSP **hors** transaction. Les commentaires
documentent les race conditions réellement constatées et corrigées.

Manquent les tests de concurrence.

### §19 — Acceptation tacite

Voir P1 ci-dessus. Le document propose A (implémenter) ou B (retirer la promesse) : **A**, sans
hésiter — clause contractuelle opposable, et le chemin technique est un quatrième cron sur un
modèle déjà éprouvé.

### §20 — Médiation

**Déjà corrigé** (2026-09-11) — le document est en retard. `resolutionAmount` borné par
`heldBalance`, clôture sur refus (`no_agreement`), retour au `previousStatus`.

Reste ouvert, documenté dans le code : pas d'instruction inverse du `freeze` (dégel).

### §22 — Frontend

| Écran demandé | État |
|---|---|
| Client — financement séquestre | OK |
| Client — solde / consommé / restant | Absent |
| Client — payables, litiges, recharge | Absent |
| Prestataire — gagné / en attente / payé | Partiel (`WalletSection`) |
| Responsable chantier | Absent (rôle inexistant) |
| Admin — escrow, mouvements, PSP, audits | Partiel |

### §23 — Audit trail

**Dépasse la demande.** `ContractAuditEntry` / `GigOrderAuditEntry` sont **chaînés par hash**
(`previousHash` / `currentHash @unique`) avec `systemSignature` — chaîne inviolable, pas simple
journal. Manquent `ancienne valeur` / `nouvelle valeur` explicites et l'IP/session.

### §24 — Tests

6 des 23 tests demandés couverts. Les e2e financiers existants sont sérieux :
`autoconfirm-release`, `progressive-release`, `retention-guards`, `retention-release`,
`deliverable-scope-parity`. Manquent les 5 tests de concurrence et l'assertion d'invariant
global.

### §25 — Migration

Tenable : `PspEscrowOperation` est additif par nature, `financingModeKey` déjà nullable avec
repli documenté. Aucun champ à renommer.

---

## 3. Modèle de données (`financement.md` §3)

| Concept demandé | Existant |
|---|---|
| `EscrowAccount` / `EscrowBalance` | Dérivé, pas d'entité |
| `EscrowTransaction` / `LedgerEntry` | `PspEscrowOperation` |
| `PaymentObligation` / `Payable` | Absent |
| `SpotTask` | Absent |
| `SpotTimeContract` | Absent |
| `Worksite` | Absent |
| `Attendance` / `Timesheet` | Absent (`CheckInEvent` inutilisable — voir P1/A12) |
| `PaymentInstruction` | `PspEscrowOperation` |
| `RefundInstruction` | Enum seul |
| `DisputeFinancialHold` | `freeze` |

---

## 4. Cohérence des arrondis (§6 point 22) — non conforme

Deux conventions se rencontrent :

- `devis.ts:104` et `financing-modes.ts:255` arrondissent **au centime** ;
- `jalons.ts:115` (`progressiveReleaseTarget`) et `jalons.ts:143` (`retentionAmount`)
  arrondissent **à l'unité**.

`distributeExact` peut donc produire un jalon à `1200.33` dont la cible de libération sera
arrondie à l'unité. `financing-modes.ts:245` reconnaît le problème : « Rendre les montants
entiers de bout en bout est souhaitable (un PSP XOF refuse les décimales) mais se décide EN
AMONT, dans le calcul du devis. » Correctif identifié, non appliqué.

---

## 5. Plan de mise à jour

Le document propose 5 phases. Elles sont précédées ici d'une **phase 0 corrective** : ajouter
Spot sur un moteur qui ne sait ni payer les gigs ni rembourser les missions reviendrait à bâtir
sur le défaut.

### Phase 0 — Corriger l'existant

| # | Action | Pourquoi | État |
|---|---|---|---|
| 0.1 | Unifier le moteur gig (supprimer `GigOrderEscrowOperation`, généraliser la portée) | Le « deuxième moteur » interdit existe déjà | **Fait (2026-09-14)** |
| 0.2 | Câbler le paiement des gigs : validation livraison → `release` → `completed` | Fonds bloqués sans issue | **Fait (2026-09-14)** |
| 0.3 | `emitContractRefund` borné par `heldBalance`, sous `FOR UPDATE`, idempotent | §18, soldes orphelins | **Fait (2026-09-14)** |
| 0.4 | Cron `tacit-acceptance` | §19, clause opposable non appliquée | **Fait (2026-09-14)** |
| 0.5 | Arrondis entiers de bout en bout | §22, prérequis des calculs S2 | **Fait (2026-09-14)** |
| 0.6 | Tests de concurrence | §17/§24 | Partiel — couverts sur 0.2/0.3 |

### Ce qui a été livré le 2026-09-14

**Optimisation préalable — la règle de solde est désormais partagée.** `netHeldAmount`
(`src/lib/escrow-instructions.ts`) est une fonction pure — `hold` crédite, `freeze` est neutre,
tout le reste débite — utilisée par `heldBalance` (missions) ET `gigHeldBalance` (gigs). C'était
la seule règle que les deux moteurs avaient réellement en commun ; la dupliquer au moment de
câbler le paiement des Gigs aurait figé pour de bon le « deuxième moteur » que 0.1 doit résorber.

**0.2 — paiement des gigs** (`src/lib/gig-completion.ts`,
`POST /api/gigs/orders/[orderId]/validate`). Le client valide la livraison : le solde réellement
séquestré est libéré au prestataire et la commande passe `completed`. Garde de statut posée
*sous* le verrou de ligne, donc idempotente et sûre en concurrence. Le montant libéré est le
solde, jamais `order.montant` — invariant 4 du §1.

**0.3 — remboursement de contrat** (`emitContractRefund` dans `src/lib/escrow.ts`,
`GET`/`POST /api/admin/contracts/[contractId]/refund`). Borné par `heldBalance` relu sous
`FOR UPDATE`, idempotent par le solde (aucune garde de statut séparée n'est nécessaire : à zéro,
il n'y a plus rien à instruire). Réservé à l'admin médiation, même raison que le solde de
retenue : un client capable de se rembourser seul disposerait d'un moyen de pression direct sur
un prestataire en cours de travail.

**Statut de mission `remboursee`** (migration `20260914120000_add_mission_remboursee_status`).
La branche `refund` de `applyPspWebhookEvent` réclamait cet état depuis qu'elle existe, en
refusant justement d'en inventer un : `cloturee` aurait fait passer un abandon pour une mission
menée à terme. La transition préserve `mediation_ouverte` (solder le séquestre ne tranche pas le
litige) et `cloturee` (un reliquat remboursé après une mission livrée ne la requalifie pas).

**0.4 — acceptation tacite** (`src/lib/tacit-acceptance.ts`, `GET /api/cron/tacit-acceptance`,
migration `20260914140000_add_deliverable_submitted_at`). La clause 3 du contrat — « à défaut de
contestation dans ce délai, le jalon est réputé accepté et son paiement est déclenché
automatiquement » — est désormais appliquée.

Trois points de conception méritent d'être retenus :

1. **Un horodatage de soumission a dû être créé** (`Jalon.submittedAt`, `Mission.submittedAt`).
   `updatedAt` bouge au moindre geste — consultation du client, constat de progression — et ne
   pouvait donc pas dater une soumission. Posé à chaque bascule vers `livrable_soumis`, sur le
   modèle exact de `reviewOpenedAt`.
2. **La règle contourne délibérément deux gardes** de `handleValidate` : `observedProgress >= 100`
   et `assertProofsValidated`. Elles matérialisent l'action du client ; ici c'est son SILENCE qui
   vaut acceptation, et les maintenir reviendrait à ne jamais déclencher la clause. Rien d'autre
   n'est contourné : plafond, retenue, cumul de ce qui est déjà parti et verrou d'émission sont
   ceux d'une validation manuelle, à l'octet près.
3. **`observedProgress` est porté à 100** au passage. `src/lib/jalons.ts` documente qu'un jalon
   `libere` vaut nécessairement 100 % constaté ; libérer sans l'écrire aurait laissé un jalon payé
   affiché à 0 % et faussé la progression pondérée de la mission.

Ce que la règle refuse de faire, et qui est le plus testé : délai non écoulé, **médiation ouverte**
(un litige est une contestation — exclu à la source de la requête de balayage), fonds non
séquestrés, livrable déjà tranché, `submittedAt` absent (livrables antérieurs au champ),
`acceptanceDeadlineDays <= 0` (désactive la règle au lieu de payer sans délai). Le cron est
déclaré dans `DEPLOYMENT-PRODUCTION.md`.

**0.5 — arrondis entiers de bout en bout** (`src/lib/devis.ts`, `src/lib/financing-modes.ts`,
`src/lib/validation.ts`). Les deux conventions qui se rencontraient au milieu de la chaîne de
paiement — centime côté devis/répartition, unité côté libérations et retenue — n'en font plus
qu'une : l'unité. Le XOF n'a pas de sous-unité en circulation et le PSP Mobile Money refuse une
instruction décimale ; l'écart entre les deux mailles était exactement le résidu qu'aucune
instruction ne venait chercher.

La correction est portée **à la source**, comme l'annonçait le commentaire de `distributeExact` :
le prix du contrat EST le totalTTC du devis, donc aucun découpage en aval ne pouvait être entier
si `computeDevisData` ne l'était pas.

Deux points de conception :

1. **`distributeExact` ne dépend plus de l'intégralité du total.** Sa dernière part absorbe le
   reliquat EXACT au lieu d'être ré-arrondie. Sans cela, un contrat à prix fixe décimal — saisi
   librement, ou antérieur à ce correctif — aurait vu ses parts entières ne plus sommer au prix,
   et `validateJalonsSum` l'aurait refusé. L'intégralité des montants DÉCOULE désormais de celle
   du total, au lieu d'être forcée contre lui.
2. **Deux familles de montants, deux traitements.** Les montants *calculés* (devis) sont arrondis
   au plus proche — le prestataire peut saisir un prix unitaire décimal, le total est ramené au
   franc, et l'arrondi au plus proche évite de le rogner d'un franc par ligne, toujours dans le
   même sens. Les montants *engageants* (proposition, offre, budget) sont désormais **refusés**
   s'ils ne sont pas entiers (`z.number().int()`) : ils deviennent tels quels le prix du contrat,
   sans étape de calcul qui pourrait les arrondir, et arrondir en silence un prix sur lequel deux
   parties s'engagent le ferait changer entre la saisie et la signature. Les formulaires
   imposaient déjà des entiers (`step={500}`) — aucune régression d'usage.

**Tests** : `escrow-instructions.test.ts` (10, unitaires purs), `gig-completion.e2e.test.ts`
(7, dont deux validations simultanées), `contract-refund.e2e.test.ts` (9, dont deux
remboursements simultanés et les trois transitions de statut), `tacit-acceptance.test.ts`
(8, cas limites des bornes), `tacit-acceptance.e2e.test.ts` (11, dont retenue J4, financement
progressif, portée sans jalon et idempotence), `validation.test.ts` (6, règle monétaire d'entrée),
plus 7 cas d'arrondi ajoutés à `devis.test.ts` et `financing-modes.test.ts`. Suite complète :
**624 tests, 66 fichiers, aucune régression**. Typecheck, lint et build de production propres.

#### 0.1 — unification des deux registres

Migration `20260914200000_unify_escrow_engines`. `GigOrderEscrowOperation` est **supprimée** ;
ses lignes ont été transférées dans `PspEscrowOperation`, qui porte désormais un discriminant
`sourceType` (`mission_contract` | `gig_order`) et deux clés étrangères nullables dont exactement
une est renseignée.

**Ce qui a été unifié, et ce qui ne l'a pas été.** L'unification porte sur le REGISTRE et ses
primitives — règle de solde, émission sous verrou, idempotence. Pas sur les transitions métier :
un contrat a des jalons, une retenue, un financement progressif et une médiation ; une commande
Gig n'a rien de tout cela. Ce qui devait cesser d'être écrit deux fois, c'est la façon de compter
l'argent, pas la façon de conduire une mission.

**Une contrainte que la base peut enfin exprimer.** `PspEscrowOperation_scope_exclusive` refuse
une opération orpheline, rattachée aux deux domaines, ou dont le discriminant contredit la portée.
Tant que chaque domaine avait sa table, aucune contrainte ne pouvait dire « exactement une
portée ».

**Une garde de portée dans le webhook.** Le dispatch ne connaît que le domaine des contrats ;
il refuse explicitement le reste (`operation_out_of_scope`). En pratique le cas ne se présente pas
— les opérations Gig sont créées confirmées et sans `pspReference`, donc introuvables par
référence — mais une invariance qu'on ne vérifie pas est une invariance qu'on finit par perdre.
La garde narrowe en outre `contract` à non-nul pour tout le dispatch, sans un seul `!` dispersé.

**Une TROISIÈME copie de la règle de solde découverte et supprimée.** La console PSP virtuelle
portait la sienne, en dur — et elle divergeait : elle comptait un `freeze` comme un crédit, alors
qu'un gel ne déplace aucun fonds. Une mission en médiation s'y affichait au double de son
séquestre réel. Elle utilise désormais `netHeldAmount`, dont la précondition (aucune instruction
`failed`) est maintenant explicite dans sa documentation — la console listant les instructions
refusées, elle devait filtrer elle-même.

**Tests** : `escrow-unification.e2e.test.ts` (8) — cohabitation des deux portées sans mélange des
soldes, paiement d'une commande sans effet sur le séquestre d'une mission, les trois violations
d'intégrité refusées par la base, garde de portée du webhook. Suite complète : **662 tests,
70 fichiers, aucune régression**, trois exécutions consécutives stables.

---

### Phase 1 — Socle financier (pivot)

| # | Action | État |
|---|---|---|
| 1.1 | Entité `Payable` | **Fait (2026-09-14)** |
| 1.2 | `escrowBalance()` → `{ funded, released, refunded, held, blocked, retained, available }` | **Fait (2026-09-14)** |
| 1.3 | **Insérer le payable dans le chemin existant** — le pivot | **Fait (2026-09-14)** |
| 1.4 | Mouvements `ESCROW_RETENTION_HOLD`, `ESCROW_ADJUSTMENT` | Écarté — voir ci-dessous |
| 1.5 | Assertion d'invariant global en test | **Fait (2026-09-14)** |

### Ce qui a été livré le 2026-09-14 (Phase 1)

**1.2 — soldes explicites** (`escrowBalance`, `src/lib/escrow.ts`). `heldBalance` ne savait
répondre qu'à « combien reste-t-il ? ». Le séquestre distingue désormais `funded`, `released`,
`refunded`, `held`, `blocked`, `retained` et surtout `available` — ce qui reste n'est pas ce qui
peut SORTIR : une somme gelée par un litige ou retenue en garantie est bien là, et pourtant
indisponible. `blocked` est borné par `held`, faute d'instruction de dégel (dette connue, 3.4) :
sans cette borne, une libération de médiation ferait passer `available` sous zéro.

**1.1 + 1.3 — l'obligation de paiement** (`model Payable`, migration
`20260914160000_add_payable`). La validation métier n'émet plus directement l'instruction PSP :
elle crée d'abord un payable, et **le contrôle de solde se fait entre les deux**. C'est ce qui
rend l'invariant n°4 — `payableAmount <= availableEscrowAmount` — réellement vérifié, au lieu
d'être garanti par effet de bord d'une garde de statut (`fonds_sous_sequestre`).

Quatre décisions de conception :

1. **La clé d'idempotence porte le CUMUL VISÉ, pas la source.** Le plan initial prévoyait une
   unicité `(sourceType, sourceId)` — elle aurait interdit le mode J3 tout entier, où un jalon
   produit légitimement un payable par palier confirmé. La clé est
   `<portée>:target:<cumul>`, ce qui reste idempotent sous concurrence sans brider le progressif.
2. **Quatre statuts, pas huit.** Le cahier des charges propose `DRAFT`, `VALIDATED`,
   `READY_FOR_PAYOUT`, `PSP_PENDING`, `PAID`, `FAILED`, `CANCELLED`, `DISPUTED`. Quatre d'entre
   eux n'ont aucun producteur dans le système — les créer, c'est obliger tout le code à traiter
   des états qu'aucun chemin n'atteint. Retenus : `validated`, `instructed`, `paid`, `failed`.
   `validated` est le seul état d'attente réel, et il a désormais un producteur : le séquestre
   insuffisant.
3. **`contractId` est NULLABLE** alors qu'il est toujours renseigné aujourd'hui. L'identité d'un
   payable est sa source, pas son contrat — une commande Gig n'a pas de `PrestationContract`.
   Exiger le lien aurait imposé de migrer `Payable` une seconde fois le jour de 0.1.
4. **Séquestre insuffisant : aucune instruction, payable maintenu.** Conformément au §13, jamais
   de paiement partiel implicite. `handleValidate` répond `409 escrow_insufficient` avec le
   montant manquant ; l'acceptation tacite repasse au balayage suivant. La recharge (Phase 3) a
   désormais où s'accrocher.

**1.4 écarté, délibérément.** `ESCROW_RETENTION_HOLD` aurait fait de la retenue un mouvement du
registre. Elle est déjà calculable exactement (`totalRetentionAmount` sur les jalons libérés,
moins ce qui est parti), et l'ajouter changerait la sémantique de `netHeldAmount` — donc de tous
les soldes — pour une information déjà disponible. `ESCROW_ADJUSTMENT` n'a aucun producteur.

**Optimisation associée.** Le contrôle de solde ajoutait deux allers-retours *à l'intérieur* du
`FOR UPDATE`. Les deux agrégats de la section verrouillée ont été fusionnés en un seul `groupBy`
(par type ET par jalon), et le calcul de la retenue est désormais conditionné à
`retentionRate > 0` — nul sur tous les modes sauf J4. La section critique est plus courte
qu'avant la Phase 1.

**Tests** : `payable.e2e.test.ts` (11) — soldes explicites, gel borné, cycle
`validated → instructed → paid`, plusieurs payables par jalon en progressif, idempotence,
concurrence, séquestre insuffisant puis recharge sans doublon, retenue J4 indisponible.
L'invariant comptable `funded == released + refunded + held` est réaffirmé après **chaque**
scénario. Suite complète : **635 tests, 67 fichiers, aucune régression**, cinq exécutions
consécutives stables.

**1.3 était le pivot.** Il est franchi : la recharge (Phase 3), le litige partiel et les
sous-tâches S1 ont désormais où s'accrocher.

### Phase 2 — S1 Spot forfait : le mode n'est pas à construire

**Constat (2026-09-14, après vérification).** Le §5 du cahier des charges décrit S1 étape par
étape : le prestataire propose un forfait → le client accepte → contrat → financement →
séquestre confirmé → travail → validation → libération → clôture. **C'est `GigOrder`, à
l'identique** — y compris le sens d'initiative, qui est ce qui le distingue vraiment d'une
mission (le prestataire propose, le client n'a rien publié). L'exemple du §5, une installation
électrique à 150 000 FCFA, est littéralement le scénario exécuté pour vérifier le geste de
validation en interface.

Trois chemins couvrent déjà le forfait :

| Chemin | Initiative | Correspond à |
|---|---|---|
| `GigOrder` | Prestataire propose | **S1 §5, à l'identique** |
| Mission + **F2** | Client publie | Forfait, séquestre unique |
| Mission + **J1** sur un devis à une ligne | Client publie | Le même, via un jalon |

Créer un mode `S1` au catalogue ajouterait un **quatrième** chemin pour la même chose —
exactement ce que le §1 interdit. Le catalogue reste donc à F2 / J1 / J3 / J4.

#### Ce qui manquait réellement — et qui est fait

0.1 avait unifié le REGISTRE, pas la couche OBLIGATION. Le chemin Gig ne créait aucun `Payable`
et n'appliquait pas l'invariant n°4 : « validé ≠ payé » n'était matérialisé que du côté mission.
Une incohérence héritée de la Phase 1, qui n'avait été câblée que dans `emitScopedRelease`.

`completeGigOrder` crée désormais une créance avant toute instruction, la borne par le solde
DISPONIBLE, et la solde à la confirmation. Deux points :

1. **Le payable traverse ses trois états dans la même transaction**, parce que ce domaine règle
   de façon synchrone — l'instruction naît confirmée, il n'y a pas de webhook à attendre. Les
   états restent vrais (la créance a existé avant d'être réglée) ; le laisser en `instructed` le
   ferait compter indéfiniment comme dû.
2. **`gigAvailableBalance` est distinct de `gigHeldBalance`**, alors que les deux coïncident
   aujourd'hui — une commande n'a ni gel ni retenue. Les séparer AVANT que ce ne soit plus vrai
   évite d'avoir à s'en souvenir le jour où un litige touchera une commande.

`contractId` reste nul sur ces payables : c'est le cas pour lequel l'identité d'un payable a été
fondée sur sa SOURCE et la clé étrangère laissée nullable, plutôt que d'imposer une seconde
migration.

**Troisième extraction d'une règle recopiée.** `outstandingFreeze` (Σ freeze − Σ unfreeze) était
écrite deux fois en ligne dans `escrow.ts` ; un troisième appelant arrivait côté Gig. Elle rejoint
`netHeldAmount` dans le module feuille partagé — une règle financière recopiée trois fois finit
par diverger, ce qui était précisément arrivé au calcul de solde de la console PSP virtuelle.

#### Les sous-tâches (§7/§8) — un cinquième levier, pas une entité

**Correction d'une analyse précédente.** J'avais conclu deux fois que les sous-tâches S1 étaient
« mot pour mot J1 ». C'est faux sur le point que le §8 désigne nommément. Vérification faite : un
contrat à jalons se finance **jalon par jalon** — `requestContractHold` refusait explicitement un
financement global (`use_jalon_hold`). C'est exactement le schéma que le §8 interdit (« les
sous-tâches ne doivent pas créer un second séquestre »).

La différence entre J1 et S1 n'est donc pas le découpage — les deux dérivent les mêmes lots du
même devis, et un test le verrouille — mais **la granularité du financement**.

D'où un **cinquième levier** au catalogue, `fundingGranularity: "per_jalon" | "upfront"`, plutôt
qu'une entité nouvelle. Le principe de conception du catalogue est que tout mode se ramène à une
combinaison de leviers ; `SpotTask` reste un `Jalon`, seule l'entrée des fonds change.

**Le mode `S1` — « Forfait avec sous-tâches »** est le seul à le porter, et la raison pour
laquelle le levier existe : un levier sans producteur est ce que ce chantier a écarté partout
ailleurs. Le catalogue proposé passe de quatre à cinq modes (F2, J1, J3, J4, **S1**), décision
explicite reflétée dans le test qui verrouille l'offre.

**Ce qu'il a fallu changer était étonnamment peu**, parce que les libérations bornaient déjà sur
le solde du CONTRAT et non sur celui du jalon (`availableFrom`) — la séquence du §7
(150 000 → 130 000 → 70 000 → 20 000 → 0) est ce que le solde produisait déjà. Deux obstacles
seulement :

1. `requestContractHold` refusait un financement global dès qu'il existait des jalons ;
2. **le vrai blocage** : la confirmation d'un HOLD scopé contrat laissait les jalons en
   `en_attente`, or `canSubmitJalonDeliverable` exige `fonds_sous_sequestre` — aucun livrable
   n'aurait pu être soumis sur un contrat pourtant intégralement financé.

Symétriquement, financer un jalon isolément est désormais refusé en `upfront`
(`use_contract_hold`) : ce serait créer le second séquestre que le §8 interdit, et faire payer le
client deux fois pour le même poste.

**Tests** : `funding-upfront.e2e.test.ts` (6) — le devis du §7 à l'identique, un seul HOLD,
confirmation qui rend les quatre lots livrables, la séquence de consommation au franc près,
séquestre épuisé, refus du double financement. Plus 4 cas de catalogue. Suite complète :
**699 tests, 73 fichiers, aucune régression**.

**Tests** : 5 cas ajoutés à `gig-completion.e2e.test.ts` — payable créé/lié/soldé, pas de doublon
(séquentiel et concurrent), invariant n°4 avec créance maintenue due, disponible annulé par un
gel. Suite complète : **689 tests, 72 fichiers, aucune régression**.

### Compte financier lisible — « financer ≠ payer » (2026-09-14)

Le document a été étoffé d'un cadrage conceptuel (§1 à §26) dont le point central est la
séparation entre FINANCER et PAYER. Le moteur l'appliquait depuis la Phase 1 ; il ne l'exposait
nulle part — `escrowBalance` n'était lu que par le module de recharge.

Deux ajouts :

**`EscrowBalance` porte désormais les huit chiffres du §16.** Deux champs manquaient :
`contractual` (le prix engagé — seul repère qui dise si le séquestre couvre l'engagement) et
`releasable` (Σ des payables `validated` : reconnu dû, pas encore instruit). Ce dernier est le
chaînon que « financer ≠ payer » rend nécessaire : le confondre avec `released` ferait croire le
prestataire payé, le confondre avec `available` ferait croire le client libre de ses fonds.
`rechargeNeed` calculait sa propre somme des payables dus — elle repose maintenant sur ce champ,
une seule définition.

**`GET /api/missions/[id]/escrow/balance`**, lisible par les DEUX parties. Le séquestre est leur
compte commun : cacher au prestataire ce qui lui est reconnu dû rendrait la distinction
inéquitable — elle ne protégerait que celui qui paie. Lecture seule, sans exception : aucune route
n'expose d'opération modifiant directement un solde (§21), les soldes sont dérivés des
instructions.

Une nuance de vocabulaire vaut d'être notée. La formule du document —
`Solde séquestre = déposés − libérés − remboursés − bloqués` — fusionne deux notions que le code
garde distinctes : `held` (ce qui est physiquement encore au séquestre) et `available` (ce qui
peut bouger). Sur l'exemple du §16 : 275 000 contre 255 000. Les fonds litigieux sont bien là,
seulement immobilisés ; les confondre reviendrait à dire au client que 20 000 ont disparu.

**Tests** : `escrow-balance.e2e.test.ts` (8) — l'exemple du §16 au franc près, invariant
comptable, un payable validé qui n'apparaît QUE dans `releasable`, accès des deux parties et refus
des tiers. Suite complète : **670 tests, 71 fichiers, aucune régression**.

### État financier explicite (§3) — dérivé, jamais stocké

`escrowFinancialState` (`src/lib/escrow-state.ts`), module feuille pur, expose la chaîne du §3 :
`non_finance → financement_en_attente → sequestre → partiellement_libere → totalement_libere →
cloture`.

**Dérivé et non stocké** — décision de fond, cohérente avec le reste du moteur. Une colonne
d'état sur le contrat serait un second point de vérité sur la même réalité : elle pourrait
contredire les mouvements qui la fondent, et rien ne signalerait la divergence (un webhook
manqué, une transition oubliée sur un chemin nouveau, et l'écran affiche « séquestré » sur un
contrat déjà payé). Un état dérivé ne peut pas mentir : il EST la lecture des soldes. Même
raisonnement que pour la retenue de garantie, jamais matérialisée en mouvement parce qu'exactement
calculable.

Trois arbitrages dans la dérivation :

1. **`missionStatus` sépare « totalement libéré » de « clôturé »**, et sert à cela seul. Les deux
   décrivent le même séquestre — vide, sans reste dû ; ce qui les distingue n'est pas financier.
   Entre la dernière libération et la clôture il s'écoule le temps d'un webhook : annoncer une fin
   non acquise serait un mensonge dans le sens le plus coûteux.
2. **Un séquestre vidé mais avec un reste DÛ n'est jamais « totalement libéré »** — c'est le cas
   d'insuffisance (§18), où le prestataire attend encore sa recharge.
3. **Une recharge en vol ne fait pas reculer l'état** d'un contrat déjà financé. Il est financé,
   seulement insuffisamment, et c'est `releasable > available` qui le dit.

**La décomposition du §3** complète le compte financier. `held` se partitionne exactement :

```
held
 ├── blocked   (litige)
 ├── retained  (garantie J4)
 └── available
      ├── owedToProvider  (reconnu dû — borné par le disponible)
      └── refundable      (libre, restituable au client)
```

`owedToProvider` est borné par `available` et non égal à `releasable` : annoncer au prestataire
plus que ce que le séquestre contient serait une promesse creuse. Le cahier des charges distingue
« PARTIE BLOQUÉE » et « PARTIE LITIGIEUSE » ; la plateforme n'a qu'un seul mécanisme de blocage —
le gel accompagnant une médiation — et en faire deux chiffres laisserait croire à deux causes.

**Tests** : `escrow-state.test.ts` (10, dont une vérification de TOTALITÉ : aucune combinaison de
soldes sans état, et aucun état inatteignable) et 4 cas de partition dans
`escrow-balance.e2e.test.ts`. Suite complète : **684 tests, 72 fichiers, aucune régression**.

**Reste à faire** : l'affichage. Les écrans du §22 (client : solde / consommé / restant ;
prestataire : gagné / en attente / payé ; admin : mouvements) n'existent toujours pas — la donnée
est désormais servie, elle n'est pas montrée.

---

### Phase 3 — Recharge et litiges partiels

| # | Action | État |
|---|---|---|
| 3.1 | HOLD complémentaire | **Fait (2026-09-14)** — par chemin dédié, voir ci-dessous |
| 3.2 | `ESCROW_INSUFFICIENT` + montant manquant | **Fait (2026-09-14)** |
| 3.3 | Payable partiel + montant bloqué | **Reporté** — sans producteur avant S1/S2, voir ci-dessous |
| 3.4 | Instruction de dégel | **Fait (2026-09-14)** |

**3.1 + 3.2 — recharge du séquestre** (`src/lib/escrow-recharge.ts`,
`GET`/`POST /api/missions/[id]/escrow/recharge`).

Deux décisions :

1. **Chemin dédié, plutôt que desserrer `hasInFlightHold`.** La garde anti-doublon des deux
   chemins de financement existe pour un défaut constaté : un double-clic transmettait DEUX
   débits Mobile Money, sans route pour annuler le second. La desserrer aurait rouvert ce défaut
   sur le chemin le plus emprunté pour servir un cas rare. La recharge a sa propre garde — non
   pas « un HOLD existe-t-il ? » (il en existe forcément un) mais « un HOLD est-il encore en
   vol ? ».
2. **Le montant est dérivé, jamais saisi.** On recharge exactement ce qui manque, calculé sur les
   PAYABLES en attente et non sur le prix du contrat : seule une somme déjà validée est due.
   Réclamer sur la base du prix contractuel ferait financer d'avance un travail non approuvé.

Les préconditions de financement (flag PSP par zone, assurance effective, plafond de couverture)
ont été extraites de `requestContractHold` en `assertFundingPreconditions` : ce qui autorise à
débiter un client ne dépend pas de ce qui motive le débit.

#### Deux défauts révélés par la recharge

**Le webhook faisait RÉGRESSER la mission.** La branche `hold` du chemin contrat écrivait
`fonds_sous_sequestre` sans condition. Historiquement inoffensif — un contrat n'avait qu'un seul
HOLD, confirmé en début de cycle. Avec un second HOLD, une mission à `livrable_soumis` revenait
en arrière et le client perdait le bouton de validation d'un travail déjà rendu. La branche JALON
portait déjà la garde ; la variante contrat ne l'avait jamais eue.

**Un HOLD `pending` comptait comme financé (P0).** `netHeldAmount` traitait toutes les
instructions en vol de la même façon. Une mise sous séquestre `pending` est un débit Mobile Money
transmis, PAS un encaissement : le client peut ne jamais l'autoriser. La compter autorisait un
paiement au prestataire contre de l'argent non reçu — exactement ce que l'invariant n°1 interdit.

La règle porte désormais une **asymétrie assumée** :

| Sens | Compté à partir de | Pourquoi |
|---|---|---|
| Entrant (`hold`) | `confirmed` seulement | Ne pas verser contre de l'argent non reçu (invariant n°1) |
| Sortant (`release`, `refund`, `retention_release`) | `pending` inclus | Ne pas réémettre ce qui est déjà parti (règle 18.3) |

Les deux branches penchent du même côté — ne jamais surestimer ce dont on dispose — et c'est ce
qui rend ce solde utilisable comme borne d'un paiement. Le défaut préexistait à la Phase 1 et
affectait déjà le gel de médiation, la libération de médiation et le remboursement de contrat.

**Tests** : `escrow-recharge.e2e.test.ts` (8) — manque dérivé des payables, recharge du montant
exact, refus tant qu'un financement est en vol, refus sans contrat signé, non-régression du
statut de mission. Plus 5 cas d'asymétrie dans `escrow-instructions.test.ts`. Suite complète :
**648 tests, 68 fichiers, aucune régression**.

#### 3.4 — levée du gel

`emitUnfreeze` (`src/lib/escrow.ts`), nouveau type d'instruction `unfreeze` (migration
`20260914180000`), transmis par les **deux** chemins de clôture d'une médiation — accord comme
désaccord.

La dette était notée dans le code lui-même : « ce que cette route ne fait toujours PAS : dégeler
les fonds au PSP ». Elle n'était pas théorique — une médiation close restaurait le statut de la
mission, qui reprenait son cours, mais le gel restait en vigueur ; `available` retranchant ce qui
est bloqué, plus aucune libération ne pouvait sortir. Le litige était réglé et l'argent restait
immobilisé.

Un point subtil : le montant dégelé est **l'ordre de gel encore en vigueur** (Σ freeze − Σ
unfreeze), et non `EscrowBalance.blocked`. Les deux diffèrent dès qu'une résolution de médiation
a libéré une partie des fonds entre le gel et sa levée — `blocked` est alors plafonné par ce qui
reste au séquestre, alors que l'ordre porte toujours le montant gelé d'origine. Dégeler le
montant plafonné laisse un reliquat d'ordre que plus rien ne vient lever, et `blocked` ne retombe
jamais à zéro. Un `unfreeze` ne déplaçant aucun fonds, que son montant dépasse le solde restant
n'a pas d'incidence monétaire : il lève une consigne.

Le plafonnement de `blocked` par `held` est conservé, mais il n'est plus le mécanisme principal :
il ne couvre plus que les médiations closes AVANT l'existence du dégel, dont le gel ne sera jamais
levé.

#### 3.3 — pourquoi il est reporté, et non oublié

Le scénario du §14 — « 6 jours déclarés, 4 validés, 2 contestés → payable pour les 4, montant
litigieux pour les 2 » — suppose des **unités livrables sous le jalon** : des journées pointées
(S2) ou des sous-tâches (S1). Ni les unes ni les autres n'existent encore.

La moitié « payable partiel » est d'ailleurs **déjà couverte** par le financement progressif (J3) :
le client confirme 70 %, 70 % sont payés, le reste demeure au séquestre. Ce qui manque est la
seconde moitié — marquer ce reste comme *contesté* plutôt que simplement *non encore validé* — et
elle n'a aucun producteur : aucun geste de l'interface ne permet aujourd'hui de dire « j'accepte
ceci et je conteste cela » à l'intérieur d'un jalon.

Construire ce mécanisme maintenant reviendrait à créer un état qu'aucun chemin n'atteint, pour la
même raison qui a fait écarter quatre des huit statuts de `Payable` et le mouvement
`ESCROW_RETENTION_HOLD`. **3.3 appartient aux phases 2 et 4**, avec les unités qui lui donneront
un sens.

**Tests** : `unfreeze.e2e.test.ts` (6) — gel puis levée, ordre entier après libération partielle,
idempotence, concurrence, absence de transition métier. Suite complète : **654 tests, 69 fichiers,
aucune régression**.

### Phase 4 — S2 Spot temps + pointage

| # | Action | État |
|---|---|---|
| 4.0 | **Décision A12** : `Attendance` distinct de `CheckInEvent` | **Tranché (2026-09-14)** |
| 4.1 | `Attendance` + cycle de vie | **Fait** |
| 4.2 | Rôle responsable chantier | **Fait (2026-09-14)** |
| 4.3 | `SpotTimeTerms` — unité tarifaire, tarif, plafonds | **Fait** |
| 4.4 | Calculs H/J/M + heures sup → `Payable` | **Fait** |
| 4.5 | Unicité de période | **Fait** — index partiel |
| 4.6 | Écrans | **Fait (2026-09-14)** |

#### Ce qui a été livré (2026-09-14)

**Le socle était déjà là.** Financer un plafond en une seule fois (§10) est le levier `upfront`
du §8 ; la créance avant toute instruction (§15) est `Payable` ; la borne sur le disponible (§14)
est l'invariant n°4 ; la recharge (§18) et le litige séquestré (§21) existaient. Ce qui manquait
était le contrat au temps et le pointage — pas la mécanique financière.

**Décision A12, tranchée.** `CheckInEvent` ne pouvait pas servir : la règle lui interdit
d'alimenter « une pénalité ou une décision de litige », il est optionnel (actif seulement si les
deux parties consentent) et purgé quelques jours après la mission. Un relevé qui détermine une
rémunération ne peut être ni optionnel (le salaire en dépend), ni purgé à court terme (c'est une
pièce de paie), et il tranche précisément ce que A12 interdit à l'autre de trancher. **`Attendance`
est donc un module distinct ; `CheckInEvent` n'est pas touché.**

**`spot-time.ts` est pur et ne peut RIEN payer** — il calcule des montants et vérifie des
plafonds, sans connaître ni séquestre, ni PSP, ni payable. C'est ce découpage qui rend le §9
(« on ne paie jamais directement selon le pointage ») vérifiable plutôt que promis.

Quatre points de conception :

1. **Deux plafonds, deux refus distincts.** « Vous dépassez les 20 jours convenus » n'est pas
   « le plafond financier est atteint » : confondre les deux enverrait chercher un financement là
   où c'est la durée qui bloque.
2. **Les heures supplémentaires sont une PART des heures validées**, pas un supplément — sur 9 h
   dont 1 majorée, 8 sont au tarif normal. Les compter en plus paierait neuf heures et en
   facturerait dix. Sans clause au contrat, elles sont payées au tarif **normal**, jamais
   refusées : punir rétroactivement des heures réellement travaillées serait injuste.
3. **L'alerte du §19 arrondit vers le bas.** Annoncer « 4 jours » quand le solde n'en couvre que
   3,7 promettrait une journée qui sera refusée — sur un chantier, c'est une équipe qui s'est
   déplacée.
4. **L'unicité de période est un index PARTIEL** (`WHERE status NOT IN ('rejected','cancelled')`).
   L'invariant est « pas deux relevés ACTIFS », pas « pas deux lignes » : une contrainte totale
   condamnait la journée dès le premier refus, alors qu'un refus motivé demande précisément une
   correction. Prisma ne sait pas l'exprimer — l'index vit en SQL, délibérément.

**Les trois modes S2-H / S2-J / S2-M** n'ont pas de jalons : ce qui fractionne le paiement n'est
pas un découpage convenu d'avance mais des relevés qui n'existent pas encore à la signature. Le
séquestre porte le plafond, chaque relevé validé le consomme — le modèle du §8, obtenu sans jalon.
Le catalogue passe à huit modes proposés.

#### Rôle « responsable chantier » et écrans (2026-09-14)

**Le rôle est une DÉLÉGATION, pas une catégorie d'utilisateur.** C'est la seule délégation de
pouvoir de la plateforme : le client confie à un tiers le droit de déclencher des paiements en
constatant une présence. Deux choix en découlent :

1. **La désignation vit sur le CONTRAT, jamais sur le compte** (`SpotTimeTerms.siteManagerId`).
   Un compte `responsable_chantier` n'a par lui-même aucun droit — sans désignation, il voit un
   tableau vide, ce qui est exact. Un pouvoir attaché au rôle serait impossible à retirer sans
   supprimer le compte de la personne ; là, une révocation reprend la main immédiatement.
2. **Le prestataire n'est jamais validateur**, quel que soit son rôle. Valider ses propres heures,
   c'est se payer soi-même — et c'est la garde que les tests attaquent en premier.

Les relevés déjà validés par un responsable révoqué **restent valides** : une validation passée
était légitime au moment où elle a eu lieu, et l'argent est parti. La défaire rouvrirait un
paiement déjà exécuté.

**Son tableau de bord est volontairement dépouillé** — trois rubriques, pas sept. Il ne candidate
pas, ne soumet pas de devis et n'est pas payé par la plateforme ; la navigation de prestataire lui
aurait donné quatre rubriques sans objet. Le bloc « Documents Contractuels » est masqué pour la
même raison (`hideDocuments` sur `DashboardLayout`). Ce qu'il voit : ses chantiers, les relevés à
constater, et l'alerte de financement du §19 — c'est lui qui verra l'équipe s'arrêter, donc à lui
de la remonter au client avant l'arrêt.

**Un seul composant de pointage pour les trois rôles** (`AttendancePanel`), piloté par le `role`
que l'API renvoie : c'est le serveur qui sait qui valide, jamais le navigateur. Il est monté sur
la page mission (travailleur), la page séquestre (client) et le tableau de bord du responsable.
L'interface MONTRE le §9 : un relevé non validé affiche sa « valeur estimée », jamais un montant
libéré.

**Vérifié dans l'application réelle**, pas seulement compilé : connexion en responsable de
chantier, constat partiel d'un relevé (2 jours déclarés → 1,5 constaté), et la chaîne complète
observée en base — créance `attendance` de 11 250 XOF payée, libération correspondante, compteurs
mis à jour.

#### §21 — la contestation, complète (2026-09-14)

La validation partielle laissait le reste au séquestre **sans le qualifier** : ni dû, ni contesté,
juste non payé. Le prestataire ne savait pas s'il était refusé ou oublié, et rien ne marquait
qu'un désaccord existait.

`disputeAttendance` reconnaît une part et **gèle** l'autre : elle reste au séquestre, indisponible,
jusqu'à l'arbitrage. C'est le §21 littéralement — « les montants litigieux restent dans le
séquestre » : ni versés, ni rendus.

Trois points :

1. **Le gel est CIBLÉ**, contrairement à celui d'une médiation qui porte le solde entier. Deux
   journées contestées gèlent leur part seule ; le reste du séquestre continue de financer les
   journées suivantes. Un chantier ne s'arrête pas parce qu'une journée est discutée — un test le
   vérifie explicitement.
2. **La part reconnue passe par le chemin ORDINAIRE** — mêmes plafonds, même créance, même
   contrôle de séquestre. Contester ne crée pas un second chemin de paiement.
3. **L'arbitrage dégèle AVANT de payer**, et c'est nécessaire : tant que la somme est gelée elle
   n'est pas dans le disponible, et l'invariant n°4 refuserait de la libérer. Écarter la
   contestation dégèle sans payer — la somme redevient disponible et repartira au client en fin de
   contrat comme tout reliquat.

`emitUnfreeze` accepte désormais un montant, pour lever un gel ciblé sans toucher aux autres
litiges du même contrat.

#### §22 et §24 — les deux dernières sorties du séquestre (2026-09-14)

**§22 — « il ne doit jamais rester un argent fantôme ».** Le chemin de remboursement existait
depuis 0.3, mais il fallait un administrateur pour le déclencher — et personne ne surveille les
soldes un par un. Les reliquats ne sont pourtant pas exceptionnels : un contrat au temps finance
un plafond qu'il consomme rarement en entier, une médiation ne redistribue parfois qu'une partie,
une journée écartée après contestation libère des fonds que plus personne ne réclame.

Le cron `residual-refunds` rembourse le reliquat de toute mission terminée. Ce qu'il ne fait pas
compte autant : il ne décide jamais qu'une mission est finie (il n'agit que sur `cloturee` /
`remboursee`), laisse `mediation_ouverte` intacte — rendre au client des fonds qu'un litige
dispute reviendrait à trancher ce litige en silence — et se borne au **disponible**, jamais au
détenu : ce qui est gelé ou retenu n'est pas un reliquat oublié.

**§24 — une médiation pouvait payer, jamais rembourser.** `Mediation.refundAmount` complète
`resolutionAmount` : trois destinations, comme le décrit le §24 — libérer au prestataire, rendre
au client, maintenir bloqué. Le dégel devient **partiel**, à hauteur de ce qui est distribué :
ce qui n'est ni libéré ni remboursé reste gelé, ce qui est précisément ce que « maintenir
bloqué » veut dire. Dégeler tout puis redistribuer aurait rendu disponible, l'espace d'un
instant, une somme que la médiation venait de décider d'immobiliser.

#### Un défaut révélé au passage (P1)

`emitContractRefund` se bornait au solde **détenu**, pas au **disponible** : il remboursait donc
des fonds gelés par un litige. Sur une mission close avec 40 000 en litige, le remboursement les
emportait — tranchant le litige en faveur du client, en silence. `emitMediationRelease` avait la
même faiblesse dans l'autre sens.

Les deux sont désormais bornées par le disponible. C'est **l'invariant n°4 appliqué
uniformément** : rien ne quitte le séquestre au-delà de ce qui est disponible, quelle que soit la
destination. Une médiation qui veut distribuer des fonds gelés commence par les dégeler — c'est
le dégel qui les rend disponibles, pas la médiation qui s'affranchit de la règle.

**Tests** : `residual-refund.e2e.test.ts` (6 — mission close remboursée, mission en cours et en
médiation intactes, fonds gelés préservés, idempotence). Plus la mise à jour du test de dégel, qui
datait de l'ancienne règle.

#### Optimisations (2026-09-14)

**Le tableau de bord du responsable faisait ~4N requêtes.** Chaque chantier demandait sa liste de
relevés ET son solde — lequel en coûte trois à lui seul. Un responsable suivant vingt chantiers
déclenchait quatre-vingts requêtes, et ce nombre grandissait avec ses responsabilités.
`escrowBalancesFor` calcule tous les soldes en **trois requêtes, quel que soit le nombre de
contrats**. La règle de calcul est rigoureusement celle de `escrowBalance` — mêmes fonctions
pures — et un test vérifie l'ÉGALITÉ des deux vues sur des contrats aux états variés (gelé,
partiellement libéré, avec retenue) : une divergence entre vue unitaire et vue agrégée ferait
afficher deux soldes différents pour le même séquestre, et aucun ne serait croyable.

**Un sondage inutile toutes les 30 secondes.** `DashboardLayout` interroge `/api/devis-contrats`
pour les compteurs du bloc « Documents Contractuels ». Le responsable de chantier ne l'affiche
pas — et l'interrogeait quand même, indéfiniment. `useDevisContratsBadges(enabled)` coupe le
sondage quand le bloc est masqué.

**Tests** : 6 cas de contestation ajoutés à `spot-time.e2e.test.ts` et 3 d'équivalence des vues à
`payable.e2e.test.ts`. Suite complète : **763 tests, 77 fichiers, aucune régression**.

**Tests** : `spot-time.test.ts` (24, tous les exemples chiffrés du document au franc près) et
`spot-time.e2e.test.ts` (12 — plafond séquestré, relevé soumis qui ne libère rien, validation
client qui libère 30 000, double pointage et chevauchement refusés, validation partielle,
redéclaration après refus, plafonds, alerte) et `site-manager.e2e.test.ts` (11 — règle
d'autorisation isolée, délégation de bout en bout, responsable non désigné impuissant, prestataire
jamais validateur, révocation immédiate).

### Phase 5 — Audit financier final

Prompt §6 du document rejoué sur l'implémentation complète, grille P0–P3, en lecture seule.

---

## 5 bis. La règle d'or, formalisée (§26)

Le §26 demande de formaliser deux règles dans les spécifications. Pour du logiciel, formaliser
veut dire **rendre vérifiable** — une règle qu'on ne peut pas contrôler n'est pas une
spécification, c'est une intention.

> **RÈGLE 1** — Aucune obligation de paiement ne peut être exécutée par la plateforme sans
> disponibilité préalable des fonds correspondants dans le séquestre. Toute validation de
> prestation, de sous-tâche, de jalon ou de temps travaillé crée AU MAXIMUM une créance payable ;
> elle ne constitue pas à elle seule une autorisation de débit hors séquestre.

> **RÈGLE 2** — Tout montant litigieux, retenu ou non encore validé demeure dans le séquestre
> jusqu'à une décision autorisant sa libération ou son remboursement.

`src/lib/escrow-invariants.ts` les énonce **et** les contrôle. Le point de conception : le
contrôle porte sur l'ÉTAT, jamais sur le chemin. Ces règles sont aujourd'hui respectées par une
dizaine de chemins distincts — jalon, point d'étape progressif, acceptation tacite, retenue de
garantie, relevé de présence, contestation, résolution de médiation, remboursement de reliquat,
commande Gig — chacun pour ses propres raisons. Rien ne garantissait qu'un onzième les tiendrait.
Vérifier l'état permet de les asserter après n'importe quelle opération, sans rien savoir du mode.

Ce qui est contrôlé :

| Contrôle | Règle |
|---|---|
| `financé = libéré + remboursé + détenu` | identité comptable — si elle tombe, le registre est faux |
| Sorties ≤ financement | 1 |
| Disponible jamais négatif | 1 — c'est la borne de toute instruction |
| Aucune créance `validated` rattachée à une instruction | 1 — « au maximum une créance » |
| Aucune créance `paid` sans instruction | 1 — pas de paiement hors registre |
| `bloqué + retenu ≤ détenu` | 2 |
| `disponible = détenu − bloqué − retenu` | 2 — « demeure dans le séquestre » |

**Le contrôle est lui-même testé sur des états impossibles** — sorties supérieures au
financement, disponible ignorant le gel, créance payée sans instruction — qu'aucun chemin du code
ne sait produire. Un contrôle qui ne trouve jamais rien ne prouve rien.

**Tests** : `golden-rules.e2e.test.ts` (12) — les deux règles asservies après CHAQUE étape sur
F2, J4 (retenue), S2 (pointage, contestation, gel), remboursement de reliquat et cycle gel/dégel,
plus six états volontairement corrompus que le contrôle doit rejeter. Suite complète :
**775 tests, 78 fichiers, aucune régression**.

---

## 6. Décisions ouvertes

1. **S1 sous-tâches = J1 renommé ?** Si oui, la Phase 2 quasi disparaît.
2. **A12 vs pointage opposable** — décision de conformité, pas technique. Conditionne la Phase 4.
3. ~~**Unifier le moteur gig (0.1) ou seulement le réparer (0.2) ?**~~ → **Tranché (2026-09-14)** :
   les deux ont été faits, 0.2 d'abord (urgent), 0.1 ensuite. `Payable` avait été conçu avec une
   portée générique en prévision, il n'y a eu aucune seconde migration à écrire.

---

## 7. Risques de migration

- `GigOrderEscrowOperation` → `PspEscrowOperation` : la seconde exige un `contractId`, or un
  `GigOrder` n'a pas de `PrestationContract`. Une portée générique (`sourceType`/`sourceId`) est
  nécessaire, donc une migration non triviale de la table et de ses index.
- `FinancingModeKey` est une union TypeScript fermée + valeurs en base : tout ajout doit rester
  additif et laisser les contrats existants inchangés.
- Arrondis (0.5) : passer le devis à l'unité touche `computeDevisData` et l'ensemble des tests
  de devis existants.
