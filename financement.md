


# 1. Principe général du financement sous séquestre

Le cycle financier devient :

```text
CONTRAT / COMMANDE
        ↓
MONTANT À FINANCER
        ↓
CLIENT FINANCE
        ↓
FONDS EN SÉQUESTRE
        ↓
TRAVAIL / PRÉSENCE / LIVRAISON
        ↓
VALIDATION
        ↓
MONTANT LIBÉRABLE
        ↓
INSTRUCTION PSP
        ↓
PAIEMENT PRESTATAIRE
        ↓
CONFIRMATION PSP
        ↓
MISE À JOUR DU SÉQUESTRE
```

La règle fondamentale est :

```text
Montant payé ≤ Montant effectivement séquestré
```

Et :

```text
Solde séquestre = Fonds déposés
                  − Fonds libérés
                  − Fonds remboursés
                  − Fonds bloqués/litigieux
```

---

# 2. Il faut distinguer financement et libération

C'est le point central.

**Financer** ≠ **payer le prestataire**.

Le client peut par exemple financer :

**455 000 FCFA**

Le système enregistre :

```text
455 000 FCFA
→ séquestre
```

Mais aucun prestataire ne reçoit encore cet argent.

Après validation, une partie devient :

```text
LIBÉRABLE
```

puis :

```text
LIBÉRÉE
```

Cette séparation doit être présente partout dans ton architecture.

---

# 3. Nouveau modèle des statuts financiers

Je recommande un état financier explicite :

```text
NON_FINANCÉ
      ↓
FINANCEMENT_EN_ATTENTE
      ↓
SÉQUESTRÉ
      ↓
PARTIELLEMENT_LIBÉRÉ
      ↓
TOTALEMENT_LIBÉRÉ
      ↓
CLOTURÉ
```

Avec éventuellement :

```text
SÉQUESTRÉ
   ├── PARTIE LIBÉRABLE
   ├── PARTIE BLOQUÉE
   ├── PARTIE LITIGIEUSE
   └── PARTIE REMBOURSABLE
```

---

# 4. Les deux nouveaux modes deviennent simplement deux façons de consommer le séquestre

Je garderais :

### S1 — Spot forfait

Pour par exemple :

* devis direct ;
* réparation ;
* installation ;
* petite prestation ;
* prestation ponctuelle.

### S2 — Spot temps

Pour par exemple :

* artisans ;
* manœuvres ;
* techniciens ;
* maintenance ;
* personnel de chantier.

Mais **les deux utilisent exactement le même moteur de séquestre**.

---

# 5. S1 — Spot forfait entièrement sous séquestre

Exemple :

Le prestataire propose :

> Installation tableau électrique : 150 000 FCFA.

Le client accepte.

### Étape 1

Le contrat est créé :

```text
Montant contractuel : 150 000
```

### Étape 2

Le client doit financer :

```text
150 000 FCFA
```

### Étape 3

Le système attend la confirmation du PSP.

Une fois confirmée :

```text
Séquestre = 150 000
Disponible à la libération = 150 000
Prestataire payé = 0
```

Le travail peut commencer.

---

# 6. Paiement unique S1

À la fin :

```text
Prestataire → soumission
Client → validation
```

Le système crée :

```text
Obligation payable = 150 000
```

Puis :

```text
Séquestre
150 000
     ↓
Instruction PSP
150 000
     ↓
Prestataire
```

Après confirmation :

```text
Séquestre = 0
Prestataire payé = 150 000
```

La prestation est clôturée.

---

# 7. S1 avec sous-tâches

Même principe.

Le devis peut être :

**150 000 FCFA**

avec :

| Sous-tâche   |     Montant |
| ------------ | ----------: |
| Diagnostic   |      20 000 |
| Câblage      |      60 000 |
| Installation |      50 000 |
| Essai        |      20 000 |
| **Total**    | **150 000** |

Mais les 150 000 FCFA sont **séquestrés dès le départ**.

Ensuite :

```text
Tâche 1 validée
→ 20 000 libérables

Tâche 2 validée
→ 60 000 libérables

Tâche 3 validée
→ 50 000 libérables

Tâche 4 validée
→ 20 000 libérables
```

Le séquestre évolue :

```text
150 000
↓
130 000
↓
70 000
↓
20 000
↓
0
```

---

# 8. Attention : les sous-tâches ne doivent pas créer un second séquestre

C'est important pour ton architecture.

Il ne faut pas :

```text
Tâche 1 → nouveau financement
Tâche 2 → nouveau financement
Tâche 3 → nouveau financement
```

mais :

```text
FINANCEMENT INITIAL
      ↓
SÉQUESTRE UNIQUE
      ↓
Tâche 1
Tâche 2
Tâche 3
Tâche 4
```

Les sous-tâches **consomment le séquestre existant**.

---

# 9. S2 — Spot au temps sous séquestre

Ici aussi :

> **on ne paie jamais directement selon le pointage.**

Le pointage produit seulement un **montant exigible**, qui doit être couvert par le séquestre.

---

# 10. Exemple : artisan journalier

Tarif :

**7 500 FCFA / jour**

Contrat maximum :

**20 jours**

Donc le client doit financer :

```text
20 × 7 500 = 150 000 FCFA
```

Les :

**150 000 FCFA**

sont placés sous séquestre avant le démarrage.

---

# 11. Le pointage consomme progressivement le séquestre

Semaine 1 :

4 jours validés.

Montant :

**30 000 FCFA**

Le système fait :

```text
Séquestre initial      150 000
Montant libérable       30 000
Solde séquestre        120 000
```

Après paiement :

```text
Prestataire reçu        30 000
Séquestre restant       120 000
```

---

# 12. S2 horaire

Même logique.

Exemple :

**1 500 FCFA/heure**

Plafond contractuel :

**200 heures**

Financement maximal :

```text
200 × 1 500
= 300 000 FCFA
```

Le client dépose :

**300 000 FCFA**

Le pointage produit :

```text
8 h validées
× 1 500
= 12 000
```

Donc :

```text
12 000 → libérables
288 000 → restent au séquestre
```

---

# 13. S2 mensuel

Même modèle.

Exemple :

**250 000 FCFA / mois**

Le client doit financer le mois :

```text
250 000 FCFA
```

Le séquestre couvre le contrat.

Le pointage permet de calculer :

* présence ;
* absences ;
* journées incomplètes ;
* éventuellement prorata.

Mais **aucun paiement ne dépasse le montant encore disponible sous séquestre**.

---

# 14. La règle de sécurité la plus importante

Pour chaque demande de paiement :

```text
Montant demandé
≤
Montant validé
≤
Montant restant sous séquestre
```

Donc une instruction PSP n'est créée que si :

```text
validatedAmount <= escrowAvailableAmount
```

Sinon :

```text
PAIEMENT_BLOQUÉ
```

---

# 15. Il faut donc introduire une notion de “créance payable”

C'est probablement le meilleur modèle pour ton architecture.

Une validation produit :

```text
Payable
```

par exemple :

```text
PAYABLE #001
Source : Sous-tâche
Montant : 50 000
Statut : Autorisé
```

ou :

```text
PAYABLE #002
Source : Pointage
Période : 01/09 → 07/09
Montant : 37 500
Statut : Autorisé
```

Ensuite :

```text
Payable
   ↓
Contrôle séquestre
   ↓
Instruction PSP
   ↓
Confirmation PSP
   ↓
Payable payé
```

---

# 16. Le séquestre devient le compte financier de la mission

Pour chaque contrat, je recommande une structure comme :

```text
CONTRAT
│
├── Montant contractuel
│
├── Montant financé
│
├── Montant séquestré
│
├── Montant libérable
│
├── Montant libéré
│
├── Montant remboursé
│
├── Montant litigieux
│
└── Solde séquestre
```

Exemple :

```text
Contrat             455 000
Financé             455 000
Séquestré            455 000
Déjà libéré          180 000
Litigieux             20 000
Remboursé              0
Disponible restante  255 000
```

---

# 17. J1/J3/J4 et S1/S2 peuvent alors partager le même moteur

C'est là que ton architecture devient très intéressante.

```text
                    FINANCEMENT
                         │
                         ▼
                    SÉQUESTRE
                         │
         ┌───────────────┼────────────────┐
         │               │                │
        J1              J3               J4
      Jalons         Progression       Retenue
         │               │                │
         └───────────────┼────────────────┘
                         │
                        SPOT
                         │
                ┌────────┴────────┐
                │                 │
               S1                S2
             Forfait            Temps
                │                 │
             Tâches          Pointage
                │                 │
                └────────┬────────┘
                         ↓
                     VALIDATION
                         ↓
                     PAYABLE
                         ↓
                 CONTRÔLE SÉQUESTRE
                         ↓
                       PSP
                         ↓
                    PAIEMENT
```

Cela évite d'avoir six mécanismes financiers différents.

---

# 18. Gestion d'une insuffisance de séquestre

Il faut prévoir ce cas.

Exemple S2 :

Le client a financé :

**100 000 FCFA**

Mais les pointages validés généreraient :

**115 000 FCFA**

Le système doit faire :

```text
100 000 → payables
15 000 → non financés
```

et non :

> envoyer 115 000 au PSP.

Les 15 000 supplémentaires doivent nécessiter :

**un nouveau financement du client**.

Workflow :

```text
Séquestre insuffisant
       ↓
Demande de rechargement
       ↓
Client finance +15 000
       ↓
Séquestre = 15 000
       ↓
Paiement autorisé
```

---

# 19. C'est particulièrement important pour les contrats au temps

Pour les prestations horaires/journalières, je recommande :

### Budget plafond

Exemple :

**500 000 FCFA maximum**

et :

### seuil d'alerte

Par exemple :

**20 % restants**

Le système prévient :

> « Le séquestre disponible ne couvre plus que 4 jours de présence. Veuillez recharger le financement. »

Ainsi le chantier ne s'arrête pas brutalement.

---

# 20. Pointage et séquestre

Le module de pointage devrait donc fonctionner comme ceci :

```text
Entrée
 ↓
Présence enregistrée
 ↓
Sortie
 ↓
Durée calculée
 ↓
Pointage soumis
 ↓
Responsable valide
 ↓
Montant calculé
 ↓
Contrôle séquestre
 ↓
Payable créé
```

Le pointage n'a **aucun pouvoir financier direct**.

---

# 21. Litige

Même logique.

Supposons :

```text
Pointage déclaré : 6 jours
Pointage validé : 4 jours
Pointage contesté : 2 jours
```

Le système doit faire :

```text
4 jours
→ Payable

2 jours
→ Litige
→ bloqués
```

Et surtout :

> **Les montants litigieux restent dans le séquestre.**

C'est précisément l'intérêt de ton modèle.

---

# 22. Remboursement

Le séquestre doit également gérer :

```text
FIN DE CONTRAT
        ↓
Solde séquestre
        ↓
Remboursement client
```

Exemple :

Fin du contrat :

```text
Financé             300 000
Payé                240 000
Solde séquestre      60 000
```

Les 60 000 sont remboursés au client.

Il ne doit jamais rester un « argent fantôme » dans la mission.

---

# 23. Avec une retenue J4

J4 reste compatible avec ce modèle.

Exemple :

```text
Séquestre : 455 000
```

Le dernier jalon produit :

```text
Montant brut : 100 000
Retenue 5 %  :   5 000
Libérable     : 95 000
```

Donc :

```text
95 000 → prestataire
5 000 → reste séquestré
```

Puis la libération finale de retenue :

```text
5 000
→ payable
→ PSP
```

La retenue est donc simplement une **partie du séquestre temporairement non libérable**.

---

# 24. Cela permet aussi de corriger ton problème F7

Avec ce modèle, la médiation ne devrait plus raisonner essentiellement sur :

```text
mission.budget
```

Elle devrait raisonner sur les **fonds effectivement séquestrés et les obligations financières concernées**.

Par exemple :

```text
Mission : 455 000
Séquestre : 455 000

Déjà payé : 250 000
Litigieux : 50 000
Disponible : 155 000
```

Une médiation peut donc décider :

```text
Libérer 30 000
Maintenir 20 000 bloqués
Rembourser 10 000
```

sans toucher arbitrairement au budget contractuel global.

---

# 25. Le modèle financier cible

Je te recommande donc de retenir cette philosophie :

## **UN SEUL MODÈLE DE FINANCEMENT : LE SÉQUESTRE**

Les différents modes ne sont que des **modes de détermination du montant libérable**.

| Mode | Détermine le paiement par    |
| ---- | ---------------------------- |
| J1   | Jalons                       |
| J3   | Progression                  |
| J4   | Jalons + retenue             |
| S1   | Prestation / sous-tâches     |
| S2-H | Heures validées              |
| S2-J | Jours validés                |
| S2-M | Période mensuelle / présence |

Mais financièrement :

```text
TOUS
 ↓
SÉQUESTRE
 ↓
VALIDATION
 ↓
PAYABLE
 ↓
PSP
```

---

# 26. La règle d'or de ton SaaS

Je formaliserais même cette règle dans tes spécifications :

> **Aucune obligation de paiement ne peut être exécutée par la plateforme sans disponibilité préalable des fonds correspondants dans le séquestre. Toute validation de prestation, de sous-tâche, de jalon ou de temps travaillé crée au maximum une créance payable ; elle ne constitue pas à elle seule une autorisation de débit hors séquestre.**

Et une deuxième :

> **Tout montant litigieux, retenu ou non encore validé demeure dans le séquestre jusqu'à une décision autorisant sa libération ou son remboursement.**

C'est, à mon sens, le meilleur socle pour ton moteur financier. Il permet ensuite d'ajouter S1 et S2 sans créer une nouvelle logique de paiement parallèle à J1/J3/J4.



Oui. Je te propose de transformer le principe en **spécification d’implémentation complète**, puis de te donner des prompts directement exploitables dans Cursor/Copilot/Claude Code.

L’objectif est de **ne pas créer un deuxième moteur financier** : J1/J3/J4 et les nouveaux modes Spot doivent tous utiliser le même moteur **Financement → Séquestre → Créance payable → PSP → Confirmation → Clôture**.

## 1. Architecture fonctionnelle cible

Le catalogue devient :

| Code | Mode                  | Logique                        |
| ---- | --------------------- | ------------------------------ |
| F2   | Financement classique | selon le fonctionnement actuel |
| J1   | Jalons                | validation d’un jalon          |
| J3   | Progression           | progression validée            |
| J4   | Retenue               | libération + retenue           |
| S1   | Spot forfait          | prestation directe             |
| S2-H | Spot horaire          | heures validées                |
| S2-J | Spot journalier       | journées validées              |
| S2-M | Spot mensuel          | période mensuelle              |

Mais **financièrement, tous utilisent le même séquestre**.

```text
Client
  ↓
Financement
  ↓
Séquestre
  ↓
Travail / Jalon / Sous-tâche / Pointage
  ↓
Validation
  ↓
Créance payable
  ↓
Contrôle du solde séquestré
  ↓
Instruction PSP
  ↓
Webhook PSP
  ↓
Paiement confirmé
  ↓
Mise à jour séquestre
```

La règle absolue :

```text
PAYMENT_EXECUTED
seulement si
payable.amount <= escrow.available_amount
```

---

# 2. Prompt maître — implémentation complète

Je te conseille de commencer par celui-ci dans ton agent de code.

Tu interviens sur une application SaaS existante de missions, contrats, jalons, financement et séquestre.

OBJECTIF GLOBAL

Implémenter un moteur financier unifié dans lequel TOUS les paiements sortants passent obligatoirement par un financement préalable sous séquestre.

Les modes de financement existants doivent rester compatibles :

* F2
* J1
* J3
* J4

Ajouter :

* S1 = Spot forfait
* S2-H = Spot horaire
* S2-J = Spot journalier
* S2-M = Spot mensuel

IMPORTANT :
Ne crée pas de deuxième moteur financier spécifique aux modes Spot.
Les modes Spot doivent utiliser le même séquestre, les mêmes obligations de paiement, les mêmes contrôles PSP, les mêmes mécanismes d'idempotence, de remboursement, de litige et de clôture.

==================================================

1. RÈGLE FINANCIÈRE FONDAMENTALE
   ==================================================

Aucun paiement prestataire ne doit pouvoir être exécuté si les fonds correspondants n'ont pas été préalablement placés sous séquestre.

Formaliser les invariants :

1. paidAmount <= fundedAmount
2. releasedAmount <= escrowFundedAmount
3. refundedAmount <= escrowFundedAmount - releasedAmount - blockedAmount
4. payableAmount <= availableEscrowAmount
5. aucun PSP payout ne peut être créé sans payable valide
6. aucun payable ne peut être exécuté deux fois
7. aucun webhook PSP ne doit provoquer un double crédit
8. les montants litigieux restent dans le séquestre
9. les montants retenus restent dans le séquestre jusqu'à leur libération explicite
10. tout solde résiduel à la clôture doit être remboursable au client selon les règles du contrat

Ne jamais utiliser le budget contractuel comme substitut du solde réellement séquestré.

==================================================
2. AUDIT AVANT MODIFICATION
===========================

Avant d'écrire du code :

* inspecter le schéma Prisma ;
* inspecter les modèles Mission, PrestationContract, jalons, financements, escrow/séquestre, transactions, PSP ;
* inspecter les routes de financement ;
* inspecter les routes de validation des jalons ;
* inspecter les routes de paiement ;
* inspecter psp-webhook ;
* inspecter le mode psp-virtual ;
* inspecter les fonctions de retenue J4 ;
* inspecter les contrats/clausiers ;
* inspecter les tests existants ;
* identifier les éventuelles fonctions qui utilisent mission.budget pour calculer un paiement ;
* identifier les traitements non idempotents.

Ne pas remplacer ou réécrire inutilement ce qui fonctionne déjà.

Produire d'abord un diagnostic technique court listant :

* modèles existants réutilisables ;
* modèles à modifier ;
* modèles à créer ;
* routes à modifier ;
* routes à créer ;
* risques de migration ;
* points de compatibilité avec J1/J3/J4.

Puis implémenter.

==================================================
3. CONCEPT FINANCIER CENTRAL
============================

Créer ou généraliser une représentation financière permettant de distinguer :

* montant contractuel ;
* montant financé ;
* montant séquestré ;
* montant libéré ;
* montant payé ;
* montant remboursé ;
* montant bloqué ;
* montant litigieux ;
* montant retenu ;
* solde disponible du séquestre.

Le calcul du solde disponible ne doit pas être stocké de façon incohérente avec les mouvements financiers.

Privilégier un ledger / journal financier si l'architecture actuelle le permet.

Chaque mouvement financier doit être traçable.

Exemples de mouvements :

* ESCROW_FUNDING
* ESCROW_RELEASE
* ESCROW_PAYMENT
* ESCROW_REFUND
* ESCROW_RETENTION_HOLD
* ESCROW_RETENTION_RELEASE
* ESCROW_DISPUTE_HOLD
* ESCROW_ADJUSTMENT

Ne jamais modifier silencieusement un montant historique.
Toute correction financière doit générer un mouvement compensatoire ou un audit trail.

==================================================
4. PAYMENT OBLIGATION / PAYABLE
===============================

Introduire ou généraliser une entité métier de type PaymentObligation / Payable.

Elle représente une somme autorisée à être payée après validation métier.

Exemples de sources :

* jalon ;
* progression ;
* sous-tâche Spot ;
* pointage horaire ;
* pointage journalier ;
* période mensuelle ;
* retenue J4.

Un payable doit au minimum contenir :

* id ;
* mission/contrat ;
* sourceType ;
* sourceId ;
* amount;
* currency ;
* status ;
* escrowReference ;
* PSP instruction reference ;
* createdAt ;
* validatedAt ;
* paidAt ;
* idempotencyKey ;
* audit information.

Statuts recommandés :

* DRAFT
* VALIDATED
* READY_FOR_PAYOUT
* PSP_PENDING
* PAID
* FAILED
* CANCELLED
* DISPUTED

Règle :
VALIDATED ne signifie pas automatiquement PAID.

Le système doit vérifier le séquestre avant de créer l'instruction PSP.

==================================================
5. S1 — SPOT FORFAIT
====================

Créer le mode S1.

Cas d'usage :

* prestation ponctuelle ;
* devis direct ;
* installation ;
* réparation ;
* intervention technique ;
* petite prestation.

Workflow :

Demande
→ devis
→ acceptation
→ contrat
→ financement
→ séquestre confirmé
→ prestation
→ validation
→ payable
→ PSP
→ confirmation
→ clôture.

Deux sous-modes fonctionnels :

A. paiement unique

100 % du montant contractualisé est payable après validation finale.

B. paiement par sous-tâches

Le devis peut être découpé en sous-tâches.

Exemple :

Diagnostic : 20 000
Câblage : 60 000
Pose : 50 000
Essais : 20 000
Total : 150 000

Le client finance 150 000 une seule fois.

Chaque sous-tâche validée crée un payable consommant le séquestre existant.

Ne jamais créer un nouveau financement par sous-tâche.

Créer éventuellement :
SpotTask
avec :

* id ;
* contractId ;
* title ;
* description ;
* amount ;
* order ;
* status ;
* validatedAt ;
* payableId ;
* evidence ;
* timestamps.

Statuts :

* TODO
* IN_PROGRESS
* SUBMITTED
* UNDER_REVIEW
* VALIDATED
* REJECTED
* CANCELLED

Règles :

* somme des sous-tâches <= montant du contrat ;
* le total des payables issus des tâches ne peut jamais dépasser le montant financé ;
* une tâche ne doit générer qu'un seul payable effectif ;
* rejet → aucune libération ;
* validation → payable ;
* paiement confirmé → tâche financièrement réglée.

==================================================
6. S2 — SPOT TEMPS
==================

Créer S2 avec trois unités :

S2-H = HEURE
S2-J = JOUR
S2-M = MOIS

Ne pas mélanger unité tarifaire et fréquence de règlement.

Créer deux dimensions :

rateUnit :

* HOUR
* DAY
* MONTH

settlementFrequency :

* WEEKLY
* BIWEEKLY
* MONTHLY
* END_OF_PERIOD
* CUSTOM si nécessaire.

Exemple :
7 500 FCFA / jour
paiement hebdomadaire.

==================================================
7. CONTRAT SPOT TEMPS
=====================

Un contrat S2 doit pouvoir définir :

* rateUnit ;
* rate ;
* currency ;
* maximumQuantity ;
* maximumAmount ;
* startDate ;
* endDate ;
* settlementFrequency ;
* attendanceRequired ;
* overtimeAllowed ;
* overtimeRate ;
* approvalRequired ;
* chantier/site concerné ;
* responsable de validation.

Le plafond financier doit être clair.

Exemple :
7 500 FCFA/jour
20 jours maximum
→ plafond = 150 000 FCFA.

Le client doit financer le plafond ou la période demandée avant que les prestations correspondantes deviennent payables.

==================================================
8. MODULE DE POINTAGE
=====================

Créer un module de pointage chantier.

Entités possibles :

Worksite
Attendance
AttendanceSession
Timesheet
AttendanceApproval

Selon le modèle actuel, réutiliser les entités déjà présentes.

Pointage minimal :

* travailleur ;
* contrat ;
* chantier ;
* date ;
* heure d'entrée ;
* heure de sortie ;
* pause ;
* durée calculée ;
* statut ;
* auteur du pointage ;
* validateur ;
* timestamps ;
* audit.

Statuts :

* OPEN
* SUBMITTED
* APPROVED
* REJECTED
* DISPUTED
* CANCELLED

Le pointage ne doit JAMAIS déclencher directement un paiement.

Il produit un montant calculé.

==================================================
9. POINTAGE HORAIRE
===================

Formule :

validatedHours × hourlyRate = grossPayable

Exemple :
8 h × 1 500 = 12 000 FCFA.

Le système doit :

* empêcher les heures négatives ;
* empêcher les doublons ;
* gérer les chevauchements ;
* appliquer le plafond contractuel ;
* tenir compte des corrections ;
* conserver l'historique des modifications.

==================================================
10. POINTAGE JOURNALIER
=======================

Formule :

validatedDays × dailyRate = grossPayable

Exemple :
4 jours × 7 500 = 30 000 FCFA.

La journée doit pouvoir avoir des états :

* PRESENT ;
* ABSENT ;
* PARTIAL ;
* OVERTIME ;
* DISPUTED.

==================================================
11. PAIEMENT MENSUEL
====================

Pour S2-M :

* définir une période ;
* calculer la présence validée ;
* appliquer éventuellement prorata ;
* générer un payable périodique ;
* bloquer la double génération pour la même période.

Exemple :
Contrat : 250 000 FCFA/mois.
Période : septembre 2026.
Une seule obligation de paiement pour cette période.

Ajouter une contrainte/idempotence basée sur :
contractId + periodStart + periodEnd.

==================================================
12. HEURES SUPPLÉMENTAIRES
==========================

Prévoir :

* overtimeAllowed ;
* overtimeRate ;
* approvalRequired.

Une heure supplémentaire non approuvée ne devient pas payable.

Si elle est approuvée :
overtimeHours × overtimeRate.

==================================================
13. RECHARGE DU SÉQUESTRE
=========================

Si le montant payable dépasse le solde disponible :

NE PAS payer partiellement automatiquement sauf règle métier explicite.

Créer :
ESCROW_INSUFFICIENT

Exemple :
payable = 115 000
escrow available = 100 000

Résultat :

* 100 000 éventuellement autorisables selon la politique choisie ;
* 15 000 non financés.

Prévoir une règle de produit explicite.

Par défaut, je recommande :
aucune instruction PSP tant que le payable complet n'est couvert par le séquestre.

Le client reçoit :
"Financement supplémentaire requis : 15 000 FCFA."

Après nouveau financement :
le payable peut passer à READY_FOR_PAYOUT.

==================================================
14. LITIGES
===========

Un pointage ou une sous-tâche contestée ne doit pas être payé.

Exemple :
6 jours déclarés
4 jours validés
2 jours contestés.

Créer :

* payable pour les 4 jours ;
* montant litigieux pour les 2 jours.

Les fonds litigieux restent dans le séquestre.

La médiation doit travailler sur :

* les obligations financières ;
* les sommes séquestrées ;
* les sommes déjà payées ;
* les sommes bloquées.

Ne plus utiliser aveuglément mission.budget comme montant financier à instruire.

==================================================
15. J4 — RETENUE
================

Conserver le mécanisme J4 existant.

La retenue reste une partie du séquestre.

Exemple :
100 000 brut
5 % retenue
95 000 libérables
5 000 retenus.

La retenue :

* reste séquestrée ;
* ne doit pas être comptabilisée comme payée ;
* ne doit être libérée qu'une seule fois ;
* doit être protégée par idempotence.

Conserver les fonctions pures existantes si elles sont correctes.

==================================================
16. PSP ET IDEMPOTENCE
======================

Toutes les instructions PSP doivent être idempotentes.

Créer une clé métier unique pour chaque paiement.

Exemple :
contractId + payableId.

Le webhook PSP doit :

* retrouver l'instruction ;
* vérifier son état ;
* éviter tout double paiement ;
* être répétable sans modifier deux fois les soldes.

Une confirmation PSP répétée ne doit pas créer un second mouvement.

Une même retenue ne doit jamais produire deux instructions.

==================================================
17. LEDGER ET TRANSACTIONS
==========================

Toutes les opérations financières doivent être atomiques.

Utiliser une transaction DB pour les séquences critiques :

* validation ;
* création du payable ;
* réservation du solde séquestre ;
* création instruction PSP ;
* mise à jour des statuts.

Prévenir les race conditions.

Tester notamment :

deux validations simultanées ;
deux appels PSP simultanés ;
double clic ;
double webhook ;
retry réseau ;
rejeu d'une route.

==================================================
18. REMBOURSEMENT
=================

À la fin du contrat :

escrowRemaining > 0

→ créer remboursement client selon les règles.

Ne jamais laisser un solde orphelin.

Le remboursement doit lui aussi être idempotent.

==================================================
19. ACCEPTATION TACITE
======================

Auditer le problème existant :

acceptanceDeadlineDays est présent au contrat mais aucune route n'applique actuellement la règle des 7 jours.

Ne pas laisser le contrat promettre une acceptation tacite que le système n'applique pas.

Soit :
A. implémenter la règle automatique ;
soit
B. supprimer la promesse du contrat.

Choisir la solution cohérente avec le produit existant et adapter contrat + backend + tests.

==================================================
20. MÉDIATION
=============

Corriger le modèle actuel dans lequel la médiation instruit mission.budget.

La médiation doit manipuler les montants financiers réellement concernés :

* payable ;
* escrow amount ;
* blocked amount ;
* disputed amount ;
* released amount ;
* refunded amount.

Ne jamais libérer un montant supérieur au solde séquestré.

==================================================
21. API
=======

Créer ou adapter les routes nécessaires.

Prévoir au minimum des endpoints conceptuels pour :

S1 :

* création prestation Spot ;
* création sous-tâches ;
* financement ;
* soumission ;
* validation ;
* rejet ;
* création payable.

S2 :

* création contrat temps ;
* création chantier ;
* entrée ;
* sortie ;
* correction pointage ;
* soumission pointage ;
* validation pointage ;
* génération payable ;
* consultation solde séquestre ;
* recharge.

Escrow :

* financer ;
* consulter ;
* consulter solde disponible ;
* consulter mouvements ;
* remboursement ;
* payables ;
* paiement.

Ne pas exposer au frontend une opération permettant de modifier directement les soldes financiers.

==================================================
22. FRONTEND
============

Créer les écrans nécessaires.

Côté client :

* financement sous séquestre ;
* solde du séquestre ;
* montant consommé ;
* montant restant ;
* payables ;
* historique ;
* pointages ;
* validation ;
* litiges ;
* demande de recharge.

Côté prestataire :

* devis ;
* tâches ;
* tâches validées ;
* montant gagné ;
* montant en attente ;
* montant payé ;
* pointages ;
* historique des paiements.

Côté responsable chantier :

* équipe ;
* présence ;
* entrée/sortie ;
* validation ;
* anomalies ;
* corrections.

Côté admin :

* escrow ;
* mouvements ;
* payables ;
* PSP ;
* litiges ;
* audits ;
* remboursements.

==================================================
23. AUDIT TRAIL
===============

Toute action financière ou ayant un impact financier doit être traçable :

* auteur ;
* rôle ;
* date ;
* ancienne valeur ;
* nouvelle valeur ;
* raison ;
* IP/session si le système le permet ;
* référence métier.

==================================================
24. TESTS
=========

Ajouter des tests unitaires, intégration et E2E.

Minimum :

1. financement S1 ;
2. financement S2 ;
3. paiement unique S1 ;
4. sous-tâches S1 ;
5. plusieurs tâches ;
6. dépassement du montant séquestré ;
7. pointage horaire ;
8. pointage journalier ;
9. pointage mensuel ;
10. correction pointage ;
11. doublon pointage ;
12. heures supplémentaires ;
13. litige ;
14. remboursement ;
15. double webhook ;
16. double paiement ;
17. double validation ;
18. J4 ;
19. libération retenue ;
20. clôture ;
21. acceptation tacite ;
22. médiation ;
23. concurrence / race condition.

Invariant principal :

Fonds financés = fonds libérés/payés + fonds remboursés + fonds toujours séquestrés, selon la représentation comptable retenue.

Ajouter des assertions fortes sur cet invariant.

==================================================
25. MIGRATION ET COMPATIBILITÉ
==============================

Les contrats existants ne doivent pas casser.

Toute migration doit être additive lorsque possible.

Les anciens contrats doivent conserver leur comportement historique.

Ne jamais supprimer ou renommer un champ utilisé par le code existant sans migration complète et tests.

==================================================
26. LIVRABLE FINAL
==================

À la fin :

* migrations Prisma ;
* modèles ;
* services financiers ;
* services Spot ;
* service pointage ;
* service escrow ;
* service payable ;
* intégration PSP ;
* webhooks ;
* routes ;
* frontend ;
* tests ;
* documentation.

Produire un document :
IMPLEMENTATION_SPOT_ESCROW.md

avec :

* architecture ;
* règles métier ;
* invariants financiers ;
* workflow ;
* API ;
* modèle de données ;
* tests ;
* décisions prises ;
* risques résiduels.

Avant de conclure :

* npm test / suite équivalente ;
* typecheck ;
* lint ;
* build production.

Ne pas déclarer l'implémentation terminée si un test financier critique échoue.

---

# 3. Prompt spécifique pour le modèle de données

Je te conseille ensuite de faire travailler ton agent sur la base de données séparément. Cela réduit fortement le risque qu'il commence à coder les routes avec un modèle financier mal défini.

Travaille uniquement sur la modélisation financière et Prisma du système suivant.

OBJECTIF

Créer une architecture financière unifiée basée exclusivement sur le séquestre.

Les modes :

* F2
* J1
* J3
* J4
* S1
* S2-H
* S2-J
* S2-M

doivent utiliser la même infrastructure financière.

Avant toute modification :

* inspecte schema.prisma ;
* identifie les modèles existants liés aux missions, contrats, financements, escrow, transactions, paiements, PSP, jalons et utilisateurs ;
* réutilise les modèles existants lorsqu'ils conviennent.

CONCEPTS À MODÉLISER

1. EscrowAccount / EscrowBalance
2. EscrowTransaction / LedgerEntry
3. PaymentObligation / Payable
4. SpotTask
5. SpotTimeContract ou extension de PrestationContract
6. Worksite
7. Attendance / Timesheet
8. PaymentInstruction
9. RefundInstruction si nécessaire
10. DisputeFinancialHold si nécessaire

RÈGLES :

* aucune dépense hors séquestre ;
* aucune double libération ;
* aucune double instruction PSP ;
* aucune double confirmation webhook ;
* tout mouvement financier est immuable ;
* les corrections passent par des mouvements compensatoires ;
* les litiges restent séquestrés ;
* les retenues restent séquestrées ;
* les remboursements ne dépassent jamais le solde disponible.

PAYABLE

Le payable doit permettre d'indiquer :

* mission ;
* contrat ;
* sourceType ;
* sourceId ;
* montant ;
* devise ;
* statut ;
* escrowAccount ;
* idempotencyKey ;
* instruction PSP ;
* timestamps.

SPOT TASK

Créer une structure pour :

* titre ;
* description ;
* montant ;
* ordre ;
* état ;
* preuve ;
* validation ;
* payable.

POINTAGE

Modéliser :

* chantier ;
* travailleur ;
* contrat ;
* date ;
* entrée ;
* sortie ;
* pause ;
* durée ;
* statut ;
* validation ;
* contestation ;
* audit.

CONTRAT TEMPS

Prévoir :

* unité tarifaire ;
* tarif ;
* plafond quantité ;
* plafond financier ;
* période ;
* fréquence de règlement ;
* heures supplémentaires ;
* taux supplémentaire ;
* validation obligatoire.

CONTRAINTES

Ajouter autant que possible des contraintes DB utiles pour :

* idempotence ;
* unicité payable par source ;
* unicité période mensuelle ;
* unicité retenue ;
* unicité instruction PSP.

MIGRATION

Les données existantes doivent rester compatibles.

Les anciens contrats ne doivent pas être obligés de passer en Spot.

Créer une migration additive et sûre.

LIVRABLES

* modification schema.prisma ;
* migration Prisma ;
* seed minimal si nécessaire ;
* documentation du modèle financier ;
* test d'intégrité des relations ;
* tests des contraintes d'unicité.

Ne touche pas encore aux écrans frontend.
Ne modifie pas inutilement les routes métier.

---

# 4. Prompt pour le moteur Spot S1

Implémente uniquement le mode S1 — SPOT FORFAIT sur le moteur financier sous séquestre existant.

PRINCIPE

Un client accepte un devis direct.

Le montant total du devis doit être financé et placé sous séquestre avant que la prestation puisse générer un paiement.

Deux variantes :

1. paiement unique ;
2. paiement par sous-tâches.

PAIEMENT UNIQUE

Workflow :

devis
→ acceptation
→ contrat
→ financement
→ confirmation séquestre
→ prestation
→ soumission
→ validation client
→ payable
→ contrôle solde séquestre
→ PSP
→ confirmation PSP
→ clôture.

SOUS-TÂCHES

Permettre de découper le devis en tâches financières.

Exemple :
20 000 + 60 000 + 50 000 + 20 000 = 150 000.

La somme des tâches doit être exactement égale au montant du contrat pour un devis entièrement fractionné.

Le financement reste unique :
150 000 sous séquestre.

Chaque tâche validée produit un payable.

Une tâche ne peut produire qu'un seul paiement réussi.

Le rejet d'une tâche n'entraîne aucun paiement.

Les modifications après financement doivent suivre des règles strictes :

* augmentation → nouveau financement ;
* diminution → remboursement du surplus selon règles métier ;
* modification d'une tâche déjà payée interdite ou compensée séparément.

Créer les services métier nécessaires.

Tester :

* financement obligatoire ;
* validation ;
* paiement ;
* plusieurs tâches ;
* dépassement séquestre ;
* double validation ;
* double webhook ;
* remboursement ;
* clôture.

---

# 5. Prompt pour le module artisans/manœuvres

Implémente le mode S2 — SPOT TEMPS exclusivement sur le moteur de séquestre existant.

Créer :

S2-H = horaire
S2-J = journalier
S2-M = mensuel

PRINCIPE

Le client finance à l'avance un plafond ou une période.

Les heures/jours/mois validés deviennent des payables.

Le pointage ne paie jamais directement.

WORKFLOW :

contrat
→ plafond financier
→ financement
→ séquestre confirmé
→ pointage
→ validation
→ calcul montant
→ payable
→ contrôle séquestre
→ PSP
→ confirmation
→ mise à jour solde.

POINTAGE CHANTIER

Créer ou réutiliser :

* chantier ;
* travailleur ;
* entrée ;
* sortie ;
* pause ;
* présence ;
* validation ;
* contestation ;
* correction.

Pour chaque pointage conserver un historique.

Prévoir les statuts :
OPEN
SUBMITTED
APPROVED
REJECTED
DISPUTED
CANCELLED

S2-H :

validatedHours × hourlyRate.

S2-J :

validatedDays × dailyRate.

S2-M :

génération d'un payable unique par période contractuelle.

Prévoir :

* heures supplémentaires ;
* taux supplémentaire ;
* validation obligatoire ;
* plafond quantité ;
* plafond montant ;
* absence ;
* journée partielle ;
* correction ;
* contestation.

GESTION DU SÉQUESTRE

Si payable > solde séquestre :
ne pas créer d'instruction PSP complète.

Afficher :
"Financement supplémentaire requis".

Prévoir recharge du séquestre.

LITIGE

Exemple :
6 jours déclarés ;
4 validés ;
2 litigieux.

Résultat :
4 jours → payable
2 jours → montant bloqué dans le séquestre.

INTERDIRE :

* double pointage ;
* deux sorties pour une entrée ;
* chevauchement de présence ;
* double payable d'une même journée ;
* double paiement ;
* paiement hors séquestre.

Prévoir tests unitaires + intégration + E2E.

---

# 6. Prompt final d'audit financier

Après l'implémentation, je te recommande fortement de lancer **un dernier agent uniquement en audit**, sans lui demander de modifier le code immédiatement.

Tu es maintenant auditeur financier et architecte logiciel.

N'ajoute aucune fonctionnalité au début.
Inspecte l'implémentation complète du moteur de financement sous séquestre.

Objectif :
détecter toute possibilité de créer, libérer, payer, rembourser ou déplacer des fonds de façon incohérente.

VÉRIFIE :

1. aucun paiement sans financement préalable ;
2. aucun paiement > solde séquestre ;
3. aucun double paiement ;
4. aucun double webhook ;
5. aucun double remboursement ;
6. aucune double libération de retenue ;
7. aucune somme litigieuse payée ;
8. aucun payable sans source métier valide ;
9. aucun payable dupliqué ;
10. aucun calcul financier basé uniquement sur mission.budget ;
11. aucune race condition sur le solde ;
12. transactions DB atomiques ;
13. idempotence PSP ;
14. cohérence des remboursements ;
15. cohérence des clôtures ;
16. cohérence entre contrat et code ;
17. acceptation tacite réellement appliquée ou retirée du contrat ;
18. compatibilité J4 ;
19. compatibilité J1/J3 ;
20. compatibilité S1 ;
21. compatibilité S2-H/J/M ;
22. cohérence des arrondis monétaires.

VÉRIFIE LES INVARIANTS :

# funded

released
+
refunded
+
blocked
+
available

Et selon le modèle ledger retenu :

# contractAmount

payments
+
refunds
+
escrowRemaining
+
authorizedOutstanding

Ajuste les formules au modèle réel et explique toute différence.

FAIS UN TEST DE CONCURRENCE :

* deux validations simultanées ;
* deux appels de paiement simultanés ;
* webhook répété ;
* retry PSP ;
* double clic ;
* deux workers concurrents.

LIVRABLE :

Produire un rapport :

P0 = risque financier critique
P1 = risque important
P2 = problème fonctionnel
P3 = amélioration

Pour chaque problème :

* fichier ;
* fonction ;
* scénario ;
* impact financier ;
* correction recommandée ;
* test à ajouter.

Ne modifie le code qu'après avoir identifié les risques.

---

## 7. Ordre dans lequel je te conseille d'exécuter ces prompts

Ne lance pas les cinq prompts simultanément.

L'ordre optimal est :

**1. Audit initial + Prompt maître**
→ compréhension de l'existant.

**2. Prompt Prisma / modèle financier**
→ stabiliser la base.

**3. S1 Spot forfait**
→ paiement direct + sous-tâches.

**4. S2 Spot temps**
→ pointage + artisans/manœuvres.

**5. Audit financier final**
→ recherche de failles et race conditions.

Et surtout, **ne supprime pas le fonctionnement actuel de J1/J3/J4 pendant l'implémentation**. Les nouveaux modes doivent se brancher sur le moteur séquestre existant, pas le remplacer.

### Architecture finale recommandée

```text
                         ┌──────────────┐
                         │   CONTRAT    │
                         └──────┬───────┘
                                ↓
                         ┌──────────────┐
                         │ FINANCEMENT  │
                         └──────┬───────┘
                                ↓
                         ┌──────────────┐
                         │   SÉQUESTRE  │
                         └──────┬───────┘
                                ↓
       ┌────────────┬───────────┼────────────┬────────────┐
       ↓            ↓           ↓            ↓            ↓
      J1           J3          J4           S1           S2
    Jalon      Progression   Retenue     Forfait        Temps
                                             ↓          ↓
                                           Tâches    Pointages
       └────────────┬───────────┬────────────┴───────────┘
                    ↓           ↓
                 VALIDATION   LITIGE
                    ↓           ↓
                 PAYABLE      BLOQUÉ
                    ↓
             CONTRÔLE SÉQUESTRE
                    ↓
              INSTRUCTION PSP
                    ↓
             CONFIRMATION PSP
                    ↓
               LEDGER FINANCIER
                    ↓
         ┌──────────┴──────────┐
         ↓                     ↓
      PAYÉ                    REMBOURSÉ
```


