# Revue produit — Modèle de signature proposé vs implémentation

Date : 2026-08-30 · Périmètre : flux contrat + signature (modèle « Mission » principalement).
Référence modèle : analyse « celui qui fait l'offre signe en dernier ».

---

## 1. Vue d'ensemble

| Point du modèle | Statut | Détail |
|---|---|---|
| Ordre de signature Mission (prestataire 1er, client dernier) | ✅ Aligné | Modifié le 2026-08-30 (avant : client 1er) |
| Ordre imposé côté serveur | ✅ Aligné | `POST /api/signature/sign` rejette hors séquence |
| Délai 48 h de contre-signature + annulation sans pénalité | ✅ Aligné | `src/lib/contract-expiry.ts` + cron |
| Générateur du contrat = plateforme | ✅ Aligné | Template + clauses, « Outil généré par Flexwork » |
| Blocage double-rôle (client = prestataire sur un même contrat) | ✅ Aligné | `self_dealing_forbidden` + `assertNoSelfDealing` |
| Contrat non modifiable après génération/signature | ✅ Aligné | `contract_already_generated` + `termsSnapshot` immuable |
| Notifications aux étapes de signature | ✅ Implémenté (2026-08-30) | `MissionNotification.type` + e-mail à chaque étape (génération, 1/2, 2/2, expiration) |
| Déclenchement auto du paiement à la dernière signature | ✅ Implémenté (2026-08-30) | Après la 2ᵉ signature (client), redirection auto vers l'étape séquestre ; consentement explicite au HOLD conservé |
| Délai 24 h + remboursement auto (modèle Gig) | ✅ Implémenté (2026-08-30) | Cron + GET commande + route de signature : 24 h après signature client, remboursement auto |
| Modèle Gig (freelance publie, client achète) | ✅ Implémenté (2026-08-30) | Schéma Gig/GigOrder, publication, catalogue, achat, signature inversée |

---

## 2. Détail par point

### ✅ 1. Ordre de signature (Mission) — prestataire puis client
- **Modèle** : le freelance (acceptant) signe en premier, le client (proposant) en dernier.
- **Implémentation** : `src/app/missions/[id]/contract/page.tsx` — carte Prestataire libre (`canSignNow`), carte Client bloquée tant que `providerSignedAt` est null (« Le prestataire signe en premier ; le client contre-signe ensuite »).

### ✅ 2. Ordre imposé côté serveur
- **Modèle** : orchestration stricte côté plateforme.
- **Implémentation** : `src/app/api/signature/sign/route.ts` rejette (409) : client avant prestataire → `provider_must_sign_first` ; signature en double → `already_signed` ; prestataire après le client → `signature_order_invalid`. *Avant le 2026-08-30, l'ordre n'était qu'un indice visuel.*

### ✅ 3. Délai 48 h + annulation sans pénalité
- **Modèle** : « Freelance signe mais client ne contre-signe jamais → délai pour le client, sinon annulation sans pénalité ».
- **Implémentation** : `src/lib/contract-expiry.ts` — échéance `providerSignedAt + 48 h`. À l'expiration : invalidation de la signature du prestataire (`providerSignedAt → null`), suppression de ses `ContractSignature`, événement d'audit `CONTRACT_EXPIRED`. Déclenché à la tentative de signature du client (409 `counter_sign_expired`), à la lecture du contrat (GET), et par le cron `/api/cron/contract-expirations` (Bearer `CRON_SECRET`).

### ✅ 4. Générateur = plateforme
- **Modèle** : le contrat est toujours généré par la plateforme.
- **Implémentation** : `src/app/api/missions/[id]/contract/route.ts` (POST) — template + clauses (`src/lib/contract-clauses.ts`, droit béninois), badge « Outil généré par Flexwork ». La plateforme n'est jamais signataire (clause testée).

### ✅ 5. Blocage double-rôle
- **Modèle** : un utilisateur ne peut pas être client ET prestataire sur le même contrat.
- **Implémentation** : candidature à sa propre mission → 403 `self_dealing_forbidden` ; génération du contrat → `assertNoSelfDealing` (409/403).

### ✅ 6. Contrat non modifiable après génération
- **Modèle** : « Contrat modifié après première signature → annulation, retour à l'étape précédente ».
- **Implémentation** : une seule génération possible (`contract_already_generated` → 409) ; `termsSnapshot` figé (immuable) à la génération. Après signatures, toute modification est exclue (le contrat est verrouillé par hash).

### ✅ 7. Notifications aux étapes de signature (implémenté 2026-08-30)
- **Modèle** : notifications « Mission à confirmer » (prestataire) puis « Freelance engagé, confirmez » (client).
- **Implémentation** : helper `notifyMissionUser` (`src/lib/mission-notify.ts`) — notification in-app (`MissionNotification`, champ `type` ajouté : `contract_generated`, `provider_signed`, `contract_locked`, `contract_expired` + `message` libre) ET e-mail (non bloquant). Déclencheurs : (1) génération du contrat → prestataire « mission à confirmer » ; (2) signature prestataire (1/2) → client « contre-signe sous 48h » ; (3) signature client (2/2) → prestataire « mission engagée » ; (4) expiration 48h → les deux parties. Fil « Activité récente » : prestataire (`provider-summary`, déjà existant, formaté par type) + client (nouveau : `client-summary.activity` + carte dans `ClientDashboardPage`). Vérifié E2E : e-mails reçus dans Mailpit (3 événements), tests 20/20 + 237/237.

### ✅ 8. Déclenchement du paiement (implémenté 2026-08-30)
- **Modèle** : « Client signe en dernier → déclenche le paiement sécurisé » (automatique).
- **Implémentation** : à la fermeture de la modale après la 2ᵉ signature du client, redirection automatique vers `/missions/[id]/escrow` (étape de financement) au lieu du clic manuel « Procéder au paiement sous séquestre ». Le consentement explicite au HOLD est **conservé** : la page séquestre reste celle qui instruit l'instruction au PSP (« En validant, vous autorisez le PSP agréé à mettre sous séquestre le montant indiqué ») — la navigation ne contourne jamais ce consentement. `src/app/missions/[id]/contract/page.tsx` — `clientJustSigned` + `handleCloseSigning` (redirection à la fermeture de la modale, le QR de preuve reste visible). Vérifié E2E navigateur : signature client (2/2) → fermeture → URL `/escrow`.

### ✅ 9. Modèle Gig + délai 24 h / remboursement auto (implémenté 2026-08-30)
- **Modèle** : freelance publie un Gig, le client achète ; client signe 1er, freelance dernier ; 24 h sinon remboursement auto.
- **Implémentation** : schéma dédié `Gig` / `GigOrder` (+ `GigOrderSignature`, `GigOrderAuditEntry`, `GigOrderEscrowOperation` — parallèle au modèle Mission pour ne pas le coupler). Flux : (1) le prestataire publie un Gig à prix fixe (`POST /api/gigs`, catalogue `GET /api/gigs`) ; (2) le client achète (`POST /api/gigs/[id]/purchase` → commande `created`, self-dealing interdit) ; (3) le CLIENT signe EN PREMIER (`POST /api/gigs/orders/[orderId]/sign`, ordre inversé imposé serveur → les fonds passent sous séquestre, statut `client_signed`) ; (4) le PRESTATAIRE signe en dernier sous 24 h (`GigSignatureService` — même crypto RSA-2048 que Mission) → statut `active` ; (5) sinon remboursement auto (`src/lib/gig-expiry.ts` + cron `/api/cron/gig-order-expirations`, idempotent). UI : catalogue `/gigs`, création `/gigs/nouveau`, détail+achat `/gigs/[id]`, commande `/gigs/commandes/[orderId]` (cartes de signature inversées + QR, bandeau 24 h / remboursé / engagé). Tests : `src/lib/gig-order-workflow.test.ts` (10 tests). Notifications in-app Gig non incluses (e-mails uniquement) — suivi possible.

---

## 3. Points ouverts / recommandations (priorité)

1. ~~**Notifications des étapes de signature** (⚠️ 7) — coût faible, gain UX~~ → **FAIT (2026-08-30)** : notifier le prestataire à la génération (« mission à confirmer »), le client après la signature du prestataire (« contre-signe sous 48 h »), le prestataire après la signature du client (« mission engagée »), + les deux parties à l'expiration. Via `src/lib/mission-notify.ts` + `MissionNotification.type` + e-mail.
2. ~~**Déclenchement automatique du séquestre** (⚠️ 8) — optionnel~~ → **FAIT (2026-08-30)** : après la 2ᵉ signature (client), redirection auto vers `/escrow` à la fermeture de la modale de signature. Consentement explicite au HOLD conservé (page séquestre inchangée). Voir `handleCloseSigning` dans `src/app/missions/[id]/contract/page.tsx`.
3. ~~**Modèle Gig** (❌ 9) — chantier structurant~~ → **FAIT (2026-08-30, socle + flux complet)** : schéma `Gig`/`GigOrder`, publication (prestataire), catalogue + achat (client), signature inversée (client 1/2 → prestataire 2/2 sous 24 h), remboursement auto. UI : `/gigs`, `/gigs/nouveau`, `/gigs/[id]`, `/gigs/commandes/[orderId]`. Suites possibles : notifications in-app Gig, pilotage de la commande après engagement (livraison/validation), intégration au dashboard.
4. ~~**Doc de déploiement** : planifier les crons en production~~ → **FAIT (2026-08-30)** : section « Crons à planifier » ajoutée à `DEPLOYMENT-PRODUCTION.md` — `contract-expirations` (48h), `devis-expirations`, `gig-order-expirations` (24h, modèle Gig), avec exemple de planification cron + idempotence.
