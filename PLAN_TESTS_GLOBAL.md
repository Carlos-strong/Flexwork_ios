# Plan de tests global — parcours de toutes les fonctionnalités Flexwork

> Objet : dérouler l'application de bout en bout, rôle par rôle, et vérifier chaque fonctionnalité
> au moins une fois — parcours nominal, garde-fous et cas limites. Rédigé le 2026-11-02, sur la
> branche `feat/admin-architecture` (politique KYC par étape et versements conditionnés inclus).
>
> Le modèle de paiement (fixe / jalons / temps choisi au devis) a son plan détaillé :
> [PLAN_TESTS_MODELE_PAIEMENT.md](PLAN_TESTS_MODELE_PAIEMENT.md). Ce plan-ci y renvoie au lieu de le
> recopier.

Légende de la colonne **Auto** : ✅ couvert par un test automatisé (fichier indiqué ; « nav. » = test
navigateur Playwright, dossier `e2e/`) · 🖐 test manuel (écran) · ❌ à automatiser.

---

## 0. Préparation

### 0.1 Environnement

| Élément | Réglage |
|---|---|
| Base | Base de **recette** dédiée, jamais `flexwork_dev` ni la base de tests automatisés (`npm run test:db:prepare`) |
| PSP | PSP virtuelle activée, **sans** `ESCROW_STUB_AUTOCONFIRM` : chaque paiement se confirme à la main dans `/psp-sandbox` |
| Drapeau PSP | `psp_montage_valide` activé pour la zone `BJ` (Admin superviseur → feature flags) |
| E-mails / SMS | Boîte de capture (OTP, notifications) consultable par le testeur |
| Navigateurs | Chrome + Safari ; un mobile réel (≈ 375 px) pour les parcours client et prestataire |
| Horloge | Pour les crons, appel direct des routes `/api/cron/*` avec le secret, plutôt qu'attendre l'échéance |

Avant chaque campagne : `npx vitest run` doit être vert (131 fichiers, 1525 tests au 2026-11-02).
Ce plan vérifie ce que la suite automatisée ne voit pas : les écrans, l'enchaînement réel, les
e-mails, et le comportement sur mobile.

Tests navigateur (« nav. ») : `npx playwright test`, dans le Chrome installé, sur la base dédiée
`flexwork_browser_test` (préparation et serveur : voir playwright.config.ts). Le projet `mobile`
joue V-01 en 375 px ; tous les autres cas tournent dans le projet `desktop`.

### 0.2 Comptes de test

| Compte | Rôle | État KYC | Compte de versement | Sert à |
|---|---|---|---|---|
| CLI-V | client | vérifié | — | Parcours nominaux client |
| CLI-A | client | en attente | — | Publication non vérifiée, plafond antifraude |
| CLI-R | client | rejeté | — | Publication bloquée |
| PRE-D | expert_digital | vérifié | vérifié | Missions à distance, Gigs |
| PRE-B | artisan | vérifié | vérifié | Chantier, jalons, OPR, risque élevé |
| PRE-M | manoeuvre | vérifié | **en attente** | Contrat au temps, versement retenu |
| PRE-N | artisan | en attente | — | Candidature bloquée |
| RC | responsable_chantier | vérifié | — | Vérification OPR, relevés |
| ADM-K / ADM-MO / ADM-ME / ADM-S / ADM-F | admin kyc / moderation / mediation / superviseur / frontend | — | — | Back-office, un rôle par compte |

### 0.3 Jeu de données

- Taxonomie : au moins une catégorie par secteur (DIGITAL, BTP, SERVICES), dont une catégorie BTP
  **à risque élevé** avec âge minimum et OPR autorisé.
- Montants de référence : ceux de PLAN_TESTS_MODELE_PAIEMENT.md §1.3 (devis TTC 177 000, candidature
  fixe 120 000, S2J 7 500 × 20 jours).

### 0.4 Ordre d'exécution conseillé

1. Sections A → E (comptes, profils, KYC) : elles produisent les comptes dont tout le reste dépend.
2. Parcours de bout en bout du §Z : ils traversent F → M d'un seul tenant et révèlent les ruptures
   entre écrans.
3. Sections F → T en détail : garde-fous et cas limites.
4. Section U (sécurité) et V (non fonctionnel) en dernier, sur des données déjà riches.

---

## A. Visiteur et pages publiques

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| A-01 | Ouvrir l'accueil sans être connecté | Sections d'accueil administrées (backoffice) affichées, menus à jour | ✅ frontend-publication.e2e |
| A-02 | Parcourir à-propos, comment-ça-marche, confiance, tarifs, FAQ, contact, CGU, confidentialité | Chaque page s'affiche, aucun lien mort dans le pied de page | ✅ nav. public.spec |
| A-03 | Ouvrir une page catégorie / métier depuis le menu | `/recherche?categorie=…` montre la rubrique et ses prestataires listables | ✅ taxonomy-landing |
| A-04 | Ouvrir le profil public d'un prestataire vérifié | Profil visible, badge « Vérifié » si accordé | ✅ public-profile-visibility.route |
| A-05 | Ouvrir le profil public d'un compte non listable (KYC non vérifié, sans profil, client) | 404, aucune donnée exposée | ✅ public-profile-visibility.route |
| A-06 | Accéder à une page protégée (`/client/dashboard`) sans session | Redirection vers `/signin` | ✅ nav. public.spec |
| A-07 | `/api/health` | 200, base joignable | ✅ nav. public.spec |

## B. Inscription, OTP et connexion

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| B-01 | S'inscrire (e-mail + téléphone) en cochant CGU et confidentialité | Compte créé `en_attente` de KYC, OTP envoyé | ✅ signup-consentement.e2e |
| B-02 | S'inscrire sans cocher les CGU | Refus, consentement exigé | ✅ signup-consentement.e2e |
| B-03 | Saisir l'OTP reçu sur `/verify-otp` | Compte activé, passage à `/bienvenue` | ✅ nav. auth.spec |
| B-04 | Saisir un OTP faux puis expiré ; abuser du renvoi | Refus ; limitation de débit au-delà du seuil | ✅ rate-limit |
| B-05 | `/bienvenue` : choisir « client » puis, sur un autre compte, « prestataire » | Arrivée sur le bon tableau de bord | ✅ nav. auth.spec |
| B-06 | Se connecter / se déconnecter ; mauvais mot de passe | Session ouverte / fermée ; message d'erreur sans fuite d'information | ✅ nav. auth.spec |
| B-07 | Re-acceptation des CGU après une nouvelle version | Écran d'acceptation imposé avant de continuer | ✅ cgu-acceptation.e2e |

## C. Profils, déclarations et badge

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| C-01 | Client : compléter `/profile/client` (type, société, secteur, photo, adresse) | Jauge de complétion à jour ; rien n'est bloquant | ✅ client-profile.e2e |
| C-02 | Client → `/devenir-prestataire` : déclarer un métier | Profil prestataire créé, le profil client reste intact | ✅ provider-onboarding.e2e |
| C-03 | Déclarer un métier d'une catégorie à âge minimum sans date de naissance | Refus `kyc_required_for_age`, lien vers `/kyc` | ✅ age-categorie |
| C-04 | Même chose avec un âge inférieur au minimum du pays | Refus `age_under_minimum` | ✅ age-gate |
| C-05 | `/declarations` : diplômes, expériences, personnes ressources | Enregistrées, déclaratives, visibles sur le profil | ✅ declarations-detail.e2e |
| C-06 | Ajouter un garant (artisan, garant exigé par l'admin) ; doublon | Garant enregistré ; doublon refusé | ✅ garant-dedup, garant-rules |
| C-07 | `/badge` : demander le badge « Vérifié » | Demande en file de l'Admin KYC ; badge affiché après accord | ✅ nav. profil.spec |
| C-08 | Profil prestataire : complétion, photo, CV | Jauge à jour, avatar servi seulement si listable | ✅ provider-profile-completion |

## D. Vérification d'identité (KYC) et compte de versement

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| D-01 | `/kyc` : téléverser les 4 pièces | Statut « en attente », dossier dans la file Admin KYC | ✅ nav. kyc.spec |
| D-02 | Admin KYC valide chaque pièce | Statut global `verifie` ; brouillons « publication demandée » notifiés | ✅ nav. kyc.spec (statut) · ❌ notification des brouillons |
| D-03 | Admin KYC rejette une pièce, l'utilisateur la renvoie | `rejete` puis retour à `en_attente` | ✅ nav. kyc.spec |
| D-04 | Admin révoque une pièce d'un compte vérifié | Statut recalculé, plus vérifié | ✅ nav. kyc.spec |
| D-05 | `/kyc/financier` : déclarer un compte Mobile Money + justificatif de domicile | Compte « en attente », file Admin KYC → versements | ✅ nav. kyc.spec |
| D-06 | Admin KYC vérifie le compte de versement | Statut `verifie` ; **tout versement en attente part** (voir K) | ✅ payable.e2e, payout-pending.e2e |
| D-07 | Admin KYC rejette le compte sans motif | Refus `refusal_reason_required` | ✅ nav. kyc.spec |

## E. Recherche et découverte

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| E-01 | `/recherche` par métier, ville, secteur | Seuls les prestataires vérifiés et listables apparaissent | ✅ secteur-classement.e2e |
| E-02 | Prestataires mis en avant sur l'accueil | Uniquement vérifiés | ✅ nav. decouverte.spec |
| E-03 | Rapprochement mission ↔ prestataires du domaine | Notification aux prestataires du métier publié | ✅ rapprochement-symetrique.e2e |
| E-04 | Accueil : dernières missions publiées ; ouvrir une carte sans être connecté | Six dernières `publiee` (jamais un brouillon), badge de vérification du client sans son nom ; connexion puis retour sur la mission | ✅ nav. decouverte.spec, safe-callback |
| E-05 | Accueil : ordre des domaines (barre, services) | Domaines les plus actifs d'abord, métier actif hors liste ajouté (ex. Couture) ; sans publication, ordre du backoffice | ✅ landing-activity |
| E-06 | Accueil : nouveaux services (Gigs) publiés ; ouvrir une carte sans être connecté | Six derniers `publie` de prestataires listables, titulaires du badge « Vérifié » en tête ; connexion puis Gig ouvert dans `/client/offres` | ✅ nav. decouverte.spec |
| E-07 | Carte mission de l'accueil : bouton « Candidater » (en bas à droite, face au montant — même place que « Commander » ; drapeau du pays du client à côté de son statut d'identité) ; prestataire non connecté | Connexion directe, puis retour sur la mission avec le formulaire de candidature ouvert et à l'écran ; la candidature part | ✅ nav. decouverte.spec |
| E-08 | « Candidater » sans compte : « Créer un compte » depuis la connexion | La destination suit inscription → code → `/bienvenue` (carte prestataire présélectionnée) → `/devenir-prestataire` → retour sur la mission, formulaire ouvert ; identité non vérifiée : refus `kyc_not_verified` avec lien « Vérifier mon identité » | ✅ nav. decouverte.spec, safe-callback |
| E-09 | Carte service de l'accueil : bouton « Commander » sans compte | Inscription en client, puis fiche du Gig avec le bouton « Acheter » — aucun achat automatique | ✅ nav. decouverte.spec |

## F. Publication de mission (client)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| F-01 | CLI-V : `/missions/new`, 4 étapes, publier une mission à prix fixe | Mission `publiee`, prestataires du domaine notifiés | ✅ client-publication.e2e |
| F-02 | Mission « Demande de devis », puis mission au temps (S2J) | Publiées ; au temps : tarif et quantité max obligatoires | ✅ client-publication.e2e |
| F-03 | Enregistrer un brouillon, le reprendre depuis le tableau de bord | Brouillon invisible des prestataires, publiable en un clic | ✅ mission-draft |
| F-04 | Pièces jointes sur un brouillon ; brouillon abandonné | Fichiers purgés par le cron de nettoyage | ✅ mission-draft-attachments.e2e |
| F-05 | **CLI-A** (KYC en attente) publie | Mission **en ligne** ; bandeau « vérification exigée avant contrat » | ✅ mission-publication-kyc.e2e |
| F-06 | CLI-A publie une 4ᵉ mission | Gardée en brouillon « publication demandée », motif plafond sur le tableau de bord | ✅ mission-publication-kyc.e2e |
| F-07 | **CLI-R** (KYC rejeté) publie | Gardée en brouillon, motif « vérification refusée » | ✅ mission-publication-kyc.e2e |
| F-08 | Côté prestataire, ouvrir une mission de CLI-A | Badge « Identité non vérifiée » sur la fiche client | ✅ nav. missions.spec |
| F-09 | Catégorie à risque élevé | Palier élevé, assurance exigée avant financement | ✅ metier-risk.e2e |
| F-10 | Mode OPR avec responsable désigné ; OPR sur une catégorie qui ne l'autorise pas | Accepté ; refusé `opr_not_allowed_for_category` | ✅ client-publication.e2e |
| F-11 | Secteur et type de professionnel ciblés incompatibles | Refus `professional_type_incompatible` | ✅ mission-secteur-cible.e2e |

## G. Candidature, devis et négociation (prestataire ↔ client)

Détail des modes de paiement : PLAN_TESTS_MODELE_PAIEMENT.md §2 à §4.

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| G-01 | PRE-D candidate à une mission à prix fixe | Candidature `envoyee`, client notifié | ✅ prestataire.e2e |
| G-02 | PRE-B soumet un devis détaillé sur une mission QUOTE | Devis reçu, PDF consultable | ✅ devis-workflow.e2e |
| G-03 | **PRE-N** (KYC en attente) consulte puis candidate | Consultation libre ; candidature refusée `kyc_not_verified` | ❌ |
| G-04 | Client demande une révision ; dernier round ; rounds épuisés | Round +1, alerte au dernier round, puis annulation définitive de la paire | ✅ devis, proposal-revision-cleanup.e2e |
| G-05 | Exclusivité : un prestataire engagé ailleurs candidate | Bloqué tant que sa mission en cours n'est pas close | ✅ exclusivite-apres-cloture.e2e |
| G-06 | Plafond de candidatures souhaitées atteint | Nouvelles candidatures refusées | ✅ mission-candidatures-plafond.e2e |
| G-07 | Auto-candidature sur sa propre mission | Refus `self_dealing_forbidden` | ✅ security-guards.route |
| G-08 | Client envoie une offre formelle ; prestataire l'accepte / la décline | Même état qu'une candidature acceptée / offre close | ✅ nav. missions.spec |
| G-09 | **CLI-A** accepte une candidature ou valide un devis | Refus `kyc_not_verified` avec message « avant de retenir un prestataire » | ✅ mission-publication-kyc.e2e |
| G-10 | Expiration d'un devis non traité | Devis expiré par le cron | ✅ workflow-crons.e2e |

## H. Contrat et signature électronique

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| H-01 | Client génère le contrat depuis la candidature acceptée | Contrat brouillon : identités, objet, prix/délai **négociés**, clauses | ✅ contract-signature-workflow |
| H-02 | Générer un certificat (passphrase) puis signer côté prestataire (1/2) | Signature enregistrée, contrat non verrouillé | ✅ contract-signature-workflow |
| H-03 | Client contre-signe (2/2) | Contrat verrouillé, QR généré, séquestre demandé automatiquement | ✅ contract-signature-workflow |
| H-04 | Client signe avant le prestataire ; mauvaise passphrase ; 3ᵉ signature | Refus ordre / passphrase / contrat verrouillé | ✅ contract-signature-workflow |
| H-05 | Scanner le QR d'un contrat signé ; altérer le document | « Authentique » ; altération détectée | ✅ contract-signature-workflow, hash-chain |
| H-06 | Partie non vérifiée tente de signer | Refus `kyc_not_verified` | ❌ |
| H-07 | Contrat non contre-signé dans le délai | Annulé par le cron d'expiration | ✅ contract-expiry |
| H-08 | Export PDF du contrat et du devis définitif (`/client/devis-contrats`) | PDF fidèle, rubrique « Clôturés » après clôture | ✅ contract-document, devis-document.route |

## I. Séquestre et financement

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| I-01 | Après 2/2, payer dans `/psp-sandbox` (autoriser le Mobile Money) | Opération confirmée, mission `fonds_sous_sequestre` | ✅ escrow-unification.e2e |
| I-02 | Refuser le paiement dans la sandbox | Opération `failed`, mission inchangée, relance possible | ✅ psp-queue.e2e |
| I-03 | Financer par jalon (J1) ; financement unique S1 | Un séquestre par jalon / un seul couvrant tous les jalons | ✅ funding-upfront.e2e, opr-jalons.e2e |
| I-04 | Risque élevé sans assurance active, ou plafond de couverture trop bas | Refus `effective_insurance_required` / `insurance_ceiling_too_low` | ✅ escrow |
| I-05 | Recharge du séquestre quand une créance n'est pas couverte | Créance partie à la confirmation de la recharge | ✅ escrow-recharge.e2e |
| I-06 | Financer une mission close | Refus | ✅ mission-closed-funding.e2e |
| I-07 | Solde du séquestre lu par le client et l'admin | `financé = libéré + remboursé + séquestré` | ✅ escrow-balance.e2e |
| I-08 | Journal PSP (admin) | Chaque échange tracé, signature vérifiée | ✅ psp-journal.e2e |

## J. Exécution, livrables et validation

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| J-01 | Prestataire déclare sa progression ; client constate | Déclaré ≠ constaté ; seule la constatation compte | ✅ deliverable-scope-parity.e2e |
| J-02 | Soumettre un livrable avec preuves ; preuve douteuse | Preuves appréciées ; rejet automatique d'une preuve dupliquée | ✅ proof-auto-reject.e2e, perceptual-hash |
| J-03 | Client valide un livrable (sans jalon, puis par jalon) | Libération envoyée, clôture à la confirmation PSP | ✅ deliverable-no-jalon.e2e, mission-lifecycle.e2e |
| J-04 | Client rejette avec motif, prestataire resoumet | Fonds conservés, nouveau cycle | ✅ mission-lifecycle.e2e |
| J-05 | Financement progressif J3 : points d'étape | Libération par palier, jamais au-delà du plafond | ✅ progressive-release.e2e |
| J-06 | Retenue de garantie J4 | 95 % par jalon, retenue libérée après le dernier | ✅ retention-release.e2e, retention-guards.e2e |
| J-07 | Mode OPR : le responsable vérifie et transmet, le client valide | Validation impossible sans transmission | ✅ opr-jalons.e2e, client-opr-avance.e2e |
| J-08 | Client silencieux au-delà du délai | Acceptation tacite, les deux parties notifiées | ✅ tacit-acceptance.e2e |
| J-09 | Contrat au temps : pointage `/missions/[id]/checkin` (GPS), relevé, validation par RC | Relevé approuvé → créance → versement | ✅ spot-time.e2e, attendance-validation.e2e, client-releves.e2e |

## K. Versements au prestataire (compte de versement)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| K-01 | Valider un livrable de **PRE-M** (compte non vérifié) | Validation acquise, jalon « validé », **aucun versement** ; prestataire invité à faire vérifier son compte | ✅ payable.e2e |
| K-02 | Valider un relevé de présence de PRE-M | Relevé approuvé, panneau « versé dès la vérification du compte » | ✅ nav. versements.spec |
| K-03 | Valider une commande Gig de PRE-M | Bandeau d'attente côté client et prestataire, commande toujours engagée | ✅ payout-pending.e2e |
| K-04 | Accord de médiation avec une part pour PRE-M | Accord enregistré, non exécuté, fonds toujours gelés | ✅ payout-pending.e2e |
| K-05 | Admin KYC vérifie le compte de PRE-M | Tout ce qui attendait part : créances, retenue, médiation, Gig ; clôtures à la confirmation | ✅ payout-pending.e2e |
| K-06 | Règlement admin d'une retenue sur mission arrêtée, compte non vérifié | Refus `payout_unverified`, relance après vérification | ✅ nav. versements.spec |

## L. Litiges, médiation et remboursements

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| L-01 | Ouvrir une médiation sur `/missions/[id]/mediation` | Fonds gelés, mission `mediation_ouverte` | ✅ workflow-incidents.e2e |
| L-02 | Admin médiation propose une répartition (libérer / rembourser / maintenir) | Proposition visible des deux parties | ✅ workflow-incidents.e2e |
| L-03 | Une partie refuse | Médiation close sans accord, dégel, mission reprend | ✅ unfreeze.e2e |
| L-04 | Les deux acceptent | Dégel partiel, versement, remboursement, mission restaurée | ✅ workflow-incidents.e2e |
| L-05 | Remboursement admin d'un contrat interrompu | Reliquat rendu au client, jamais plus que le séquestré | ✅ contract-refund.e2e |
| L-06 | Reliquat orphelin sur mission close | Rendu par le cron des reliquats | ✅ residual-refund.e2e |

## M. Gigs (prestations à prix fixe)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| M-01 | PRE-D publie un Gig ; PRE-N essaie | Gig publié ; refus `kyc_not_verified` | ✅ gig-order-workflow |
| M-02 | CLI-V achète le Gig ; auto-achat | Commande créée ; auto-achat refusé | ✅ gig-order-workflow |
| M-03 | Client signe (1/2) → séquestre ; prestataire signe (2/2) | Commande `active` | ✅ gig-order-workflow |
| M-04 | Prestataire ne signe pas sous 24 h | Remboursement automatique | ✅ gig-order-workflow, workflow-crons.e2e |
| M-05 | Client valide la livraison ; double validation | Fonds libérés, commande `completed` ; aucun double paiement | ✅ gig-completion.e2e |

## N. Messagerie, notifications et temps réel

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| N-01 | Échanger des messages client ↔ prestataire sur une mission | Messages livrés en temps réel aux deux parties | ✅ messaging-integration, realtime.e2e |
| N-02 | Tiers tente de lire ou d'écrire | 404 | ✅ security-guards.route, messaging-visibility |
| N-03 | Coordonnées (téléphone, e-mail) dans un message | Détectées et signalées (fuite de contact) | ✅ leakage-detection |
| N-04 | Appel audio/vidéo depuis la messagerie | Connexion établie entre les deux parties | ✅ webrtc-e2e, signaling |
| N-05 | Cloche de notifications : chaque événement du cycle de vie | Entrée pour l'acteur et la partie adverse, e-mail reçu | ✅ notify, message-notify |

## O. Avis, signalements et modération

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| O-01 | Laisser un avis après clôture ; avant clôture | Accepté ; refusé | ✅ review-rules, review-target.e2e |
| O-02 | Avis réciproques systématiquement élevés | Suspicion de collusion signalée | ✅ collusion-detection, fraud-heuristics |
| O-03 | `/signalement` d'une déclaration ou d'un profil | Entrée dans la file Admin modération, aucune sanction automatique | ✅ nav. moderation.spec |
| O-04 | Admin modération traite le signalement | Décision journalisée, avis suspendu si besoin | ✅ nav. moderation.spec |

## P. Tableaux de bord par rôle

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| P-01 | Client : missions, propositions, devis & contrats, offres, paiements, messages | Chaque rubrique liste ses éléments ; brouillons seulement dans la carte dédiée | ✅ client-devis-contrat.e2e, mission-publication-kyc.e2e |
| P-02 | Prestataire (digital, BTP, artisan, manœuvre) : candidatures, offres, Gigs, commandes | Rubriques propres à la filière | ✅ worker-phase2.e2e |
| P-03 | Responsable chantier : chantiers délégués, relevés à valider | Uniquement les contrats où il est désigné | ✅ site-manager.e2e |
| P-04 | Changement de rôle (client devenu prestataire) | Les deux tableaux de bord restent accessibles | ✅ nav. profil.spec |

## Q. Administration (un compte par rôle)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| Q-01 | Chaque rôle admin ouvre `/admin` | Ne voit que ses rubriques ; rubriques indisponibles expliquées | ✅ admin-roles, admin-architecture.e2e |
| Q-02 | ADM-K : files identité, entreprises, freelances, badges, versements, historique | Décisions appliquées et journalisées | ✅ nav. admin-kyc.spec |
| Q-03 | ADM-MO : signalements, déclarations, avis | Décisions journalisées | ✅ nav. moderation.spec |
| Q-04 | ADM-ME : médiations, règlement de retenue, remboursements | Gestes avec justification obligatoire | ✅ admin-finance.e2e |
| Q-05 | ADM-S : utilisateurs, missions, contrats, paiements, files, rapports, feature flags | Lecture seule hors de ses pouvoirs propres | ✅ admin-finance.e2e, admin-finance-contrat-evapore |
| Q-06 | ADM-F : `/backoffice` contenus (accueil, menus, pages, versions), catalogue, filières, âges par pays | Publication versionnée, retour arrière possible | ✅ frontend-config, frontend-modules, taxonomy-catalog.e2e |
| Q-07 | Console finance : créance due → « réinstruire » | Instruite si le séquestre la couvre ; motif sinon | ✅ admin-finance.e2e |
| Q-08 | Journal d'audit | Chaque geste admin tracé, chaîne de hachage intacte | ✅ hash-chain |

## R. Tâches automatiques (crons)

Déclencher chaque route `/api/cron/*` avec le secret, puis sans.

| ID | Cron | Résultat attendu | Auto |
|---|---|---|---|
| R-01 | `contract-expirations` | Contrats non contre-signés dans le délai annulés | ✅ workflow-crons.e2e |
| R-02 | `devis-expirations` | Devis expirés | ✅ workflow-crons.e2e |
| R-03 | `gig-order-expirations` | Commandes Gig non signées remboursées | ✅ workflow-crons.e2e |
| R-04 | `tacit-acceptance` | Livrables réputés acceptés, libération envoyée | ✅ tacit-acceptance.e2e |
| R-05 | `residual-refunds` | Reliquats des missions closes rendus | ✅ residual-refund.e2e |
| R-06 | `draft-attachments-cleanup` | Pièces jointes de brouillons abandonnés purgées | ✅ mission-draft-attachments.e2e |
| R-07 | N'importe quel cron sans secret | 401, rien n'est traité | ✅ workflow-crons.e2e |

## U. Sécurité transverse

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| U-01 | Accéder à la mission, au contrat, aux messages ou aux fichiers d'autrui | 404, jamais 403 révélateur | ✅ security-guards.route, resource-guard |
| U-02 | Utilisateur non admin appelle une route `/api/admin/*` | Refus | ✅ admin-roles |
| U-03 | Webhook PSP avec signature invalide ou rejouée | Ignoré, journalisé | ✅ psp-journal.e2e |
| U-04 | Double clic sur payer / valider / publier | Une seule opération | ✅ escrow, payable.e2e |
| U-05 | Fichiers privés (pièces KYC) via URL directe | URL signée, expirée → refus | ✅ storage |
| U-06 | Base de tests jamais confondue avec la base de dev | Garde-fou actif | ✅ db-guard |

## V. Non fonctionnel

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| V-01 | Parcours client et prestataire sur mobile (375 px) | Aucun débordement horizontal, boutons accessibles | ✅ nav. mobile.spec |
| V-02 | Chargement des tableaux de bord avec 50+ missions | Affichage sous 2 s | ✅ nav. non-fonctionnel.spec |
| V-03 | Coupure réseau pendant une signature ou un paiement | Message clair, aucune opération en double à la reprise | ✅ nav. non-fonctionnel.spec |
| V-04 | Navigation clavier et lecteur d'écran sur inscription et publication | Champs étiquetés, focus visible | ✅ nav. accessibilite.spec |

---

## Z. Parcours de bout en bout

À dérouler en entier, d'un seul tenant, en notant tout écran où l'utilisateur ne sait pas quoi faire.

| ID | Parcours | Comptes | Couvre |
|---|---|---|---|
| Z-01 | Inscription → KYC → publication prix fixe → candidature → contrat → signatures → paiement sandbox → livrable → validation → versement → avis | CLI-V, PRE-D | B, D, F, G, H, I, J, O |
| Z-02 | Demande de devis BTP à risque élevé, J4 en OPR : devis, 2 révisions, assurance, jalons, vérification RC, retenue finale | CLI-V, PRE-B, RC | F, G, H, I, J |
| Z-03 | Mission au temps S2J : pointages, relevés, validation RC, versements retenus puis débloqués à la vérification du compte | CLI-V, PRE-M, RC, ADM-K | J-09, K |
| Z-04 | Client non vérifié : publie, reçoit des candidatures, bloqué à l'acceptation, fait vérifier son KYC, conclut | CLI-A, PRE-D, ADM-K | D, F-05, G-09 |
| Z-05 | Litige : livrable contesté → médiation → répartition acceptée → remboursement partiel → clôture | CLI-V, PRE-B, ADM-ME | L |
| Z-06 | Gig : publication → achat → double signature → livraison validée → paiement | CLI-V, PRE-D | M |
| Z-07 | Défaillances : paiement refusé, contrat expiré, commande Gig non signée, client silencieux (acceptation tacite) | CLI-V, PRE-D | I-02, H-07, M-04, J-08, R |
| Z-08 | Back-office : modifier l'accueil et la taxonomie, publier, vérifier côté visiteur, revenir à la version précédente | ADM-F | A, Q-06 |

## Couverture à compléter

| Réf. | Manque | Proposition |
|---|---|---|
| D-02 | Notification des brouillons « publication demandée » à la vérification (le statut est couvert : nav. kyc.spec) | Test de route sur la décision par document |
| G-03 | Candidature et devis refusés à un prestataire non vérifié | Test de route sur `proposals` et `devis` |
| H-06 | Signature refusée à une partie non vérifiée | Test de route sur `POST /api/signature/sign` |
