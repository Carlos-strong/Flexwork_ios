# AnnoncePro - Recapitulatif Architecture Marketplace avec Escrow

**Date :** 11 novembre 2026
**Lieu de reference :** Abomey-Calavi, Benin
**Mission d'exemple :** Creation d'une boutique en ligne pour cosmetiques a Cotonou
**Budget d'exemple :** 450 000 FCFA
**Commission plateforme :** 8%

---

## 1. Principe directeur

Une annonce = Une mission = Un contrat = Un escrow = Des jalons.

Aucune etape ne se debloque tant que la precedente n'est pas verrouillee. L'argent ne bouge que si les deux parties ont valide.

Regle d'or : Le client finance, la plateforme sequestre, le prestataire execute, le client valide, la plateforme libere.

## 2. Acteurs et roles

### Client
Poste la mission, choisit le prestataire, signe le contrat, finance l'escrow via Mobile Money, valide les jalons, laisse un avis.

### Prestataire
Candidate, negocie, signe le contrat, execute les taches, soumet les livrables, retire ses gains vers Mobile Money, laisse un avis.

### Admin / Plateforme
Arbitre, gere l'escrow, suit les depots et retraits, tranche les litiges, gere les commissions, supervise les missions.

## 3. Architecture technique

**Frontend :** Application web responsive, tableau de bord par role, messagerie integree, visionneuse de contrat, Kanban de suivi, Wallet Mobile Money.

**Backend :** API missions, candidatures, contrats, taches, paiements, litiges, notifications, audit.

**Base de donnees :**
- users (id, role, nom, telephone, operateur mobile money)
- missions (id, titre, description, budget, statut, client_id)
- candidatures (id, mission_id, prestataire_id, prix, delai, message, statut)
- contracts (id, mission_id, contenu, signature_client, signature_prestataire, dates)
- milestones_tasks (id, mission_id, titre, livrable, montant, date, statut)
- escrow_transactions (id, mission_id, montant, statut, operateur)
- deposits (id, user_id, operateur, numero, montant, frais, net, statut, transaction_id)
- withdrawals (id, user_id, operateur, numero, montant, frais, net, statut, transaction_id)
- disputes (id, mission_id, niveau, motif, decision)
- reviews (id, mission_id, note_client, note_prestataire)
- messages, audit_log, notifications

**Paiement :** Compte sequestre separe du compte de la plateforme. Operateurs Benin : MTN MoMo, Moov Money, Wave, Celtiis Cash. Carte bancaire et virement en alternative.

**Securite :** Signature electronique horodatee, journal d'audit de chaque action, pieces jointes pour chaque tache, KYC leger avant premier paiement, validation du numero +229.

## 4. Chronologie des 11 ecrans

### 0. Mes annonces
Centre de commande. Cartes par mission avec titre, badge statut colore, budget, nombre de candidatures, barre de progression. Filtres par statut, recherche, bouton Creer une annonce, bouton Deposer (Client) et Retirer (Prestataire). Stats : missions actives, candidatures, montant en escrow.

### 1. Creer une mission
Formulaire en 3 etapes avec sauvegarde brouillon.
- Etape A : Titre, categorie, description, photos/fichiers, lieu, presentiel ou a distance.
- Etape B : Decoupage en jalons. Exemple : Jalon 1 Maquette 120 000 FCFA, Jalon 2 Developpement 210 000 FCFA, Jalon 3 Mise en ligne et formation 120 000 FCFA. Chaque jalon a livrable, date, montant.
- Etape C : Budget total, delai, criteres de selection, date limite de candidature.
- Recap en direct a droite : Budget + Commission 8% + Montant escrow.

### 2. Page publique de la mission
Grande zone titre, badge, budget en fourchette, description, timeline des jalons, profil client avec avis, bouton Postuler. Cote Client : compteur de vues (248) et candidatures (3).

### 3. Candidatures recues
Liste en cartes : Aicha Bello (4.9, 32 missions, 420 000 FCFA, 14 jours), Marc Dossou (4.8, 27 missions, 450 000 FCFA, 12 jours), Grace Ade (4.7, 19 missions, 390 000 FCFA, 18 jours). Actions : Voir profil, Shortlister (etoile), Refuser, Ouvrir le chat, Comparer 2 a 3 profils cote a cote.

### 4. Choix du prestataire
Modale de confirmation : rappel du prix, jalons, delai, bouton Passer au contrat. Les autres candidats passent en Non retenu avec notification automatique. Negociation possible avant de figer le contrat.

### 5. Contrat Client et Prestataire
Visionneuse de contrat style PDF avec parties, mission, jalons, montants, delais, conditions de validation, conditions de litige, frais. Cases CGU. Deux signatures : Client signe en premier, puis Prestataire. Chaque signature est horodatee et verrouille le document. Tant que les deux n'ont pas signe, le bouton Financer reste grise. Apres double signature : statut Contractualisee.

### 6. Financement via Escrow + Depot Mobile Money
Carte Wallet : Montant total, Commission, Montant bloque en escrow, Montant a payer.
Voir section 5 pour le detail du depot Mobile Money.

### 7. Espace mission / Suivi des taches
Stepper de progression en haut : Contrat signe, Finance, En cours, En validation, Paye. Kanban a 4 colonnes : A faire, En cours, Soumise pour validation, Validee. Chaque carte tache : livrable, fichier joint, date, commentaires. Chat de mission integre, historique des actions, bouton Soumettre un livrable (Prestataire), bouton Demander une modification (Client).

### 8. Validation des taches par le Client
Page de relecture du livrable avec apercu du fichier, checklist du jalon, et 3 boutons : Valider, Demander une correction (commentaire obligatoire), Ouvrir un litige. Regle d'auto-validation : si pas de reponse sous 72h, jalon Valide automatiquement apres rappels a 24h et 48h.

### 9. Liberation du paiement + Retrait Prestataire
Timeline de paiement : Jalon 1 Valide - 110 400 FCFA debloques (montant moins commission), Jalon 2 En attente, Jalon 3 En attente. Barre de progression. Recu telechargeable, facture, avis a laisser.
Voir section 6 pour le detail du retrait.

### 10. Gestion des litiges
Page dediee avec 3 niveaux :
- Niveau 1 Negociation : 48h de discussion directe, propositions : correction, reduction, annulation partielle.
- Niveau 2 Mediation : Plateforme propose une solution, fonds geles.
- Niveau 3 Arbitrage Admin : Admin examine preuves, messages, livrables, et decide : Liberer, Rembourser partiellement, Rembourser totalement.
Visuels : statut, timeline, zone de preuves, proposition en cours, boutons Accepter la proposition ou Escalader.

### 11. Cloture et avis
Page recap : Mission terminee, montant total paye, duree reelle, boutons Laisser un avis (etoiles + commentaire, double evaluation) et Republier une mission similaire.

## 5. Depot pour financement via Mobile Money (Client)

Objectif : Permettre au Client de financer l'escrow par petits montants, sans carte bancaire.

**Carte Wallet Client :** Solde disponible, Montant total a sequestrer 450 000 FCFA, Barre de progression Depot effectue X / 450 000 FCFA, Montant restant a deposer.

**Parcours en 4 etapes :**
1. Choisir l'operateur : MTN MoMo, Moov Money, Wave, Celtiis Cash. Carte selectionnee mise en surbrillance.
2. Numero Mobile Money : champ +229, validation 8 chiffres, message d'erreur si invalide, bouton Enregistrer le numero.
3. Montant du depot : champ montant + boutons rapides 50 000, 100 000, 150 000, 450 000 FCFA. Affichage frais Mobile Money (1%) et montant net recu. Depot partiel autorise : on peut deposer 150 000 puis completer plus tard.
4. Confirmation : Recap Operateur + Numero + Montant brut + Frais + Net. Bouton Confirmer le depot qui ouvre une modale de simulation USSD : message "Vous allez recevoir une demande sur votre telephone - Composez *880# ou validez sur votre mobile", champ Code PIN / Code de confirmation a 4 chiffres, bouton J'ai valide sur mon telephone. Apres validation : ecran de succes avec numero de transaction (ex: MM-2026-874512), recu, bouton Retour a l'escrow.

**Historique des depots :** Date, Operateur, Numero, Montant, Frais, Statut (Reussi, En attente, Echoue), ID transaction.

**Regle de deblocage :** Quand solde depose >= 450 000 FCFA, bouton Utiliser le solde pour financer l'escrow devient vert, passe l'escrow a Sequestre, affiche confirmation Fonds sequestres, debloque le suivi. Si solde < total, bouton grise avec texte Il manque X FCFA.

## 6. Retrait Prestataire vers Mobile Money

Objectif : Permettre au prestataire de recuperer ses gains jalon par jalon, directement sur son mobile.

**Carte Wallet Prestataire :** Solde disponible a retirer (jalons valides moins commission, ex: 110 400 FCFA apres Jalon 1), Solde en attente (jalons non valides), Total deja retire. Barre de progression des paiements liberes.

**Parcours en 4 etapes :**
1. Choisir l'operateur de retrait : MTN MoMo, Moov Money, Wave, Celtiis Cash.
2. Numero de retrait : champ +229 avec validation 8 chiffres, numero enregistre reutilise si deja saisi.
3. Montant du retrait : champ montant + boutons Tout retirer, 50 000, 100 000 FCFA. Affichage frais de retrait, montant net recu, message d'erreur si montant > solde disponible ou si solde = 0.
4. Confirmation : Recap Operateur + Numero + Montant brut + Frais + Net + Delai estime (Immediat / quelques minutes). Bouton Confirmer le retrait qui ouvre modale : "Entrez votre code PIN a 4 chiffres pour confirmer le retrait". Apres validation : ecran succes avec ID (ex: RET-2026-932145), montant net, operateur, solde mis a jour.

**Historique des retraits :** Date, Operateur, Numero, Montant brut, Frais, Net, Statut (Reussi, En cours, Echoue), ID transaction.

**Regle de securite :** Retrait possible uniquement si au moins un jalon est Valide dans l'ecran Validation. Sinon bandeau En attente de validation du client et bouton grise. Quand un jalon est valide, le solde disponible augmente automatiquement.

## 7. Tableau de bord Admin

Visible uniquement en mode Admin, onglet Admin - Vue d'ensemble.

**KPI :** Total depots Mobile Money, Total en escrow bloque, Total libere aux prestataires, Total retraits, Commissions plateforme, Missions actives, Litiges ouverts.

**Graphique :** Barres depots vs retraits par operateur (MTN MoMo, Moov Money, Wave, Celtiis). Filtres 7 jours, 30 jours, Tout.

**Tableau Depots :** Date, Mission, Client, Operateur, Numero, Montant, Frais, Statut, ID. Filtres par operateur et statut + recherche par mission ou numero.

**Tableau Escrows :** Mission, Client, Prestataire, Montant total, Montant sequestre, Montant libere, Montant restant, Statut escrow (Sequestre, Partiellement libere, Libere, Gele). Actions : Voir details (panneau lateral avec detail des 3 jalons), Geler / Degeler, Voir litige.

**Tableau Retraits :** Date, Prestataire, Operateur, Numero, Montant brut, Frais, Net, Statut, ID. Actions : Approuver (si En cours), Refuser.

**Section Litiges ouverts :** Mission, Montant en jeu, Niveau (Negociation / Mediation / Arbitrage), boutons Voir et Trancher (Liberer / Rembourser partiellement / Rembourser totalement) qui mettent a jour le statut de l'escrow.

**Actions Admin :** Exporter CSV simule, Actualiser, Recherche globale.

## 8. Moteur Escrow - Regles metier

- Statuts escrow : En attente, Sequestre, Partiellement libere, Libere, Gele pour litige, Rembourse.
- Validation d'un jalon = deblocage du montant de ce jalon moins commission.
- Dernier jalon valide = solde libere.
- Fonds geles pendant un litige : aucun retrait possible tant que l'Admin n'a pas tranche.
- Annulation avant financement : remboursement integral au Client.
- Annulation apres financement mais avant demarrage : remboursement moins frais fixes, selon contrat.
- Annulation en cours : repartition au prorata des jalons valides + decision Admin si litige.

## 9. Statuts - Machines a etats

**Mission :** Brouillon > Publiee > En selection > Contractualisee > Financee > En cours > En validation > Terminee / En litige > Payee / Annulee.

**Tache / Jalon :** A faire > En cours > Soumise > Validee / A corriger.

**Depot :** En attente > Reussi / Echoue.

**Retrait :** En cours > Reussi / Echoue.

## 10. Elements visuels permanents

- Stepper global en haut de chaque page de mission.
- Badge statut escrow toujours visible.
- Timeline d'audit : Qui a fait quoi et quand, visible par les deux parties.
- Notifications : Candidature recue, contrat a signer, fonds recus, livrable soumis, validation a faire, paiement debloque, litige ouvert, depot confirme, retrait confirme.
- Avatars par initiales, couleurs : Violet profond pour la marque, Emeraude pour l'argent/escrow, Orange pour attente, Rouge pour litige/echoue, Vert pour valide/reussi.

## 11. Prochaines etapes proposees

1. Valider le prototype cliquable avec 2-3 utilisateurs reels (1 Client, 1 Prestataire).
2. Brancher une vraie API Mobile Money (MTN MoMo API, Moov Money) en mode sandbox puis production.
3. Ajouter KYC et verification du numero Mobile Money par OTP.
4. Ajouter export comptable (CSV, recus PDF) pour l'Admin.
5. Tester le parcours litige complet avec un cas reel.

---

**Prototype :** AnnoncePro - 11 ecrans + Depot Mobile Money + Retrait Prestataire + Dashboard Admin.
**Fichiers :** Ce recapitulatif en .md et en .pdf.
