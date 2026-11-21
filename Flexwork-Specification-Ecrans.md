# Flexwork — Spécification des écrans (Annonce → Clôture)

**Date :** 11 novembre 2026
**Source :** adaptation de `AnnoncePro-Recapitulatif-Architecture.md` au produit Flexwork
**Mission d'exemple :** Création d'une boutique en ligne pour cosmétiques à Cotonou
**Prix d'exemple :** 450 000 XOF (prix du devis accepté)

**Légende**
- La route indiquée sous chaque écran est la page Flexwork existante.
- **🔲 À créer** : élément repris d'AnnoncePro qui n'existe pas encore dans Flexwork.

---

## 1. Principe directeur

Une annonce = un ou plusieurs engagements. Un engagement = un contrat = un séquestre = des jalons (ou un paiement unique).

Aucune étape ne se débloque tant que la précédente n'est pas verrouillée. L'argent ne bouge que sur une validation.

**Règle d'or :** le client finance, le PSP (prestataire de paiement agréé) détient les fonds, le prestataire exécute, le client valide, la plateforme transmet l'instruction de libération. **Flexwork ne détient jamais les fonds** : il n'existe ni solde interne, ni dépôt, ni retrait.

## 2. Acteurs et rôles

### Client
Publie l'annonce, compare les devis, retient un ou plusieurs prestataires, contre-signe le contrat, finance le séquestre via le PSP, valide les jalons, peut ouvrir une médiation et laisse un avis.

### Prestataire
Candidate avec un devis, négocie, signe le contrat en premier, soumet ses preuves de livraison, reçoit ses paiements sur son compte de versement Mobile Money vérifié, peut ouvrir une médiation et laisse un avis.

### Responsable de chantier (mode OPR, facultatif)
Désigné par le client. Il apprécie les preuves, constate l'avancement, puis transmet au client, qui seul prononce la validation définitive.

### Admin
- **Admin KYC** : instruit les identités et les comptes de versement.
- **Admin Médiation** : propose une résolution. Il ne tranche jamais.
- **Admin Finance** : surveille le registre du séquestre.

## 3. Chronologie des écrans

### 0. Mes missions
Route : `/client/missions`

- **Indicateurs :** Total, En cours, En révision (en attente de validation), Livrées.
- **Filtres :** Toutes, Ouvertes, En cours, En révision, Livrées, Annulées, avec un compteur sur chacun. Recherche par mot-clé.
- **Liste :** Mission, Freelance, Montant, Statut, Progression, Action (Voir).
  - Tableau sur ordinateur, cartes sur mobile.
- **Contenu d'une ligne :**
  - Type : « Annonce · 1/2 retenus » ou « Engagement ».
  - Échéance : J-X, Demain ou Fermée.
  - Progression pondérée par le montant des jalons.
- **Badges de statut :** Ouverte, N Propositions, En cours, En révision, Livrée, Close.
- **🔲 À créer :** indicateur « Montant sous séquestre » (somme des séquestres actifs).
- **🔲 À créer :** bouton « Publier une mission » dans l'en-tête de la liste.
- Sans objet dans Flexwork : les boutons Déposer et Retirer (aucun solde à déposer ni à retirer, voir §4 et §5).

### 1. Publier une mission
Route : `/missions/new`

Tunnel en 4 étapes, avec brouillon restauré automatiquement (« Brouillon restauré — vous reprenez où vous en étiez »).

- **Étape 1 — Décrire :**
  - Titre, description, cahier des charges (facultatif).
  - Catégorie → Métier → Compétences.
  - Type de professionnel et niveau requis (Indifférent possible).
  - Prestataires recherchés (1 à N, chacun aura son propre contrat).
  - Urgence (Normale ou Urgente).
- **Étape 2 — Lieu et dates :**
  - Mode : Présentiel, À distance ou Hybride.
  - Pays, ville, quartier.
  - Date de début souhaitée, durée estimée (jours).
  - Matériel : fourni par le client, à la charge du prestataire, mixte ou non précisé.
  - Mode de vérification et de validation : Moi-même, ou OPR / responsable de chantier.
- **Étape 3 — Rémunération :**
  - Modèle de contrat :
    - **Prix fixe** : le client fixe le montant.
    - **Au temps** : tarif par unité, plafond séquestré, mode de pointage.
    - **Devis** : budget indicatif min/max et nombre de tours de négociation.
  - Le découpage en jalons **n'est pas saisi par le client** : il est proposé par le prestataire dans son devis, et une ligne du devis = un jalon.
- **Étape 4 — Récapitulatif :** relecture de toutes les rubriques, puis « Prochaines étapes » : recevoir des propositions, comparer les devis, choisir et signer.
- **Durée de publication :** 7, 14, 21 ou 30 jours. Elle fixe la date limite de candidature.
- **Publication et KYC :**
  - Un visiteur non connecté est d'abord identifié (connexion par code ou inscription).
  - La vérification d'identité n'est pas exigée pour publier.
  - Un client non vérifié qui clique « Publier » voit sa mission enregistrée en brouillon. Elle se publie en un clic dès qu'il est vérifié.
- Sans objet : le récapitulatif « Budget + Commission 8 % + Montant escrow ». Le modèle de commission de Flexwork est « À définir » (page `/tarifs`), donc aucune commission n'est affichée.

### 2. Page publique de la mission
Route : `/missions/[id]` (vue visiteur ou prestataire)

- **En-tête :** titre, badge, budget (ou fourchette indicative en mode Devis), délai, palier de risque, mention « Assurance obligatoire » si exigée.
- **Description de la mission :** domaine, profil recherché, rémunération, vérification, financement, pointage, mode de paiement (« Prix fixe ou par jalons — proposé par le prestataire dans son devis »).
- **Bouton « Candidater à cette mission » :**
  - Champs : prix proposé, délai en jours (facultatif), message (facultatif).
  - En mode Devis, le prestataire est dirigé vers la saisie du devis détaillé (`/missions/[id]/devis`).
- Un prestataire non vérifié voit sa candidature enregistrée, avec le message « en attente de la vérification de votre identité » et un bouton « Vérifier mon identité ».
- **🔲 À créer :** profil client avec ses avis.
- **🔲 À créer :** côté client, compteurs de vues et de candidatures.
- Sans objet : la timeline des jalons. Les jalons ne sont connus qu'à la réception des devis.

### 3. Candidatures et devis reçus
Route : `/missions/[id]/proposals` (client)

- **Filtres :** Toutes, En négociation, Devis validé, Refusée, Contrat signé.
- **Tableau :** Artisan, Soumission, Montant TTC, Délai, Paiement (fixe ou jalons), Statut, Actions.
  - Exemple : Aïcha Bello (420 000 XOF, 14 j), Marc Dossou (450 000 XOF, 12 j), Grace Adé (390 000 XOF, 18 j).
- **Actions :** Voir le devis (aperçu détaillé : lignes, Qté, PU HT, Total HT, TVA, Total TTC, échéances, pièces jointes), Voir profil, Accepter, Proposer une révision, Rejeter (motif obligatoire).
- **Négociation :**
  - En plusieurs tours, dans la limite fixée à la publication.
  - L'historique des versions du devis est conservé.
  - Le prestataire ne peut resoumettre que si le client a demandé une révision.
- **Statuts d'une candidature :** Envoyée, Présélectionnée, En négociation, Devis validé, Acceptée, Refusée, Annulée (nombre de tours atteint ou expiration).
- **Pour retenir un prestataire, le client doit avoir une identité vérifiée.** Un bandeau l'indique dès l'arrivée sur la page.
- **🔲 À créer :** bouton « Présélectionner » (étoile). Le statut `preselectionnee` existe en base, mais aucun écran ne permet de le poser.
- **🔲 À créer :** comparateur de 2 à 3 devis côte à côte.
- **🔲 À créer :** bouton « Ouvrir le chat » depuis la carte du candidat (la messagerie existe, mais pas ce raccourci).

### 4. Choix du prestataire
Route : `/missions/[id]/proposals` (acceptation du devis)

- **Confirmation :** rappel du prix et du délai du devis, du découpage en jalons, puis « Générer et signer le contrat ».
- **Le contrat reprend le prix et le délai du devis accepté**, pas le budget publié. Si Marc Dossou est retenu à 450 000 XOF, ses lignes de devis (Maquette 120 000, Développement 210 000, Mise en ligne et formation 120 000) deviennent les trois jalons.
- **Plusieurs prestataires recherchés :** chaque prestataire retenu obtient un **engagement**, c'est-à-dire une mission enfant avec son propre contrat. Le message affiché est « Vous pouvez retenir encore N prestataires ».
- **Candidatures non retenues :** elles sont refusées **à la clôture de l'annonce** (date limite de candidature), pas au moment du choix.

### 5. Contrat de prestation
Route : `/missions/[id]/contract`

- **Visionneuse :** document au format PDF.
  - Contenu : parties, mission, prix, délai, jalons et montants, mode de financement (« Avec ce mode : … »), retenue de garantie éventuelle, conditions de validation et délai d'acceptation tacite, médiation.
  - Mention « Contrat de prestation de services — Outil généré par Flexwork ».
- **Avertissement assurance :** affiché si le prestataire n'a déclaré aucune assurance de responsabilité civile professionnelle.
- **Consentements :**
  - « J'ai lu et j'accepte l'ensemble des termes du présent contrat ».
  - Pour le client : « J'ai compris et je choisis ce prestataire en pleine connaissance de cause ».
- **Ordre des signatures : le prestataire signe en premier, puis le client contre-signe.**
  - Côté client, avant la signature du prestataire : « Étape 1/2 — en attente de la signature du prestataire ».
  - Après la signature du prestataire : le client dispose de **48 h** pour contre-signer. Passé ce délai, le contrat est annulé sans pénalité.
- **Signature électronique :** certificat personnel (RSA) protégé par phrase secrète, horodatage, empreinte et QR de vérification, journal d'audit du contrat. La double signature verrouille le document.
- Tant que le contrat n'est pas doublement signé, le financement est impossible. Après double signature, le statut passe à **Contrat signé**.

### 6. Financement du séquestre
Route : `/missions/[id]/escrow`. Voir §4 pour le détail.

- **Message affiché :** « Paiement sous séquestre — Flexwork ne détient jamais les fonds. »
- **Contrat sans jalon :** bouton « Payer et séquestrer les fonds » pour le prix total.
- **Contrat à jalons :** pour chaque jalon, bouton « Financer ce jalon » et bouton « Scinder » (découper un jalon en sous-jalons dont la somme reste égale).
- **Panneau « Compte du séquestre »** (il remplace la carte Wallet d'AnnoncePro) :
  - Montant du contrat, Vous avez financé, Déjà versé au prestataire, Vous a été remboursé, Encore sous séquestre, Reconnu dû au prestataire, Retenue de garantie, Gelé par une médiation, Non encore engagé.
- **État du séquestre :** Non financé, Financement en attente, Fonds sous séquestre, Partiellement libéré, Totalement libéré, Clôturé.

### 7. Espace mission et suivi
Route : `/missions/[id]` (client), `/missions/[id]/deliverable` (prestataire)

- **Stepper du contrat :** Contrat → Signature → Financement → Pilotage → Clôture.
- **Tableau des jalons** (il remplace le Kanban d'AnnoncePro, puisque chaque jalon est une unité de paiement). Statuts affichés :

  | Côté client | Côté prestataire |
  |---|---|
  | En attente de financement | Non démarré |
  | Financé — en attente du prestataire | Financé — prêt pour le livrable |
  | À valider | Livrable soumis, en attente du client |
  | Rejeté — en attente de resoumission | Rejeté — à resoumettre |
  | Validé — libération en cours | Validé — libération en cours |
  | Payé | Payé |

- **Jalons séquentiels :** un jalon peut être affiché « Verrouillé — en attente de la validation du jalon précédent ».
- **Côté prestataire :** bouton « Soumettre preuve » (fichiers, photos, vidéo, géolocalisation, note), déclaration de progression (0 à 100 %), historique des preuves et validations partielles, avis du client sur chaque preuve.
- **Côté client :** messagerie intégrée avec le prestataire, historique.
- **🔲 À créer :** une vue Kanban des sous-tâches internes à un jalon, si on veut garder ce suivi d'organisation du travail.

### 8. Validation par le client
Route : `/missions/[id]` (vue « Validation Client »)

- **Relecture :** aperçu de chaque preuve du lot courant. Le client apprécie chaque preuve (conforme ou non conforme avec motif), puis constate l'avancement (le taux ne peut jamais redescendre).
- **Actions :**
  - **Valider — 120 000 XOF.** N'est possible que lorsque l'avancement constaté atteint 100 %.
  - **Rejeter la preuve** (motif) : une nouvelle preuve est demandée au prestataire.
  - **Validation partielle** : point d'étape confirmé à moins de 100 %, sans libération de fonds.
  - **Ouvrir une médiation** (voir écran 10).
- **Mode OPR :** le responsable de chantier vérifie d'abord, puis « Enregistrer et transmettre au client ». Le client ne peut valider qu'un livrable transmis.
- **Acceptation tacite :** sans contestation dans le délai prévu au contrat (**7 jours par défaut**, à partir de la soumission), le jalon est considéré comme accepté et libéré.
- **🔲 À créer :** rappels au client avant l'acceptation tacite (par exemple 48 h et 24 h avant l'échéance) et affichage du compte à rebours.

### 9. Libération du paiement
Route : `/missions/[id]/escrow` et Wallet du prestataire (`/dashboard/<rôle>/wallet`). Voir §5 pour le détail.

- **Côté client, après validation :** message « Jalon validé — 120 000 XOF en cours de libération ».
  - En mode J4 (retenue de garantie de 5 %), le message devient « 114 000 XOF libérés, 6 000 XOF retenus en garantie ».
- **Statut d'un paiement :** Due — attend un financement, Versement en cours, Versée (côté client) ou Reçue (côté prestataire), Refusée par le PSP — sera reprise.
- **Exemple de déroulé :** Jalon 1 Payé — 120 000 XOF ; Jalon 2 Financé ; Jalon 3 En attente de financement.
- **🔲 À créer :** reçu et facture téléchargeables pour chaque libération.

### 10. Médiation
Route : `/missions/[id]/mediation` (parties), `/admin/disputes` (Admin)

- **Médiation facultative. La plateforme ne tranche pas.**
- **Ouverture :**
  - Par le client **ou** par le prestataire, avec un motif de contestation.
  - Seulement sur une mission engagée et non terminée. Une seule médiation ouverte à la fois.
- **À l'ouverture :** les fonds réellement sous séquestre sont **gelés** chez le PSP, et la mission passe en « Médiation en cours ».
- **Proposition de l'Admin Médiation :** montant à libérer au prestataire, montant à rembourser au client (le reste demeure gelé) et justification obligatoire.
- **Exécution :** la résolution ne s'exécute **qu'acceptée par les deux parties**. En cas de refus ou de retrait, la mission reprend son statut d'avant la médiation.
- **Écran :** motif, issue, proposition de résolution en attente, boutons Accepter et Refuser.
- **🔲 À créer :** une phase de négociation directe entre les parties avant la médiation (propositions de correction, de réduction ou d'annulation partielle). L'arbitrage imposé par l'Admin d'AnnoncePro, lui, est sans objet dans Flexwork.

### 11. Clôture et avis
Route : `/missions/[id]/reviews`

- **Avis :** client et prestataire se notent mutuellement (1 à 5) avec un commentaire facultatif. Un seul avis par partie et par mission.
- **🔲 À créer :** page récapitulative de clôture (« Mission terminée », montant total payé, durée réelle).
- **🔲 À créer :** bouton « Republier une mission similaire » (dupliquer l'annonce en brouillon).
- Note : la page des avis n'est rattachée à aucune user story (commentaire dans le code). Elle est à valider avec le PO.

## 4. Financement du séquestre via le PSP (client)

Objectif : le client finance le séquestre en Mobile Money, sans carte bancaire, **directement chez le PSP**.

**Ce qui change par rapport à AnnoncePro**
- Il n'y a pas de dépôt sur un solde Flexwork, donc pas de « solde disponible » côté client.
- Le financement se fait **par jalon** (« Financer ce jalon ») ou **en une fois** (contrat sans jalon, ou financement initial que les jalons consomment, mode S1).

**Parcours**
1. **Financer :** sur `/missions/[id]/escrow`, cliquer « Payer et séquestrer les fonds » ou « Financer ce jalon ».
2. **Autoriser chez le PSP :** le client est dirigé vers l'écran de paiement du PSP (en développement : `/psp-sandbox/payer`, qui affiche Marchand, Montant à payer, Référence PSP, Moyen de paiement, Statut).
   - **Le code PIN se saisit sur le téléphone, à la demande de l'opérateur, jamais dans Flexwork.**
3. **Confirmation :** le PSP confirme (webhook) et le statut passe à « Fonds sous séquestre ». Le stepper avance à Pilotage.

**En cas d'échec ou de coupure**
- Message : « Connexion interrompue : vérifiez votre réseau, puis réessayez. Un financement déjà transmis ne sera pas débité deux fois. »
- Si un financement est déjà en cours : « Un financement est déjà en cours d'autorisation — attendez sa confirmation avant d'en relancer un. »

**Financement complémentaire** (bouton de recharge du « Compte du séquestre ») : il sert quand un montant validé n'est plus couvert, par exemple sur un contrat au temps.

**🔲 À créer :** historique des financements côté client (date, opérateur, montant, statut, référence PSP). Le registre existe déjà côté Admin.

## 5. Versement au prestataire (Mobile Money)

Objectif : le prestataire reçoit chaque paiement jalon par jalon, directement sur son compte Mobile Money.

**Ce qui change par rapport à AnnoncePro**
- Il n'y a pas de bouton « Retirer » ni de montant à choisir.
- Chaque libération est **versée automatiquement** par le PSP sur le compte de versement vérifié.
- Rien à approuver par l'Admin au moment du versement.

**Prérequis — compte de versement** (route `/kyc/financier`, lancé depuis le Wallet)
- Opérateur : MTN Mobile Money, Moov Money ou Celtiis Cash.
- Numéro au format international (+229…).
- Nom du titulaire, saisi (il peut différer de celui du prestataire).
- Justificatif de domicile.
- **Statuts :** Non renseigné, En attente d'instruction, Vérifié, Rejeté.
- Un prestataire peut signer et exécuter sans compte vérifié, mais **aucun versement ne part tant que le compte n'est pas vérifié**.

**Wallet du prestataire** (`/dashboard/<rôle>/wallet`)
- Revenus totaux et montant reçu ce mois-ci.
- Carte « Compte de versement » avec son badge de statut.
- Bloc « Ce qui t'est dû » :
  - Reconnu dû (validé, couvert par le séquestre).
  - Versement en cours.
  - Retenue de garantie (versée au dernier jalon).
  - Gelé par un litige.
- Bandeau : « X XOF validés attendent un complément de financement du client ».
- Indicateurs : reçus sur 30 jours, missions terminées.

**🔲 À créer :** historique des versements (date, mission, jalon, montant, opérateur, statut, référence PSP).

## 6. Espace Admin

Visible uniquement par les comptes Admin, avec un accès selon le rôle Admin.

- **Paiements** (`/admin/paiements`) : registre unique du séquestre (missions et commandes Gig).
  - Indicateurs : Financé, Sous séquestre, En attente PSP, Échecs (30 j), Fonds détenus, Fonds gelés, Versé aux prestataires, Remboursé aux clients, Dû au prestataire, Retenue de garantie.
  - Contrôle « Identité comptable vérifiée : financé = versé + remboursé + détenu ».
  - Anomalies à traiter : créance non couverte, reliquat sur mission close (avec « Balayer les reliquats »).
  - Tableau par contrat : Mission, État, Financé, Versé, Remboursé, Détenu, Gelé / retenu, Non couvert, Dernier mouvement. Recherche par mission, partie ou identifiant.
- **Finance** (`/backoffice/finance`) : synthèse versé / libéré / remboursé / détenu, répartition **par canal**, sommes dues par statut, opérations PSP en cours, anomalies.
- **Litiges** (`/admin/disputes`) : médiations ouvertes, sans proposition, en attente d'accord, fonds au séquestre. Pour chaque médiation : Mission, Motif, Ouvert par, Ouvert le, Proposition, et action « Proposer une résolution ».
- **Comptes de versement** (`/admin/kyc/versements`) : instruction des dossiers financiers (opérateur, numéro, titulaire, justificatif), avec « Vérifier » ou « Rejeter » (motif).
- **Missions et utilisateurs** (`/admin/missions`, `/admin/utilisateurs`) : supervision.
- **🔲 À créer :** graphique des flux par opérateur (MTN / Moov / Celtiis) avec filtres 7 j / 30 j / Tout.
- **🔲 À créer :** export CSV des registres.
- **🔲 À créer :** recherche globale.
- Sans objet : les actions Geler / Dégeler manuelles et Approuver / Refuser un retrait. Les gels suivent les médiations et les versements sont automatiques.

## 7. Éléments visuels permanents

- **Deux indicateurs de progression coexistent aujourd'hui :**
  - le bandeau de suivi en 6 phases (Offre & Candidature → Signature → Financement Escrow → Pilotage Jalons → Clôture, plus Litige en rouge), en tête de `/missions/[id]` et `/missions/[id]/deliverable` ;
  - le stepper en 5 étapes (Contrat → Signature → Financement → Pilotage → Clôture), sur la page contrat uniquement.
  - Aucun des deux n'est cliquable. Voir §8.3 pour l'unification proposée.
- Badge d'état du séquestre visible sur les pages Séquestre et Validation.
- Historique des preuves et validations, visible par les deux parties. Le journal d'audit du contrat est consultable.
- **Notifications existantes :** candidature reçue, contrat à signer, fonds sous séquestre, livrable soumis, validation à faire, paiement libéré, médiation ouverte.
- **Avatars :** photo de profil, ou initiales à défaut.
- **Couleurs Flexwork :**
  - Bleu nuit `#0A1931` : marque et texte principal.
  - Orange `#FF7A00` : action principale.
  - Vert `#008751` : argent, séquestre, validé, payé.
  - Ambre : en attente.
  - Rouge `#B91C1C` : médiation, gelé, refusé.

## 8. Reprises du prototype AnnoncePro

**Source :** prototype cliquable `Prototype+Marketplace+Escrow+11-2/App.tsx` (12 écrans, rôles Client / Prestataire / Admin, données fictives).

On en reprend **l'enchaînement des écrans et quelques composants**, jamais la logique métier : wallet, dépôt, retrait, saisie du PIN et arbitrage imposé par l'Admin restent exclus (voir §4 à §6).

### 8.1 Comparaison des transitions

Pour chaque action : où elle mène dans le prototype, où elle mène dans Flexwork aujourd'hui, et ce qu'on retient.

| # | Action | Prototype → destination | Flexwork aujourd'hui → destination | À retenir pour Flexwork |
|---|---|---|---|---|
| T1 | Publier la mission | Modale « Confirmer la publication ? » → **page publique** de la mission | → `/client/missions?publiee=<id>`, avec un bandeau de confirmation | ✅ Garder. Ajouter « Voir l'annonce publiée » dans le bandeau. |
| T2 | Ouvrir une mission depuis la liste | Carte : « Ouvrir la mission » **et** « Candidatures » | Ligne : « Voir » → `/missions/[id]` | 🔲 Ajouter un second bouton « Candidatures (N) » → `/missions/[id]/proposals` tant que l'annonce est ouverte. |
| T3 | Prestataire : envoyer une candidature | Modale → écran Candidatures | Message de confirmation, puis après 1,2 s → « Mes candidatures » | ✅ Garder (Flexwork est meilleur : le prestataire ne voit pas l'écran du client). |
| T4 | Client : consulter les candidatures | « Voir les candidatures » / « Comparer les profils » depuis la page publique | « Voir les devis reçus » / « Voir les propositions » → `/missions/[id]/proposals` | ✅ Garder. 🔲 Ajouter l'entrée « Comparer » (§8.2). |
| T5 | Choisir un prestataire | Choix → écran **récapitulatif du choix** (prix, jalons, délai) → « Passer au contrat » ; retour possible « Changer de prestataire » | Acceptation du devis → après 1,2 s → `/missions/[id]/contract` | 🔲 Reprendre le **récapitulatif avant contrat** avec « Changer de prestataire ». Le choix engage un contrat : une confirmation avec retour en arrière évite les erreurs de clic. |
| T6 | Signatures | Les deux signatures sur un même écran ; « Aller au financement » grisé tant qu'il manque une signature | Prestataire signé, client pas encore → **tableau de bord** du prestataire. Client contre-signe → **automatiquement** `/missions/[id]/escrow` | ✅ Garder (Flexwork est meilleur : ordre imposé, chaque rôle va là où il a quelque chose à faire). |
| T7 | Financer | « Payer et séquestrer » → **directement le Suivi** | « Payer et séquestrer les fonds » → page PSP → « Revenir à la mission » → `/missions/[id]/escrow`. **Aucun bouton vers l'étape suivante.** Sans redirection PSP → tableau de bord. | 🔲 Après confirmation, afficher sur la page séquestre « Fonds sous séquestre — Suivre la mission → » vers `/missions/[id]`. Remplacer la redirection vers le tableau de bord par un retour sur la page séquestre. |
| T8 | Prestataire : soumettre un livrable | Soumission → écran **Validation** (celui du client) | Reste sur `/missions/[id]/deliverable` : « Livrable soumis avec succès ! » | ✅ Garder Flexwork. |
| T9 | Client : écran sans rien à valider | « Aucun livrable en attente » + bouton « Aller au Suivi » | Vue Validation sans action proposée | 🔲 Pour chaque état vide, un message et un bouton vers ce qui débloque la suite (voir §8.3, principe 2). |
| T10 | Client : valider un jalon | Validation → écran **Paiement** (timeline des libérations) | → **`/client/dashboard`**, même s'il reste des jalons à suivre | 🔲 **Rester sur la mission**, avec un message « Jalon validé — X XOF en cours de libération » et la timeline des paiements à jour. Le renvoi au tableau de bord fait perdre le fil à chaque jalon. |
| T11 | Client : demander une correction | Commentaire obligatoire → le jalon revient « En cours » | Rejet de la preuve avec motif → reste sur la vue | ✅ Équivalent. |
| T12 | Ouvrir une médiation | Bouton « Ouvrir un litige » sur l'écran de Validation → **centre de litige** | **Aucun lien dans l'application** vers `/missions/[id]/mediation` : on ne l'atteint qu'en tapant l'URL | ✅ **Fait (11/11/2026).** Le bandeau de suivi propose « Signaler un désaccord — médiation » aux deux parties quand le statut le permet, et « Voir la médiation » quand elle est ouverte. |
| T13 | Clôture → avis | Clôture → page **« Mission terminée »** avec notation des deux parties | Le bandeau dit « Merci de laisser un avis », mais **le client n'a aucun lien** (sa vue Validation remplace la page qui porte ce bouton). Le prestataire n'a ce bouton que **sur ordinateur**. | ✅ **Fait (11/11/2026).** « Donner un avis » dans le bandeau de suivi, pour les deux parties, sur mobile comme sur ordinateur, dès que la mission est validée. |
| T14 | Après la clôture | « Republier une mission similaire » ou « Retour à Mes annonces » | Rien | 🔲 Les deux boutons sur la page de clôture (§8.2). |
| T15 | Navigation libre | Stepper global cliquable vers **n'importe quel** écran | Deux indicateurs de progression non cliquables | 🔲 Stepper unique cliquable, limité aux étapes **déjà atteintes** (§8.3). Ne pas reprendre l'accès libre du prototype, qui permet de financer sans contrat signé. |

### 8.2 Éléments d'écran repris

| Élément | Écran Flexwork | Ce qu'on reprend du prototype | Ce qu'on adapte |
|---|---|---|---|
| **Comparateur de candidats** | 3. Candidatures | Bouton « Comparer » / « Masquer le comparatif » ; tableau par critère, un candidat par colonne : prix, délai, note, missions réalisées, compétences | Critères Flexwork : Montant TTC, délai, mode de paiement (fixe ou jalons), nombre de lignes du devis, KYC validé, assurance déclarée. |
| **Présélection** | 3. Candidatures | Bouton étoile « Shortlister / Shortlisté », compteur « N présélectionné(s) • N refusé(s) » en tête | Pose le statut `preselectionnee`, qui existe déjà en base. |
| **Chat depuis la carte** | 3. Candidatures | « Ouvrir le chat » sur chaque carte, dans un panneau latéral | Utilise la messagerie existante. |
| **Récapitulatif du choix** | 4. Choix | Avatar, note, missions, délai, jalons et montants ; « Changer de prestataire » / « Passer au contrat » ; mention « les autres candidats passeront en Non retenu » | Mention Flexwork : « refusés à la clôture de l'annonce » (et non tout de suite). |
| **Récapitulatif en direct** | 1. Publier | Colonne de droite qui se met à jour pendant la saisie (titre, lieu, mode, catégorie, montant) | Sans commission ni découpage en jalons. |
| **Encadré « Pourquoi le séquestre ? »** | 6. Financement | Quatre étapes illustrées : vous payez → fonds bloqués → livraison et validation → libération | Formulation Flexwork : « le PSP détient les fonds, Flexwork ne les détient jamais ». |
| **Montant manquant sur le bouton grisé** | 6. Financement | « Il manque X FCFA » au lieu d'un bouton simplement grisé | S'applique au financement complémentaire du séquestre. |
| **Checklist de validation** | 8. Validation | Liste de points à cocher par jalon avant « Valider » | Points fixés **au devis** (critères de réception d'une ligne), pas inventés au moment de la validation. Indicative : ne bloque pas la validation. |
| **Compte à rebours de l'acceptation tacite** | 8. Validation | Encadré « Auto-validation » avec barre de temps restant | Délai réel du contrat (7 jours par défaut). Le bouton « Envoyer un rappel » du prototype devient un rappel automatique (voir écran 8). |
| **Timeline des paiements** | 9. Libération | Une ligne par jalon (Validé / En validation / En attente) avec le montant, et une barre « Payé X / Y » | Statuts Flexwork : Payé, Versement en cours, Due — attend un financement. Pas de commission déduite. |
| **Reçu** | 9. Libération | « Reçu téléchargeable » avec numéro, mission, prestataire, montant libéré | Référence PSP et retenue de garantie éventuelle. |
| **Zone de preuves de la médiation** | 10. Médiation | Pièces listées (captures, livrables, échanges) et « Ajouter une preuve » | Alimente les champs `clientElements` / `providerElements` qui existent déjà. |
| **Propositions types** | 10. Médiation | Boutons de proposition : correction, réduction, annulation partielle | Pour la phase de négociation directe (« à créer », écran 10). |
| **Page de clôture** | 11. Clôture | « Mission terminée », durée réelle, montant total payé, notation des deux parties, « Republier une mission similaire », « Retour à Mes missions » | Republier = dupliquer l'annonce en **brouillon**, pas la republier directement. |
| **Indicateurs d'accueil** | 0. Mes missions | Cartes de chiffres en tête, dont « En séquestre », et bouton principal « Créer une annonce » | Pas de bouton Déposer / Retirer. |

### 8.3 Principes de navigation retenus

1. **Après chaque action réussie, l'utilisateur arrive là où il a la suite à faire**, avec un message de confirmation. Jamais le tableau de bord par défaut quand la mission continue (voir T7 et T10).
2. **Un écran vide dit pourquoi et mène à ce qui le débloque**, sur le modèle de « Aucun livrable en attente — Aller au Suivi » (voir T9).
3. **Un stepper unique, cliquable, sur toutes les pages de mission engagée.** On fusionne les deux indicateurs actuels. Seules les étapes atteintes sont cliquables. La phase Litige reste distincte, en rouge.
   - ✅ **Fait en partie (11/11/2026)** : les phases sont maintenant définies à un seul endroit (`src/lib/mission-phases.ts`), et le bandeau de suivi comme la page `/chronologie` les utilisent. La chronologie compte désormais 16 étapes : validation et paiement par jalon, et médiation en branche facultative. Reste à faire : fusionner avec le stepper de la page contrat (`src/lib/contract-stepper.ts`, 5 cases) et rendre le stepper cliquable.
4. **Une barre de contexte persistante** sous le stepper : statut de la mission et état du séquestre (badge), comme le bandeau « Mission : … • Escrow : … » du prototype.
5. **Un bouton désactivé dit ce qui manque**, par exemple « Il manque X FCFA » ou « En attente de la signature du prestataire ».
6. **Raccourcis croisés** : chat depuis une candidature ; médiation et avis depuis le bandeau de suivi.

**À ne pas reprendre :**
- l'accès libre à toutes les étapes ;
- le changement de rôle dans l'interface ;
- les flèches de Kanban qui valident un jalon ;
- l'envoi du prestataire sur l'écran de validation du client.

### 8.4 Ordre de mise en œuvre proposé

1. **Trous de navigation** (T12 médiation, T13 avis) : sans eux, deux écrans existants sont inaccessibles.
2. **Continuité après action** (T7, T10) et **états vides** (T9).
3. **Stepper unique cliquable et barre de contexte** (§8.3, principes 3 et 4).
4. **Écran Candidatures** : comparateur, présélection, chat (T2, T4, T5).
5. **Clôture, reçu, compte à rebours, checklist** (T13, T14).
