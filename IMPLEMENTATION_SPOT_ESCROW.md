# Moteur financier unifié sous séquestre — implémentation

> Livrable §26 du prompt maître (`financement.md`).
> Date : 2026-09-14 · Branche : `fix/workflow-escrow-jalons`
>
> Le diagnostic préalable exigé par le §2 est dans [`DIAGNOSTIC_FINANCEMENT.md`](DIAGNOSTIC_FINANCEMENT.md) :
> il décrit l'existant avant modification, les écarts, et le plan suivi. Ce document-ci décrit ce
> qui **est**.

---

## 1. Architecture

Un seul moteur. Les huit modes ne sont que des **façons de déterminer le montant libérable** ;
financièrement, ils empruntent le même chemin.

```
CONTRAT → FINANCEMENT → SÉQUESTRE
                            │
   ┌──────┬──────┬──────┬───┴───┬──────────┐
   F2     J1     J3     J4      S1        S2-H/J/M
  unique jalons progr. retenue sous-tâches pointage
   └──────┴──────┴──────┴───────┴──────────┘
                            ↓
                      VALIDATION ──────→ LITIGE
                            ↓               ↓
                         PAYABLE          GELÉ
                            ↓         (reste au séquestre)
                   CONTRÔLE DU DISPONIBLE
                            ↓
                    INSTRUCTION PSP
                            ↓
                     WEBHOOK SIGNÉ
                            ↓
                  ┌─────────┴─────────┐
                PAYÉ              REMBOURSÉ
```

**Ce qui est partagé** : le registre, la règle de solde, la créance, la borne, l'émission
verrouillée, l'idempotence, le webhook.
**Ce qui ne l'est pas** : les transitions métier. Un contrat a des jalons, une retenue, une
médiation ; une commande Gig n'a rien de tout cela ; un contrat au temps a des relevés de
présence. Ce qui devait cesser d'être écrit deux fois, c'est la façon de **compter** l'argent,
pas la façon de conduire une mission.

### Modules

| Fichier | Rôle |
|---|---|
| `src/lib/escrow-instructions.ts` | Module FEUILLE, pur. Règle de solde (`netHeldAmount`), part gelée (`outstandingFreeze`), types de versement. **Une seule écriture de chaque règle.** |
| `src/lib/escrow.ts` | Registre : financement, libération, remboursement, gel, dégel, soldes. Toutes les émissions sous `FOR UPDATE`. |
| `src/lib/escrow-invariants.ts` | Les deux règles d'or du §26, **contrôlables**. |
| `src/lib/escrow-state.ts` | État financier dérivé (module feuille, pur). |
| `src/lib/escrow-recharge.ts` | Recharge du séquestre (§13/§18). |
| `src/lib/residual-refund.ts` | Balayage des reliquats (§18/§22). |
| `src/lib/financing-modes.ts` | Catalogue des 8 modes, réduits à 5 primitives. |
| `src/lib/jalons.ts` | Progressif, retenue, séquentiel — fonctions pures. |
| `src/lib/spot-time.ts` | Calculs au temps (§9-13), purs. **Ne peut rien payer.** |
| `src/lib/spot-time-actions.ts` | Cycle de vie du pointage (§20) et contestation (§21). |
| `src/lib/gig-completion.ts` | Commandes Gig — transitions propres à ce domaine. |
| `src/lib/tacit-acceptance.ts` | Acceptation tacite (§19). |
| `src/lib/psp-webhook.ts` | Confirmation signée, machine à états terminale. |

---

## 2. Règles métier

### Les deux règles d'or (§26)

> **RÈGLE 1** — Aucune obligation de paiement ne peut être exécutée sans disponibilité préalable
> des fonds dans le séquestre. Toute validation crée **au maximum** une créance payable ; elle ne
> constitue pas à elle seule une autorisation de débit hors séquestre.

> **RÈGLE 2** — Tout montant litigieux, retenu ou non encore validé demeure dans le séquestre
> jusqu'à une décision autorisant sa libération ou son remboursement.

Énoncées **et contrôlées** dans `escrow-invariants.ts`. Le contrôle porte sur l'ÉTAT, jamais sur
le chemin : ces règles sont tenues par une dizaine de chemins distincts, chacun pour ses propres
raisons, et rien ne garantissait qu'un onzième les tiendrait.

### Le catalogue — 8 modes, 5 primitives

| Mode | Détermine le paiement par | Primitives distinctives |
|---|---|---|
| F2 | Validation finale | aucun jalon |
| J1 | Jalons pondérés au devis | `devis_lines` |
| J3 | Progression validée | `progressive` |
| J4 | Jalons + retenue 5 % | `retentionRate` |
| S1 | Sous-tâches d'un forfait | `fundingGranularity: upfront` |
| S2-H / S2-J / S2-M | Heures / jours / période validés | `rateUnit`, pas de jalon |

Tout mode se ramène à une combinaison de : `useJalons`, `financingMode`, `jalonsSequential`,
`retentionRate`, `fundingGranularity`. **C'est ce qui garantit qu'ajouter un mode n'ajoute jamais
de chemin de paiement parallèle.**

Cinq modes restent au catalogue sans être proposés (F1, F3, F4, J2, J5), chacun avec son motif
lisible par le client — l'absence est motivée, pas silencieuse.

---

## 3. Invariants financiers

Les dix invariants du §1, et où ils sont tenus :

| # | Invariant | Où |
|---|---|---|
| 1 | `paid <= funded` | `checkBalanceInvariants` + bornes d'émission |
| 2 | `released <= funded` | idem |
| 3 | `refunded <= funded − released − blocked` | `emitContractRefund`, borné par le **disponible** |
| 4 | `payable <= available` | `emitScopedRelease`, sous verrou |
| 5 | Aucun payout sans payable | tout `release` naît d'un `Payable` |
| 6 | Aucun payable exécuté deux fois | `idempotencyKey @unique` + raisonnement en **cible cumulée** |
| 7 | Aucun double crédit webhook | machine à états terminale `pending → confirmed \| failed` |
| 8 | Litigieux reste séquestré | `freeze` neutre dans `netHeldAmount`, retranché du disponible |
| 9 | Retenues séquestrées jusqu'à libération explicite | `retained`, instruction `retention_release` dédiée |
| 10 | Solde résiduel remboursable | cron `residual-refunds` |

### L'identité comptable

```
financé = libéré + remboursé + détenu
détenu  = bloqué + retenu + disponible
disponible = dû au prestataire + restituable au client
```

Asservie après **chaque** étape de chaque scénario dans `golden-rules.e2e.test.ts`.

### L'asymétrie entrant / sortant

La règle la plus importante du registre, et la moins évidente :

| Sens | Compté à partir de | Pourquoi |
|---|---|---|
| Entrant (`hold`) | `confirmed` **seulement** | Un débit transmis n'est pas un encaissement. Le compter autoriserait un paiement contre de l'argent non reçu. |
| Sortant (`release`, `refund`, `retention_release`) | `pending` inclus | Une instruction partie ne doit pas être réémise. |

Les deux branches penchent du même côté : **ne jamais surestimer ce dont on dispose**.

---

## 4. Workflow

```
Client finance → HOLD → webhook signé → séquestre confirmé
                                              ↓
        Travail : jalon · point d'étape · sous-tâche · relevé de présence
                                              ↓
                          VALIDATION (client, ou responsable de chantier)
                                              ↓
                                  PAYABLE (validated)
                                              ↓
                          amount <= available ?  ── non ──→ reste dû, recharge requise
                                              ↓ oui
                                  RELEASE (payable instructed)
                                              ↓
                                     webhook signé
                                              ↓
                                   PAYABLE paid · clôture
```

Chemins particuliers :
- **Silence du client** → acceptation tacite après `acceptanceDeadlineDays` (cron).
- **Contestation** → part reconnue payée, part contestée **gelée** ; arbitrage ultérieur.
- **Médiation** → dégel partiel puis répartition à trois destinations (libérer / rembourser / maintenir bloqué).
- **Fin de mission** → reliquat remboursé au client (cron).

---

## 5. API

Aucune route n'expose une opération modifiant directement un solde : les soldes sont **dérivés**
des instructions.

| Route | Rôle |
|---|---|
| `POST /api/missions/[id]/escrow/hold` | Financement initial |
| `GET`/`POST /api/missions/[id]/escrow/recharge` | Manque et recharge (§13/§18) |
| `GET /api/missions/[id]/escrow/balance` | Compte financier et détail des créances (`payables`) — lisible par les **deux** parties |
| `POST /api/missions/[id]/time-contract/close` | Clôture d'un contrat au temps par le client, reliquat restitué (§22) |
| `GET /api/dashboard/client-payments` | Rubrique « Paiements » du client : séquestre et versements par contrat |
| `GET /api/admin/finance` | Console admin : totaux, identité comptable, anomalies, lignes par contrat (Superviseur, Médiation) |
| `GET /api/admin/finance/operations` · `/payables` | Registre PSP et créances de toute la plateforme, filtrables, paginés |
| `GET /api/admin/finance/contracts/[contractId]` | Fiche financière d'un contrat et gestes disponibles |
| `POST /api/admin/finance/residual-sweep` | Balayage manuel des reliquats (Médiation, justifié, journalisé) |
| `POST /api/admin/finance/payables/[payableId]/reinstruct` | Réinstruction d'un versement dû, typiquement refusé par le PSP (Médiation, justifié, journalisé) |
| `GET /api/admin/finance/psp-journal` | Journal des échanges plateforme ⇄ PSP : instructions sortantes et messages reçus entrelacés, indicateurs |
| `GET /api/admin/finance/psp-journal/exchange?reference=` | Conversation complète autour d'une référence PSP |
| `GET`/`POST /api/missions/[id]/attendance` | Relevés : liste, déclaration |
| `POST /api/missions/[id]/attendance/[id]` | Constat, refus, contestation, arbitrage |
| `GET`/`PATCH /api/missions/[id]/site-manager` | Désignation du responsable de chantier |
| `POST /api/gigs/orders/[orderId]/validate` | Validation de livraison d'une commande Gig |
| `GET`/`POST /api/admin/contracts/[contractId]/refund` | Remboursement du reliquat |
| `GET /api/dashboard/site-manager-summary` | Chantiers et relevés à constater |
| `GET /api/cron/tacit-acceptance` | Acceptation tacite (§19) |
| `GET /api/cron/residual-refunds` | Reliquats (§22) |

---

## 6. Modèle de données

**10 migrations**, toutes additives sauf une (l'unification des registres, qui transfère ses
données avant de supprimer la table).

| Entité | Statut |
|---|---|
| `PspEscrowOperation` | **Généralisée** — registre unique des deux domaines (`sourceType`), 6 types d'instruction |
| `Payable` | **Créée** — créance, 4 statuts, clé d'idempotence métier |
| `PspEventLog` | **Créée** — journal append-only de chaque message reçu du PSP (canal, issue, motif, signature, charge), sans clé étrangère |
| `SpotTimeTerms` | **Créée** — tarif, unité, plafonds, heures sup, responsable |
| `Attendance` | **Créée** — 6 statuts, index unique **partiel** |
| `PrestationContract` | **Étendue** — `fundingGranularity` |
| `Mediation` | **Étendue** — `refundAmount` |
| `Mission`, `Jalon` | **Étendus** — `submittedAt`, statut `remboursee` |
| `GigOrderEscrowOperation` | **Supprimée** — données transférées |

Contraintes en base, et non seulement en code :
- `Payable.idempotencyKey` unique — aucun payable dupliqué ;
- `PspEscrowOperation.pspReference` unique — aucune instruction PSP dupliquée ;
- `PspEscrowOperation_scope_exclusive` — exactement une portée, cohérente avec le discriminant ;
- `Attendance_active_period_key` — index **partiel** : pas deux relevés *actifs* sur la même
  période, mais une journée refusée reste redéclarable.

---

## 7. Tests

**841 tests, 84 fichiers.** Les 23 tests minimaux du §24 sont couverts, plus les tests de
concurrence du §17.

| Fichier | Couvre |
|---|---|
| `golden-rules.e2e.test.ts` | Les deux règles après **chaque** étape, tous modes + 6 états corrompus que le contrôle doit rejeter |
| `payable.e2e.test.ts` | Créance, invariant n°4, insuffisance → recharge, équivalence vue unitaire / agrégée |
| `spot-time.test.ts` | Tous les exemples chiffrés du document, au franc près |
| `spot-time.e2e.test.ts` | Pointage, double pointage, chevauchement, contestation, arbitrage |
| `time-contract.e2e.test.ts` | Génération S2 par la vraie route (`SpotTimeTerms` créés), clôture : refus, remboursement, identité comptable |
| `contract-clauses-temps.test.ts` | Articles 2 et 4 au temps — ni jalons, ni acceptation tacite promise |
| `admin-finance.e2e.test.ts` | Console admin : 5 anomalies détectées, états légitimes ignorés, identité comptable, rôles, justification et audit |
| `workflow-complet.e2e.test.ts` | **Parcours complets par les vraies routes** : F2, J4, S1, S2J (publication → clôture) et médiation, règles d'or après chaque mouvement, console admin, journal PSP, tableaux de bord |
| `workflow-incidents.e2e.test.ts` | **Suite du parcours complet** : J1 (refus PSP puis reprise), J3 paliers, J1 sur devis, S2H (réinstruction admin, gel, insuffisance, recharge et reprise automatique, clôture), S2M, acceptation tacite, mission arrêtée (retenue soldée, remboursement), commande Gig, console et journal |
| `psp-journal.e2e.test.ts` | Journal PSP : appliqué, rejeu, signature invalide/absente, référence inconnue, conflit, canal console ; pagination sans perte ni doublon |
| `site-manager.e2e.test.ts` | Délégation, révocation, prestataire jamais validateur |
| `funding-upfront.e2e.test.ts` | Séquence du §7 (150 000 → 0), séquestre unique |
| `escrow-unification.e2e.test.ts` | Cohabitation des portées, intégrité, garde webhook |
| `tacit-acceptance.*` | Bornes, médiation gelée, `submittedAt` absent |
| `contract-refund` / `residual-refund` / `unfreeze` | Sorties du séquestre |
| `retention-*`, `progressive-release`, `autoconfirm-release` | J3, J4 (préexistants, intacts) |

Concurrence testée : deux validations simultanées, deux libérations simultanées, deux
remboursements simultanés, deux dégels simultanés, double webhook, double clic.

**Vérifications finales du §26** : `vitest run` 841/841 · `tsc --noEmit` 0 erreur ·
`eslint` 0 erreur · `next build` succès (2026-09-15).

---

## 8. Décisions prises

Chacune s'écarte d'une lecture littérale du cahier des charges, pour une raison.

1. **4 statuts de `Payable`, pas 8.** `DRAFT`, `READY_FOR_PAYOUT`, `CANCELLED`, `DISPUTED` n'ont
   aucun producteur. Les créer oblige tout le code à traiter des états qu'aucun chemin n'atteint.
2. **`ESCROW_RETENTION_HOLD` écarté.** La retenue est exactement calculable ; en faire un
   mouvement changerait la sémantique de tous les soldes pour une information déjà disponible.
3. **L'état financier (§3) est DÉRIVÉ, jamais stocké.** Une colonne d'état serait un second point
   de vérité, capable de contredire les mouvements qui la fondent.
4. **`SpotTask` n'existe pas : c'est un `Jalon`.** Ce qui distingue S1 de J1 n'est pas le
   découpage — identique, un test le prouve — mais la **granularité du financement**, devenue une
   cinquième primitive.
5. **S1 « paiement unique » n'a pas été créé** : c'est `GigOrder`, qui existait déjà. Un
   quatrième chemin pour le même forfait aurait été le « deuxième moteur » que le §1 interdit.
6. **`Attendance` est distinct de `CheckInEvent`.** La règle A12 interdit au pointage existant
   d'alimenter une décision de litige ; il est optionnel et purgé à court terme. Un relevé qui
   détermine une rémunération ne peut être ni optionnel, ni purgé.
7. **Le responsable de chantier est désigné par CONTRAT, pas par rôle.** Un pouvoir attaché au
   rôle serait impossible à retirer sans supprimer le compte.
8. **Une seule cause de blocage.** Le §3 distingue « bloquée » et « litigieuse » ; la plateforme
   n'a qu'un mécanisme de gel, et en afficher deux laisserait croire à deux causes.
9. **Montants entiers.** Le XOF n'a pas de sous-unité et le PSP refuse les décimales. Les montants
   *calculés* sont arrondis, les montants *engageants* sont **refusés** s'ils ne sont pas entiers.

---

## 9. Risques résiduels

### Non implémenté, et assumé

| Élément | Pourquoi |
|---|---|
| `settlementFrequency` (§6/§7) | L'unité tarifaire est implémentée, pas la **fréquence de règlement**. Aujourd'hui chaque relevé validé est réglé immédiatement. Un règlement hebdomadaire groupé demande un producteur (qui déclenche la période ?) qui n'existe pas. |
| `Worksite` (§8) | Un relevé est rattaché au contrat, pas à un site. Un chantier physique distinct du contrat n'a pas de producteur : rien ne le crée. |
| Entrée / sortie / pause (§8) | Le relevé porte une **quantité** validée, pas des horodatages. Suffisant pour payer ; insuffisant pour un contrôle horaire fin. |
| Historique des corrections (§9) | Un relevé refusé est redéclaré ; l'ancien reste en base, mais il n'y a pas de journal de modifications. |
| États de journée `PRESENT`/`ABSENT`/`PARTIAL` (§10) | La quantité les exprime (0 = absent, 0,5 = partiel). Des états explicites n'ajouteraient rien au calcul. |
| `startDate`/`endDate`, `approvalRequired` (§7) | Sans producteur : la validation est **toujours** requise, et les dates de mission existent déjà. |
| Audit trail des actions de pointage (§23) | `ContractAuditEntry` et `GigOrderAuditEntry` sont chaînés par hash, mais les validations de relevés n'y écrivent pas. |

### Risques ouverts

1. **PSP réel non branché.** Tout passe par la PSP virtuelle. Le chemin webhook signé est le même,
   mais aucun PSP réel n'a été éprouvé — notamment sur les délais de confirmation et les échecs.
2. **`blocked` borné par `held` en défense.** Les médiations closes *avant* l'existence du dégel
   ont un gel jamais levé. La borne les couvre ; un nettoyage de ces contrats serait plus propre.
3. **11 migrations non commitées** et appliquées à la base de dev uniquement.

### Corrigé le 2026-09-15

| Défaut | Correction |
|---|---|
| S2 publiable mais inexécutable : aucun code hors tests ne créait `SpotTimeTerms` | Tarif et quantité max. saisis à la publication (`Mission.timeRate/timeMaxQuantity`), tarif proposé à la candidature (`MissionProposal.unitRate`), conditions figées à la génération du contrat |
| Contrats au temps sans clôture, reliquat jamais rendu | `closeTimeContract` : refus si relevé en attente ou créance non payée, puis remboursement immédiat |
| Remboursement de médiation inatteignable (`refundAmount` sans écrivain) | `propose` accepte `refundAmount`, borné par le séquestre ; champs dans les deux écrans admin |
| Créances invisibles | Détail des versements dans le compte du séquestre, agrégat « dû / en cours / retenu / gelé » dans le Wallet, rubrique Paiements client |
| Arrondi d'un tarif dérivé d'un plafond négocié | Le relevé qui épuise la quantité convenue solde le plafond (`checkCaps`) |
| Contrat au temps promettant jalons et acceptation tacite | Articles 2 et 4 dédiés (`contract-clauses.ts`) |
| Contrat à jalons sur mission à prix fixe réduit à UN jalon (ligne synthétique de la candidature prise pour un devis) : J4 impossible, jalons saisis ignorés en S1/J1/J3 | Dérivation depuis le devis réservée aux missions `QUOTE` (génération du contrat et aperçu) |
| Fonds gelés invisibles au prestataire sur une mission « remboursée » | Résumé prestataire calculé sur tous ses contrats |
| Créance validée non couverte jamais payée après recharge (relevé de présence déjà validé, aucun geste pour la relancer) | `instructOwedPayables` à chaque confirmation de financement |
| Versement refusé par le PSP : console « à réinstruire » sans geste | `instructOwedPayable` + route et bouton de réinstruction admin |
| Chantier clos automatiquement au plafond pendant une contestation : le solde libéré par l'arbitrage attendait le balayage du lendemain | La clôture d'un contrat au temps déjà clos rend le solde immédiatement ; bouton « Récupérer le solde non consommé » |
| Aucun écran admin des flux ; remboursement et solde de retenue non journalisés | Console `/admin/finance` (`src/lib/admin-finance.ts`) ; justification obligatoire et `AdminAuditLog` sur les deux gestes |
