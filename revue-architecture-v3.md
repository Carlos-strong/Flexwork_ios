# Revue d'architecture & d'implémentation — vs modèle v3

**Date** : voir `etat-consolide-Flexwork.md` (arbitrage A11, 3 août 2026)
**Objet** : état des lieux du code réel (`prisma/schema.prisma`, `src/`) face au modèle v3 (intermédiaire neutre). Ce document ne modifie rien — c'est la revue demandée avant toute migration de code.

> **Recommandation de méthode** : `etat-consolide-Flexwork.md` §7 dit explicitement *« Arrêter la conception documentaire jusqu'à la consultation juridique »* et liste 6 prérequis bloquants (§5). L'implémentation actuelle est fonctionnelle, testée (131 tests, 30 fichiers) et cohérente avec l'ancien modèle — c'est un actif, pas une dette à jeter sans arbitrage. Ce document propose donc un **plan de migration phasé**, aligné sur les Phases 1-8 du modèle v3, plutôt qu'une réécriture immédiate et complète.

---

## 1. Verdict global

Le pivot du 3 août 2026 change la **nature juridique de la plateforme** (intermédiaire vs quasi-opérateur), ce qui touche le cœur de trois sous-systèmes entiers :

| Sous-système | Ancien modèle | Modèle v3 | Ampleur du changement |
|---|---|---|---|
| Certification / badges | Plateforme vérifie et délivre (CERT-ART, CERT-MAN, Expert, Digital) | Déclaratif, badge unique dérivé du KYC | **Remplacement total** |
| Paiement / escrow | Plateforme détient les fonds (`Wallet`, `TransactionEscrow`) | PSP agréé détient, plateforme instruit (`psp_escrow_operations`) | **Remplacement total** |
| Litige | Plateforme arbitre, décision opposable sous 5 jours | Médiation facultative, non opposable | **Remplacement total** |
| KYC | Existe déjà, vérification effective | Identique, seule vérification effective | **Conservé** |
| Anti-fraude transverse (fingerprint, leak-detection, mock-location) | Existe | Non contredit par v3, utile dans tous les cas | **Conservé** |
| Chat, notifications, stockage | Existe | Non contredit | **Conservé** |
| Pointage GPS+photo (F20), intégration SiteConnect | Existe, développé récemment | **Absent du modèle v3**, aucune mention | **Statut à trancher explicitement** (§5) |

Les trois premières lignes représentent la majorité du volume de code métier actuel (Prisma : ~15 modèles concernés sur ~45 ; API : ~35 routes sur ~90 ; 3 epics entiers de l'ancien backlog).

---

## 2. Ce qui survit sans changement de fond

Pas de travail de migration nécessaire ici, seulement une revue légère pour vérifier l'alignement terminologique :

- **KYC** (`kyc_verifications`, `src/app/api/kyc/*`, `src/app/admin/kyc`) — c'est *la* vérification que le modèle v3 conserve intégralement (§9 du modèle). Vérifier seulement que l'UI ne suggère jamais qu'un KYC validé garantit autre chose que l'identité.
- **Anti-fraude transverse** — `src/lib/dedupe.ts`, `perceptual-hash.ts`, `collusion-detection.ts`, `leakage-detection.ts`, `fraud-heuristics.ts`, `age-verification.ts`, `selfieMatch.ts` : aucun ne contredit le modèle v3, tous restent pertinents (comptes multiples, fuite hors chat, photos recyclées).
- **Infrastructure transverse** — `storage.ts`, `webhook-signing.ts`, `signed-receipt.ts`, `otp.ts`, `adminGuard.ts`, `kycGuard.ts` : la logique d'infrastructure (upload, signature HMAC, OTP) est réutilisable telle quelle par les nouvelles Phases 5 (webhooks PSP) et 3 (déclarations horodatées).
- **Chat temps réel** (`US-405` de l'ancien backlog) — transverse, indépendant du modèle de rémunération/certification.

---

## 3. Ce qui doit être supprimé ou remplacé — par domaine

### 3.1 Certification / badges (→ Phase 2 + Phase 3 du nouveau playbook)

**Prisma à retirer** : `Badge`, `BadgeFiliere`, `BadgeStatut`, `Certification`, `CertificationType`, `CertificationStatus`, `ArtisanCertificate`, `RevenueSplitConfig`, `DiplomeDossier`, `DiplomeStatus`, `DiplomeType`, `ExpertDiplomeStatus` et les champs `ExpertProfile.statusDiplome/vaeEcheance/verifiedById/verifiedAt`.

**Prisma à ajouter** : `kyc_verifications` (si pas déjà exactement dans cette forme), `professional_declarations`, `declaration_documents` (modèle v3 §12).

**Routes à retirer** : `admin/artisan/diplome*`, `admin/expert/diplome*`, `artisan-profile/diplome`, `api/badges`, `expert-formation/*`, `manoeuvre-formation/*` (formation obligatoire liée au badge), `admin/formation*`, `admin/partenaires`, `admin/sessions`, `sessions/*`.

**Routes à créer** : déclaration de qualification/assurance avec document joint (US-301/302), affichage 3 blocs (US-304).

**Libs à retirer** : `badges.ts`, `certificat.ts`, `qr-verification.ts` (le QR vérifiait un certificat délivré par la plateforme — n'a plus d'objet), `vae.ts`, `expert-formation.ts`, `manoeuvre-formation.ts`, `test-engine.ts`, `projet-final.ts`, `revenue-split.ts`, `commission.ts` (voir 3.4).

**Onboarding à réécrire** : `(onboarding)/artisan/diplome`, `(onboarding)/artisan/session`, `(onboarding)/digital/test`, `(onboarding)/digital/formation`, `(onboarding)/expert/formation` → remplacés par un formulaire de déclaration unique (US-301/302/305), réutilisable entre profils plutôt que dupliqué par filière.

### 3.2 Escrow / paiement (→ Phase 5)

**Prisma à retirer** : `TransactionEscrow`, `EscrowProvider`, `EscrowStatus`, `Wallet`, `WalletTransaction`, `WalletTransactionType`, `Retrait`, `RetraitStatus`.

**Prisma à ajouter** : `psp_escrow_operations` (modèle v3 §12).

**Routes à retirer/réécrire** : `jalons/[id]/escrow/block`, `jalons/[id]/escrow/request-otp`, `jalons/[id]/validate`, `api/wallet`, `api/wallet/retrait`, `webhooks/[provider]` (à réécrire pour émettre des instructions HOLD/RELEASE/FREEZE plutôt que créditer un wallet interne).

**Libs à retirer/réécrire** : `jalon-payment.ts` (crédite un wallet interne — logique incompatible par construction avec « la plateforme ne détient jamais les fonds »), `escrow-webhook.ts`, `session-payment.ts`, `retrait-payment.ts`, `visite-payment.ts`.

**Point d'architecture le plus sensible** : `jalon-payment.ts::releaseJalonFunds()` fait aujourd'hui un `prisma.wallet.update({ solde: increment })` — c'est exactement le mécanisme que le modèle v3 interdit (test de conformité §16, point 3 : « la plateforme détient-elle des fonds à un moment quelconque ? → si oui, refuser »). Ce fichier ne peut pas être adapté à la marge, il doit être remplacé par un simple enregistreur d'instructions PSP.

### 3.3 Litige / dispute (→ Phase 6)

**Prisma à retirer** : `Litige`, `LitigeStatus` (`deadlineArbitrage`, `decisionNote`, `decisionParId` — vocabulaire d'arbitrage opposable).

**Prisma à ajouter** : `mediations` (modèle v3 §12).

**Routes à réécrire** : `admin/litiges/[id]/decision` (aujourd'hui : décision admin opposable → devient : proposition de résolution soumise à acceptation des deux parties, US-602/603), `missions/[id]/litige(s)`.

### 3.4 Commission (→ à trancher, absent du modèle v3)

`FiliereConfig`/`Commission` (5-15% par jalon) ne sont ni explicitement repris ni explicitement interdits par le modèle v3 — mais la règle A7 (*« aucune commission sur une certification que la plateforme rend obligatoire »*) invalide directement l'usage qui en était fait (split 20k/15k FCFA sur la certification physique Artisan, `RevenueSplitConfig`). Une commission plateforme sur les missions elles-mêmes reste envisageable en théorie (le modèle v3 ne l'exclut pas) mais devrait être retravaillée : sur quoi porte-t-elle si la plateforme n'est plus partie au contrat et ne détient plus les fonds ? Probablement une commission prélevée par le PSP sur instruction de la plateforme au moment du RELEASE — **point ouvert, à statuer avant toute implémentation** plutôt qu'à déduire par erreur.

### 3.5 Pointage GPS / SiteConnect (→ statut à trancher)

`Pointage`, `PointageType`, `SiteConnectVerificationStatus`, `MockLocationAlert` (usage pointage), `ManoeuvreProfile.siteconnectWorkerId/siteconnectEnrollCorrelationId`, `src/lib/siteconnect*.ts`, `src/app/api/webhooks/siteconnect`, `src/app/api/manoeuvre-profile/siteconnect-enroll`, `src/app/api/missions/[id]/pointages` — ce sous-système entier (développé récemment, avec une vraie intégration fournisseur) n'a **aucune contrepartie dans le modèle v3**. Deux lectures possibles :
1. Le modèle v3 est volontairement plus simple et abandonne ce mécanisme (cohérent avec l'esprit « moins la plateforme en fait, plus elle est un intermédiaire neutre »).
2. Le modèle v3 ne le mentionne simplement pas parce qu'il documente le cœur transactionnel, et le pointage Manœuvre reste un module optionnel hors périmètre de ce document.

**Recommandation** : trancher explicitement avec la même méthode que le reste (A-numéro dans `etat-consolide-Flexwork.md`) avant de supprimer ou de conserver — ne pas le retirer par déduction silencieuse, ni le laisser vivre sans le raccrocher au nouveau modèle de responsabilité (si un pointage GPS influence le déclenchement d'un paiement, il doit être compatible avec « la plateforme ne détient jamais les fonds »).

### 3.6 Machine à états Kanban (`mission-state.ts`, `MissionStatutKanban`)

Les 16 statuts actuels encodent des étapes propres à l'ancien cycle (offre → devis → contrat signé → escrow bloqué en interne → jalons multiples → litige). Le cycle v3 (§6.3) est strictement plus court : `contrat signé → HOLD confirmé → travaux → livrable → (validation | tacite | contestation) → RELEASE ou médiation`. Plutôt que de mapper les 16 anciens statuts un par un, il est plus sain de **reconcevoir une machine à états courte alignée sur le cycle v3**, et de vérifier après coup que rien d'important de l'ancien Kanban (ex. distinction devis rapide/détaillé) n'a de valeur indépendante à conserver ailleurs.

### 3.7 Garants (Artisan/Manœuvre)

`etat-consolide-Flexwork.md` §1.3 fixe : *« Personnes ressources pour Artisan et Manœuvre (1 obligatoire + 2 optionnelles) »* — contre 2 garants obligatoires actuellement (`US-903`, `admin/manoeuvre/[id]/activation-garants`). Le modèle `Garant` (polymorphe, sans contrainte de cardinalité en base) n'a pas besoin de migration de schéma, seulement une revue de la logique applicative (nombre minimum, quels champs deviennent optionnels) dans les routes `artisan-profile/garants`, `manoeuvre-profile/garants`, `admin/garants*`.

### 3.8 Feature flags par filière (`FeatureFlag`, gating zone/filière)

Le concept de gating géographique/légal reste probablement utile (ex. n'activer une zone qu'après le prérequis PSP), mais son organisation actuelle (`filiere_b_zone_<zone>`, `filiere_d_zone_<zone>`) est calquée sur les 4 filières à badge, qui disparaissent. À reconcevoir autour des vrais prérequis bloquants du modèle v3 (§17) : `psp_montage_valide_<pays>`, `assurance_mission_disponible_<pays>`, `signature_electronique_validee_<pays>`.

---

## 4. Ce qu'il manque entièrement (aucune contrepartie dans le code actuel)

D'après l'inventaire du modèle de données v3 (§12) :

- `professional_declarations` + `declaration_documents` — cœur de la Phase 3, rien d'équivalent aujourd'hui (l'ancien modèle *vérifiait*, il ne *déclarait* pas).
- Chaînage de hash append-only (`previous_hash`/`current_hash`) — n'existe nulle part dans le schéma actuel. Nouveau composant transverse (US-303/804).
- `prestation_contracts` avec `terms_snapshot` JSON et mention obligatoire « Flexwork n'est pas partie » — l'actuel `Contract`/`contrat_signe` (statut Kanban) génère un PDF mais ne fige pas les conditions dans un JSON versionné, et la question de savoir si la plateforme y apparaît comme partie n'a jamais été un test explicite.
- `domain_risk_levels`, `mission_insurance`, `client_acknowledgements` — rien d'équivalent ; la notion de « risque élevé bloquant » n'existe pas dans le modèle actuel où seule la filière (Artisan/Manœuvre) gate l'accès, pas le domaine précis de la mission.
- `admin_audit_log` transverse avec justification obligatoire — il existe des logs ponctuels (`MockLocationAlert`, décisions ad hoc) mais pas un log d'audit générique couvrant toute action admin.
- Les 4 rôles admin du modèle v3 (KYC / Modération / Médiation / Superviseur) — l'admin actuel est un rôle plat (`isAdmin` booléen, `adminGuard.ts`), sans séparation des pouvoirs.

---

## 5. Décisions à prendre avant de coder quoi que ce soit

Ces questions ne se résolvent pas en développant (même logique que `etat-consolide-Flexwork.md` §5) :

1. **Big-bang ou migration phasée ?** Le modèle v3 lui-même propose un ordre (§14, Phases 1→8). Migrer phase par phase permet de garder une plateforme fonctionnelle en continu (KYC et chat ne bougent pas) plutôt que de tout casser en un commit géant.
2. **Que devient le pointage GPS/SiteConnect** (§3.5) ? Décision A-numérotée à ajouter à `etat-consolide-Flexwork.md`.
3. **Y a-t-il une commission plateforme sur les missions, et sur quoi porte-t-elle** (§3.4) sans détention de fonds ni certification obligatoire ?
4. **Les 3 documents HTML de maquette** (`▶-Ouvrir-*.html`, dont la landing actuellement servie sur `/`) sont construits autour du discours « badges certifiés, vérification anti-fraude différenciante » — à reprendre selon le nouveau discours commercial (`etat-consolide-Flexwork.md` §6 : *« nous savons qui est en face de vous, et votre argent est protégé jusqu'à ce que le travail soit fait »*), pas avant que le §6 soit confirmé irrévocable.
5. **Sort des 23 migrations Prisma existantes** : les annuler (nouvelle baseline de schéma propre) ou les laisser et ajouter des migrations correctives par-dessus ? Vu l'ampleur des suppressions de modèles (§3), une nouvelle baseline est probablement plus lisible qu'un empilement de `DROP TABLE` correctifs — mais implique de perdre l'historique de migration existant, à valider explicitement.

---

## 6. Proposition de plan d'exécution (si validé)

Dans l'ordre du nouveau `Prompts_Sprints_UserStories.md`, phase par phase, chaque phase se terminant par : migration Prisma, routes, UI, tests, avant de passer à la suivante — jamais un « big bang » schema+routes+UI sur les 8 phases à la fois :

1. **Phase 1-2 (Comptes, KYC)** — impact minimal, la structure `users`/`kyc_verifications` existe déjà, principalement du reformattage et de la suppression de gating superflu (US-203).
2. **Phase 3 (Déclarations)** — le plus gros chantier de contenu nouveau, mais indépendant des prérequis juridiques bloquants : peut démarrer immédiatement.
3. **Phase 4 (Missions & contrat)** — nécessite de trancher §3.6 (nouvelle machine à états courte) avant de commencer.
4. **Phase 5 (PSP)** — **ne pas commencer le code de production avant le prérequis juridique #2/#3** (`etat-consolide-Flexwork.md` §5) ; le code peut être préparé derrière un flag mais pas branché en réel.
5. **Phase 6 (Médiation)** — peut suivre Phase 5 sans prérequis juridique supplémentaire propre.
6. **Phase 7 (Risque élevé)** — **bloqué sur le prérequis juridique #4** (produit d'assurance à la mission).
7. **Phase 8 (Modération/traçabilité)** — transverse, peut être développée en parallèle dès la Phase 2 pour éviter d'avoir à instrumenter after-the-fact.

---

## 7. Ce que je n'ai pas fait dans cette revue

Par choix, pas par oubli : je n'ai pas touché au code (`prisma/schema.prisma`, `src/`) ni supprimé de fichiers. Vu l'ampleur (§1) et le rappel explicite de `etat-consolide-Flexwork.md` de geler la conception le temps de la validation juridique, une suppression silencieuse de 15+ modèles et ~35 routes testées aurait été un pari, pas une revue. Dis-moi comment tu veux avancer (§5, question 1) et je peux commencer l'implémentation phase par phase à partir de là.
