# Prompts par phase et user story — Modèle v3 (intermédiaire neutre)

### Flexwork — Playbook d'implémentation

> **Ce document remplace intégralement la version précédente** (modèle « 4 filières + badges certifiés par la plateforme »), obsolète depuis l'arbitrage A11 du 3 août 2026 — voir [`etat-consolide-Flexwork.md`](etat-consolide-Flexwork.md) §2 et §6, et [`modele-skillafrica-v3-Flexwork.md`](modele-skillafrica-v3-Flexwork.md) pour le modèle de référence complet. Chaque prompt ci-dessous est prêt à être collé dans un assistant de code, story par story, dans l'ordre de la phase.

## ⚠️ Préalable — ne pas développer avant lecture

`etat-consolide-Flexwork.md` §5 et §7 est explicite : **sept prérequis juridiques bloquants** conditionnent ce modèle (statut d'intermédiaire, montage PSP, opposabilité des clauses, assurance à la mission, requalification en relation de travail, validité de la signature électronique, protection des données pour la géolocalisation du pointage — voir A12). Tant que la consultation juridique n'a pas eu lieu, développer les Phases 5 (séquestre PSP) et 7 (risque élevé) expose à devoir tout refaire si le montage change. Les Phases 1 à 4 (comptes, KYC, déclarations, contrat comme simple outil non signé par la plateforme) ne dépendent d'aucun de ces prérequis et peuvent démarrer immédiatement.

**Test de conformité permanent** (à repasser avant toute story qui semble s'écarter du modèle) — `modele-skillafrica-v3-Flexwork.md` §16 :
1. L'information est-elle affichée comme **déclarée**, jamais comme certifiée ?
2. La plateforme reste-t-elle **hors contrat de prestation** ?
3. La plateforme **ne détient-elle jamais** les fonds ?
4. Aucun tarif, disponibilité ou exclusivité **imposé** au prestataire ?
5. Aucune recommandation d'un prestataire sur un critère non publié ?
6. Aucun litige **tranché** de façon opposable par la plateforme ?
7. Aucun domaine à risque élevé exercé **sans couverture effective** ?
8. Les données de pointage (A12) **transitent**-elles par la plateforme sans jamais l'**informer** — aucun score, classement, pénalité ou décision de litige ne s'appuie dessus ?
9. Un profil filière chantier (A13) reste-t-il **impossible à activer** en dessous du seuil d'âge minimum, quel que soit le pays, sans aucune dérogation possible ?

Toute réponse divergente invalide la story — la reformuler avant de coder.

**Point 5 du test reste aujourd'hui non vérifiable** : aucun critère de classement des prestataires n'est publié ni même écrit (`modele-skillafrica-v3-Flexwork.md` §18, point ouvert #6). Voir US-000 ci-dessous — à documenter avant toute story de recherche/tri de prestataires (Phase 4 et au-delà).

---

## Vision produit — l'intermédiaire neutre

Flexwork met en relation des **clients** et des **prestataires** (Expert Digital, Expert BTP/Autres, Artisan, Manœuvre) sur le Bénin et l'Afrique de l'Ouest. La plateforme **ne réalise aucun travaux, ne garantit aucun résultat, n'est partie à aucun contrat de prestation, et ne détient jamais les fonds**.

**Un seul badge existe** : `IDENTITE_VERIFIEE` (KYC validé) ou `NON_VERIFIE`. Tout le reste — qualifications, expérience, assurance, niveau — est **déclaré par le prestataire**, affiché comme tel, jamais certifié.

**Trois contrats séparés** (voir `modele-skillafrica-v3-Flexwork.md` §2) :
- CGU Plateforme ↔ Client (accès au service)
- CGU Plateforme ↔ Prestataire (déclarations garanties par le prestataire)
- Contrat de prestation Client ↔ Prestataire (généré comme outil, signé par les deux parties, **la plateforme n'est pas signataire**)

**Le séquestre est opéré par un PSP agréé** (FedaPay ou équivalent) — la plateforme transmet des instructions HOLD/RELEASE/FREEZE, ne détient jamais les fonds, ne confirme un mouvement que via webhook PSP signé.

**Le litige devient une médiation facultative** — la plateforme facilite, ne tranche pas. Sans accord, les parties saisissent la juridiction compétente.

**Une seule exception assumée** : les domaines à risque physique élevé (électricité, travail en hauteur, gros œuvre, engins) exigent une assurance **effective**, bloquante, sans fenêtre de tolérance.

---

## Sommaire

- [Phase 0 — Cadrage avant développement](#phase-0)
- [Phase 1 — Comptes](#phase-1)
- [Phase 2 — KYC](#phase-2)
- [Phase 3 — Déclarations professionnelles](#phase-3)
- [Phase 4 — Missions & contrat de prestation](#phase-4)
- [Phase 5 — Séquestre via PSP](#phase-5)
- [Phase 6 — Médiation](#phase-6)
- [Phase 7 — Risque élevé & assurance à la mission](#phase-7)
- [Phase 8 — Modération & traçabilité](#phase-8)

**Rappel d'ordre** (`modele-skillafrica-v3-Flexwork.md` §14) : chaque phase suppose la précédente livrée. La Phase 5 a pour prérequis un contrat PSP signé + validation juridique du montage (prérequis bloquant #2/#3, `etat-consolide-Flexwork.md` §5). La Phase 7 a pour prérequis l'existence d'un produit d'assurance à la mission au Bénin (prérequis bloquant #4).

---

## Phase 0 — Cadrage avant développement
**Objectif :** lever les décisions et prérequis non techniques dont dépendent les phases suivantes, pour ne pas coder dans le vide sur des hypothèses non validées. Aucune de ces stories ne produit de code applicatif — ce sont des décisions produit/juridiques/business à acter et consigner.

### US-001 — En tant que PO, je consigne la validation des sept prérequis juridiques bloquants et la couverture RC Pro de la plateforme

*Priorité Must*

```
Contexte : Préalable (voir en tête de ce document) — sept prérequis juridiques bloquants (etat-consolide-Flexwork.md §5 et §7, modele-skillafrica-v3-Flexwork.md §17) conditionnent tout ou partie du modèle. Distinct de ces sept prérequis : la RC Pro de la plateforme elle-même (Flexwork en tant qu'intermédiaire) n'est pas documentée dans etat-consolide-Flexwork.md — c'est une couverture business, pas une des sept qualifications juridiques du modèle. Ne pas la confondre avec la RC Pro déclarée par chaque prestataire (§4), qui elle est déjà couverte par les stories de Phase 3.

Tâche (US-001) : En tant que PO, avant d'ouvrir les Phases 5 (séquestre PSP) et 7 (risque élevé), je consigne pour chacun des sept prérequis juridiques bloquants son statut (validé / en cours / non traité) et sa source (avis d'avocat, contrat signé, etc.), et je fais souscrire — ou je consigne l'existence — d'une assurance RC Pro propre à la plateforme, distincte de celles déclarées par les prestataires.
Précision technique : Document de suivi (pas une story de code) tenu à jour à chaque sprint planning ; les Phases 5 et 7 ne démarrent pas tant que leurs prérequis respectifs (#2/#3 pour la Phase 5, #4 pour la Phase 7) ne sont pas au statut « validé ». Le prérequis #7 (protection des données pour le pointage, A12) bloque spécifiquement US-406.

Livrables attendus : un document de suivi des sept prérequis (statut + source), à référencer depuis les stories bloquées par chacun.
Contrainte : ne bloque pas le début des Phases 1 à 4, qui n'en dépendent pas.
```

### US-002 — En tant que PO, je valide la demande auprès d'un échantillon d'artisans avant de développer la Phase 7 (assurance à la mission)

*Priorité Should*

```
Contexte : Phase 7 — Risque élevé & assurance à la mission. Point ouvert #1 du modèle v3 (`modele-skillafrica-v3-Flexwork.md` §18) : existence et taux d'un produit d'assurance à la mission au Bénin — non confirmés. Développer US-703 sur cette hypothèse non vérifiée risque un travail jeté si le marché ne suit pas.

Tâche (US-002) : En tant que PO, avant le développement de la Phase 7, je sonde un échantillon (~20) de prestataires des filières chantier pour valider l'appétence pour une assurance à la mission à ~2% du montant, et je consigne le résultat.
Précision technique : Sondage informel (pas une story de code) ; sert de justification produit avant d'investir sur US-703, qui reste de toute façon derrière le feature flag `mission_insurance_enabled` tant que le prérequis bloquant #4 n'est pas levé.

Livrables attendus : synthèse du sondage (accepté/refusé, objections principales), à référencer avant l'ouverture de la Phase 7.
Contrainte : n'est pas bloquant pour les Phases 1 à 6.
```

### US-003 — En tant que plateforme, je documente et publie l'algorithme de classement des prestataires

*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Test de conformité §16 point 5 (modele-skillafrica-v3-Flexwork.md) : « La plateforme recommande-t-elle un prestataire plutôt qu'un autre sur un critère non publié ? (si oui → refuser) ». Aujourd'hui ce point est invérifiable : aucun critère de tri/classement n'est documenté nulle part (point ouvert #6, §18) alors que la recherche de prestataires (US-304, `/api/search/prestataires`) trie forcément par quelque chose.

Tâche (US-003) : En tant que plateforme, je documente noir sur blanc l'algorithme de tri utilisé dans la recherche/liste de prestataires, et je le rends consultable par tout utilisateur (ex. lien « Comment sont classés les résultats ? »).
Précision technique : Le tri doit reposer uniquement sur des faits d'usage constatés par la plateforme (note moyenne, nombre de missions complétées, ancienneté — §10.1), jamais sur un critère commercial caché (mise en avant payante non publiée, favoritisme). Si le tri actuel est en réalité chronologique ou filtré sans pondération, documenter cet état tel quel plutôt que d'inventer un algorithme non implémenté. Toute évolution future du tri repasse par cette même page publique avant mise en production.

Livrables attendus : le texte de l'algorithme (dans ce document ou une page produit dédiée), plus la page/lien public correspondant si non déjà présent.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 1 — Comptes
**Objectif :** authentification, rôles, unicité téléphone, rate limiting, profils de base.

### US-101 — En tant qu'utilisateur, je crée un compte avec téléphone unique vérifié par SMS
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 1 — Comptes. Modèle v3 (intermédiaire neutre) — voir modele-skillafrica-v3-Flexwork.md §12. Table `users` (id, role, firstname, lastname, email unique, phone unique, password_hash, country/state/city/locality/address, status ACTIVE/SUSPENDED/BANNED).

Tâche (US-101) : En tant qu'utilisateur, je crée un compte avec téléphone unique vérifié par SMS.
Précision technique : Un seul compte par numéro de téléphone (contrainte unique + vérification OTP SMS avant activation). Rate limiting sur l'endpoint d'inscription et sur l'envoi d'OTP. Aucun champ de qualification/assurance à cette étape — ils appartiennent à la Phase 3.

Livrables attendus : composants nécessaires (UI si pertinent, route API, migration de schéma), avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées ; si un choix de schéma impacte un autre rôle, le signaler avant de l'implémenter.
```

### US-102 — En tant qu'utilisateur, je choisis mon rôle (Client / Expert Digital / Expert BTP-Autres / Artisan / Manœuvre) à l'inscription
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 1 — Comptes. Modèle v3 — voir modele-skillafrica-v3-Flexwork.md §12. Table `profiles` (id, user_id, profile_type, identity_verified [dérivé du KYC], declared_level [auto-déclaré], main_domain, sub_specialty, secondary_domain, sector, devis_mode, indicative_rate, declared_experience_years, portfolio_items_count).

Tâche (US-102) : En tant qu'utilisateur, je choisis mon rôle et complète un profil minimal.
Précision technique : `profile_type` remplace l'ancien concept de « filière » à badge — il ne conditionne aucune vérification de la plateforme, seulement l'affichage et le domaine des missions proposées. Ne pas bloquer la complétion du profil sur le statut KYC (règle §9 du modèle v3 : le KYC ne bloque jamais l'inscription ni la complétion du profil).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées ; signaler tout impact de schéma cross-rôle avant implémentation.
```

### US-103 — En tant que plateforme, je limite le débit des tentatives d'inscription et de connexion
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 1 — Comptes.

Tâche (US-103) : En tant que plateforme, je limite le débit des tentatives d'inscription et de connexion.
Précision technique : Rate limiting par IP et par numéro de téléphone sur signup/login/OTP. Pas de CAPTCHA visuel bloquant en V1, mais un throttling serveur mesurable et testable.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 2 — KYC
**Objectif :** upload recto/verso/selfie, scan antivirus, watermark, chiffrement, parcours en 4 étapes, interface Admin KYC. **Seule vérification effective de toute la plateforme** (modele-skillafrica-v3-Flexwork.md §9).

### US-201 — En tant qu'utilisateur, je dépose ma pièce d'identité (recto/verso) et mes selfies pour le KYC
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 2 — KYC (seule vérification effective de la plateforme, modele-skillafrica-v3-Flexwork.md §9). Table `kyc_verifications` (id, user_id, id_document_type, id_document_front, id_document_back, selfie, selfie_with_document, status, rejection_reason, attempt_count, validated_at, validated_by_admin_id).

Tâche (US-201) : En tant qu'utilisateur, je dépose ma pièce d'identité (recto/verso) et mes selfies (seul, puis avec la pièce) pour le KYC.
Précision technique : Parcours en 4 étapes (recto, verso, selfie, selfie+pièce). Formats acceptés PDF/JPG/PNG, taille max 5 Mo. Scan antivirus (ClamAV ou équivalent) avant stockage. Watermark appliqué sur les documents affichés en admin. Chiffrement AES-256 au repos, bucket Supabase Storage privé, URLs signées à durée limitée. Statut initial `PENDING`.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-202 — En tant qu'Admin KYC, je valide ou rejette un dossier KYC avec justification obligatoire
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 2 — KYC. Rôle Admin KYC (modele-skillafrica-v3-Flexwork.md §13) : valide/rejette le KYC, seule vérification effective — max 30 validations/heure, justification obligatoire à chaque décision.

Tâche (US-202) : En tant qu'Admin KYC, je valide ou rejette un dossier KYC en attente, avec justification obligatoire.
Précision technique : Statuts `PENDING`/`VALIDATED`/`REJECTED`. Champ `rejection_reason` obligatoire si rejet. Garde-fou serveur : max 30 validations par admin par heure glissante (anti-cadence-suspecte). Chaque décision journalisée dans `admin_audit_log` (voir Phase 8, US-801) avec l'identité de l'admin et le motif.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

**✅ Implémenté** (2026-08-06) — étendu au-delà du périmètre initial : la décision (`POST /api/admin/kyc/[userId]/decision`) déclenche désormais une **notification double canal** vers l'utilisateur (`src/lib/notify.ts`) — en base via le nouveau modèle `Notification` (cloche dans `Nav`, tous les dashboards) et par e-mail (`src/lib/mail.ts`, Mailpit en dev). Une fois `kycStatus = verifie`, `POST /api/kyc/upload` refuse toute resoumission (409 `kyc_already_verified`) et `/kyc` remplace le formulaire par un état "Identité vérifiée" (plus de resoumission possible côté UI non plus). Vérifié en direct : email reçu, notification visible dans la cloche, 409 confirmé sur tentative de renvoi.

### US-203 — En tant que plateforme, je conditionne la publication d'une mission et la candidature à un KYC validé, jamais l'inscription elle-même
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 2 — KYC. Règle de blocage impérative (modele-skillafrica-v3-Flexwork.md §9) : « Le KYC ne bloque JAMAIS l'inscription ni la complétion du profil. Le KYC VALIDATED conditionne UNIQUEMENT : Client → PUBLIER une mission ; Prestataire → CANDIDATER à une mission. »

Tâche (US-203) : En tant que plateforme, je bloque uniquement la publication de mission (client) et la candidature (prestataire) tant que le KYC n'est pas `VALIDATED` — jamais l'inscription ni la navigation.
Précision technique : Guard côté API (pas seulement UI) sur les deux endpoints concernés uniquement. Toute autre route (profil, déclarations Phase 3, consultation) reste accessible sans KYC validé.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-204 — En tant que plateforme, j'affiche le badge unique « Identité vérifiée » ou « Non vérifié », sans aucun autre badge
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 2 — KYC. Modèle v3 §9 : « Badge unique : badge = (kyc.status == VALIDATED) ? IDENTITE_VERIFIEE : NON_VERIFIE. Aucun autre badge. Tout le reste est déclaratif. »

Tâche (US-204) : En tant que plateforme, j'affiche un badge binaire dérivé uniquement du statut KYC.
Précision technique : Composant `<BadgeIdentite>` unique, dérivé (jamais stocké séparément) de `kyc_verifications.status`. Aucune table `badges` multi-filières, aucun code `CERT-*`, aucune notion de statut provisoire à échéance (VAE) — ce mécanisme est explicitement supprimé (A1, etat-consolide-Flexwork.md §2).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-205 — En tant qu'Admin KYC, je saisis la date de naissance extraite de la pièce d'identité, seule donnée d'âge faisant foi

*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 2 — KYC. A13 (etat-consolide-Flexwork.md §2) : deuxième exception au modèle purement déclaratif (après l'assurance sur le risque élevé, A9) — une VÉRIFICATION EFFECTIVE par la plateforme. `users.date_naissance` (+ `date_naissance_set_by_id`, `date_naissance_set_at`) n'est renseigné que par l'Admin KYC au moment de la décision, jamais déclaré par l'utilisateur lui-même.

Tâche (US-205) : En tant qu'Admin KYC, je saisis la date de naissance lue sur la pièce d'identité lors de ma décision (US-202), qui devient la seule donnée d'âge faisant foi pour le contrôle des filières chantier (US-206).
Précision technique : Champ optionnel sur le payload de décision KYC (`src/app/api/admin/kyc/[userId]/decision/route.ts`) — n'écrase `date_naissance` que si fourni. Ne jamais accepter cette donnée depuis une route côté utilisateur.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-206 — En tant que plateforme, je bloque l'activation d'un profil filière chantier en dessous du seuil d'âge minimum du pays, réévalué dynamiquement

*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 2 — KYC / Phase 1 — Comptes. A13 (etat-consolide-Flexwork.md §2) : seuil d'âge minimum sur les filières chantier (Manœuvre, Artisan, Expert BTP/Autres) administrable PAR PAYS via `country_age_requirements` (country, profile_type, domain optionnel, minimum_age, legal_reference, justification), mais avec un plancher absolu et non négociable de 18 ans — l'admin ne peut ajuster que vers le haut (ex. 21 ans pour la conduite d'engins).

Tâche (US-206) : En tant que plateforme, je refuse l'activation (création/mise à jour) d'un profil filière chantier tant que l'âge calculé depuis `users.date_naissance` (US-205) est inférieur au seuil applicable (règle pays sinon plancher légal de 18 ans).
Précision technique : Le blocage porte sur l'ACTIVATION DU PROFIL, pas seulement sur la candidature à une mission — vérifié dans `src/app/api/profile/route.ts` via `isChantierProfileAllowed` (`src/lib/age-gate.ts`), jamais un statut figé stocké en base : réévaluation en direct à chaque appel, pour qu'un profil refusé à 17 ans s'active de lui-même à 18 ans sans repasser le KYC. Toute valeur `minimum_age < 18` doit être rejetée côté serveur (`isValidMinimumAge`), pas seulement empêchée côté UI admin.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 3 — Déclarations professionnelles
**Objectif :** formulaires de déclaration (assurance, qualifications, expérience), documents joints consultables, textes d'engagement figés et horodatés, affichage en trois blocs séparés.

### US-301 — En tant que prestataire, je déclare mes qualifications avec document joint, jamais vérifié par la plateforme
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 3 — Déclarations (modele-skillafrica-v3-Flexwork.md §5). Tables `professional_declarations` (id, profile_id, declaration_type INSURANCE|QUALIFICATION, insurer_name, policy_number, coverage_ceiling, valid_until, declared_at, declaration_text_snapshot, ip_address, user_agent, signature_reference, previous_hash, current_hash) et `declaration_documents`.

Tâche (US-301) : En tant que prestataire, je déclare une qualification (diplôme/certification) avec un document joint consultable.
Précision technique : `declaration_type = QUALIFICATION`. Le document est stocké et rendu consultable au client (`declaration_documents`), jamais vérifié par un admin. `declaration_text_snapshot` fige le texte de la déclaration au moment de la saisie (immuable). Affichage obligatoire : « [Intitulé] — déclaré par le prestataire, document joint, non vérifié par Flexwork » (formulation imposée, modele-skillafrica-v3-Flexwork.md §5).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-302 — En tant que prestataire, je déclare mon assurance de responsabilité civile professionnelle et j'en garantis l'exactitude
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 3 — Déclarations (modele-skillafrica-v3-Flexwork.md §4). Table `professional_declarations` (declaration_type = INSURANCE).

Tâche (US-302) : En tant que prestataire, je déclare une assurance RC professionnelle (assureur, numéro de police, plafond, validité) avec un texte de garantie engageant.
Précision technique : Texte figé obligatoire à la déclaration : « Je déclare détenir une assurance de responsabilité civile professionnelle valide, souscrite auprès de [assureur] sous le numéro de police [numéro], d'un plafond de [montant], valable jusqu'au [date]. Je garantis le client et Flexwork contre toute conséquence d'une déclaration inexacte ou d'un défaut de couverture. » — stocké dans `declaration_text_snapshot`, avec `ip_address`/`user_agent` et hash chaîné (`previous_hash`/`current_hash`, append-only, jamais de UPDATE destructif).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-303 — En tant que plateforme, j'implémente la chaîne de hash append-only sur les déclarations
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 3 — Déclarations, socle transverse aussi utilisé par `verification_history` (Phase 8). Traçabilité append-only avec hash chaîné — élément qui a survécu à tous les arbitrages (etat-consolide-Flexwork.md §1.3).

Tâche (US-303) : En tant que plateforme, je chaîne chaque nouvelle déclaration au hash de la précédente (par profil), pour garantir l'intégrité et l'immuabilité de l'historique.
Précision technique : `current_hash = sha256(previous_hash + declaration_text_snapshot + declared_at + profile_id)`. Aucune route ne doit permettre de UPDATE ou DELETE une déclaration existante — une correction crée une nouvelle déclaration, l'ancienne reste consultable et horodatée. Fonction de vérification d'intégrité de la chaîne testée unitairement (rejeu de la chaîne, détection d'un maillon altéré).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-304 — En tant qu'utilisateur, je consulte un profil affiché en trois blocs strictement séparés
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 3 — Déclarations. Modèle v3 §10 : séparation visuelle structurante entre ce que la plateforme garantit (identité) et ce dont elle n'est que le support (déclarations, activité).

Tâche (US-304) : En tant qu'utilisateur, je consulte un profil prestataire présenté en trois blocs distincts : « Vérifié par Flexwork » (identité uniquement), « Déclaré par le prestataire (non vérifié) » (assurance, qualifications, expérience, niveau, tarif indicatif), « Activité sur la plateforme » (missions complétées, note, ancienneté).
Précision technique : Les trois blocs ne doivent jamais être visuellement fusionnés ni réordonnés de façon à suggérer une hiérarchie de confiance égale entre « vérifié » et « déclaré ». Le bloc « Activité » (avis, missions complétées) peut être affiché sans réserve — ce sont des faits d'usage constatés par la plateforme, pas des déclarations (modele-skillafrica-v3-Flexwork.md §10.1).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-305 — En tant que prestataire, je déclare mon niveau professionnel et mon expérience, de façon purement auto-déclarative
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 3 — Déclarations. `profiles.declared_level`, `declared_experience_years`. Aucun algorithme de scoring ni niveau calculé (A4, etat-consolide-Flexwork.md §2) — le niveau redevient auto-déclaré.

Tâche (US-305) : En tant que prestataire, je choisis mon niveau (Débutant à Expert) et déclare mes années d'expérience et mon nombre de réalisations.
Précision technique : Aucun calcul serveur, aucune pondération, aucun test d'entrée bloquant. Simple champ auto-déclaré affiché tel quel dans le bloc « Déclaré par le prestataire » de US-304.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-306 — En tant qu'Admin Modération, je retire une déclaration manifestement frauduleuse signalée par un tiers
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 3 — Déclarations / Phase 8 — Modération. Rôle Admin Modération (modele-skillafrica-v3-Flexwork.md §13) : agit sur signalement, pas de vérification systématique.

Tâche (US-306) : En tant qu'Admin Modération, je retire une déclaration signalée comme manifestement frauduleuse et je peux suspendre le compte pour fausse déclaration.
Précision technique : Le retrait ne se déclenche que sur signalement d'un tiers (client, autre prestataire), jamais par une revue systématique — la plateforme ne s'engage pas à vérifier, seulement à réagir aux signalements manifestes (modele-skillafrica-v3-Flexwork.md §5). Action journalisée dans `admin_audit_log` avec justification obligatoire.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 4 — Missions & contrat de prestation
**Objectif :** création de mission, paliers de risque par domaine, génération du contrat de prestation, signature des deux parties, avertissements et consentement éclairé.

### US-401 — En tant que client, je publie une mission avec un domaine qui détermine son palier de risque
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. Table `missions` (id, client_id, title, description, domain, risk_level [dérivé de domain_risk_levels], insurance_required [dérivé, true si HIGH], budget, currency, deadline, contract_id, status). Table `domain_risk_levels` (id, domain, country, risk_level LOW|MEDIUM|HIGH, insurance_required, amount_threshold, justification).

Tâche (US-401) : En tant que client, je publie une mission ; son domaine détermine automatiquement son palier de risque et si une assurance effective est requise.
Précision technique : `risk_level` et `insurance_required` sont calculés côté serveur depuis `domain_risk_levels` au moment de la publication, jamais saisis par le client. KYC validé requis pour publier (US-203). Palier LOW en V1 par défaut sur les domaines non encore classés — ne jamais bloquer silencieusement sur un domaine manquant en base.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

**✅ Implémenté** (2026-08-06) — bug corrigé : `POST /api/missions` forçait `status: "publiee"` et exigeait le KYC sur toute création, y compris un brouillon (`Mission.status` a pourtant `brouillon` en valeur par défaut) — contradiction avec la règle US-203 (le KYC ne conditionne QUE la publication). `missionSchema` accepte maintenant `status: "brouillon"|"publiee"` et `budget` optionnel pour un brouillon ; le garde KYC ne s'applique qu'à `status: "publiee"`. Vérifié en direct : brouillon créé sans KYC (200), publication toujours bloquée sans KYC (403).

### US-402 — En tant que plateforme, je génère un contrat de prestation entre client et prestataire dont je ne suis pas signataire
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. Table `prestation_contracts` (id, mission_id, client_id, provider_id, contract_document_url, client_signed_at, provider_signed_at, terms_snapshot JSON, acceptance_deadline_days, previous_hash, current_hash). Contenu minimal imposé (modele-skillafrica-v3-Flexwork.md §2.1) : identité des deux parties telles que vérifiées KYC, objet/périmètre/livrables, prix/devise/conditions de libération, délais, déclaration d'assurance et de qualification du prestataire (ou mention explicite d'absence), responsabilités respectives, clause de médiation facultative, mention explicite « Flexwork n'est pas partie au présent contrat. »

Tâche (US-402) : En tant que plateforme, je génère automatiquement un contrat de prestation à partir de la mission acceptée et des dernières déclarations du prestataire.
Précision technique : Le contrat est un OUTIL fourni par la plateforme, jamais signé par elle — seuls `client_signed_at` et `provider_signed_at` existent, aucun champ `platform_signed_at`. `terms_snapshot` fige les conditions au moment de la génération (immuable, même si le profil change ensuite). La mention « Flexwork n'est pas partie au présent contrat » est un test de non-régression obligatoire sur le template.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-403 — En tant que client et prestataire, je signe électroniquement le contrat de prestation
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. `prestation_contracts.client_signed_at`/`provider_signed_at`. Prérequis juridique bloquant #6 (etat-consolide-Flexwork.md §5) : validité de la génération automatique de contrats entre tiers, forme et signature électronique — à confirmer avant mise en production réelle, développable dès maintenant derrière un flag.

Tâche (US-403) : En tant que client et prestataire, je signe électroniquement le contrat de prestation généré (US-402).
Précision technique : Le contrat n'est actif (mission passant en exécution) qu'une fois les deux signatures apposées. Développer derrière un feature flag `contract_e_signature_enabled` par pays, en attendant la validation juridique du prérequis #6 — ne jamais activer en production tant que ce prérequis n'est pas levé.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-404 — En tant que client, je reçois un avertissement explicite avant de retenir un prestataire sans assurance déclarée sur une mission à risque moyen ou élevé
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. Table `client_acknowledgements` (id, client_id, mission_id, provider_id, acknowledgement_type NO_INSURANCE|UNVERIFIED_QUALIFICATION, text_snapshot, acknowledged_at, ip_address).

Tâche (US-404) : En tant que client, je reçois un avertissement explicite et je consens en connaissance de cause avant de retenir un prestataire sans assurance déclarée, sur une mission de risque moyen ou élevé.
Précision technique : Texte imposé (modele-skillafrica-v3-Flexwork.md §4.4) : « Ce prestataire n'a déclaré aucune assurance de responsabilité civile professionnelle. En cas de dommage pendant les travaux, aucune indemnisation par une assurance ne sera possible... » avec case à cocher explicite. Le consentement est horodaté et conservé (`client_acknowledgements`), il ne rend jamais la plateforme garante — c'est une preuve de choix éclairé, pas une clause de protection de la plateforme substituable à l'assurance elle-même.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-405 — En tant qu'utilisateur, j'échange en chat temps réel sur ma mission
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats, socle transverse déjà validé dans les itérations précédentes du produit.

Tâche (US-405) : En tant qu'utilisateur, j'échange en chat temps réel avec l'autre partie sur ma mission.
Précision technique : Supabase Realtime. Aucune dépendance sur le statut du contrat — le chat reste disponible pendant la négociation, avant signature.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-406 — En tant que client et prestataire, j'active ensemble un outil de pointage optionnel qui ne fait jamais remonter d'information à la plateforme

*Priorité Should*
**Go/no-go** : ne pas livrer en production tant que le prérequis bloquant #7 (protection des données / déclaration APDP, §17) n'est pas au statut « validé » dans US-001. Développable et testable dès maintenant derrière un flag, mais rester désactivé par défaut — si le prérequis #7 n'est pas levé avant la fin du sprint, ne pas l'exposer aux utilisateurs en V1.

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. A12 (etat-consolide-Flexwork.md §2) réintroduit l'outil de pointage comme preuve de présence ENTRE les parties, pas comme système d'information de la plateforme. Règle structurante : « Les données de pointage TRANSITENT par la plateforme, elles ne l'INFORMENT PAS. » Trois conditions impératives : (1) opt-in réellement libre, refus sans aucune conséquence sur le reste du contrat ; (2) horodatage ponctuel arrivée/départ uniquement, jamais de suivi continu ; (3) activation par mission par les DEUX parties via le contrat, jamais par la plateforme. Tables `prestation_contracts.client_opted_in_check_in`/`provider_opted_in_check_in`, `check_in_events` (id, contract_id, party_id, type ARRIVEE|DEPART, occurred_at, gps_lat, gps_lng, retain_until).

Tâche (US-406) : En tant que client et prestataire, j'active ou non le pointage sur mon contrat (mon consentement uniquement, indépendant de l'autre partie) ; une fois les deux consentements réunis, chacun peut enregistrer ses horodatages ponctuels d'arrivée/départ, visibles seulement par les deux parties du contrat.
Précision technique : `isCheckInToolActive` (`src/lib/checkin-tool.ts`) exige les deux opt-in avant d'accepter tout évènement. Rétention courte — durée de la mission + délai de contestation de 7 jours (`computeCheckInRetentionDate`), puis purge (job de nettoyage non couvert par cette story). Aucune route, aucun job, aucun tableau de bord admin ne doit jamais agréger, scorer, classer ou faire dépendre une décision (paiement, litige, visibilité) de ces évènements — c'est le test de conformité n°8 : implémenter cette « cécité technique » comme une contrainte d'architecture (aucune table de statistiques agrégées sur `check_in_events`, aucune jointure depuis une route de scoring), pas seulement comme une convention documentaire. Consultable uniquement par les deux parties du contrat concerné ; producible comme preuve en médiation (Phase 6) seulement à l'initiative d'une des parties, jamais consultée d'office par un admin.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique — y compris un test de non-régression garantissant qu'aucune route admin/scoring ne lit `check_in_events`.
Contrainte : ne pas casser les stories déjà livrées ; rester derrière un flag désactivé par défaut tant que US-001 n'a pas validé le prérequis #7.
```

**✅ Implémenté** (2026-08-06) — `Mission.mode` (enum `distance|presentiel|hybride`), `src/app/api/missions/[id]/proposals/route.ts`.

### US-407 — En tant que prestataire, mes exigences de candidature dépendent du mode de la mission (à distance, présentiel, hybride)
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. Une mission 100% à distance ne présente pas le même risque physique/logistique qu'une mission en présentiel ou hybride (le prestataire se déplace chez le client, ou l'inverse) — les garde-fous déjà prévus ailleurs (garant obligatoire pour Artisan/Manœuvre, etat-consolide-Flexwork.md §1.3 ; assurance effective sur risque HIGH, US-702) n'ont de sens que pour ce second cas. `Mission.mode` (enum `distance|presentiel|hybride`, défaut `presentiel`).

Tâche (US-407) : En tant que prestataire, je ne peux candidater (US non numérotée dans le catalogue existant — cette story documente `POST /api/missions/[id]/proposals`) que si mon KYC est vérifié (US-203, dans tous les cas) ET, uniquement si la mission n'est pas en mode `distance` : j'ai déclaré au moins un garant obligatoire (`hasRequiredGarants`, `src/lib/garant-rules.ts`) et, si la mission est en outre classée `risk_level = HIGH` (US-701), au moins une déclaration d'assurance RC Pro non retirée.
Précision technique : Le mode se choisit à la publication de la mission (`missions/new`), jamais modifiable après candidatures reçues (non contrôlé côté serveur actuellement — à ajouter si un abus est constaté). Gate implémentée server-side dans `POST /api/missions/[id]/proposals`, avec des codes d'erreur distincts (`garant_required`, `insurance_required`) plutôt qu'un unique 403 générique, pour que le prestataire sache exactement quoi compléter. Le mode `distance` ne dispense jamais du KYC (US-203) — seul le garant et l'assurance en sont dispensés.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

**✅ Implémenté** (2026-08-06) — vérifié en direct contre la base réelle (garant manquant → 403, assurance manquante → 403, les deux réunis → candidature créée, mode distance → aucune exigence).

### US-408 — En tant que client ou prestataire, je joins des pièces à ma mission (cahier des charges, livrable) une fois une proposition acceptée
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4 — Missions & contrats. Table `MissionAttachment` (id, missionId, uploaderId, filePath, createdAt) existait déjà (upload seul, `POST /api/missions/[id]/attachments`) mais sans aucun moyen de lister ni télécharger les fichiers déposés — aucune page ne l'utilisait.

Tâche (US-408) : En tant que client ou prestataire participant à une mission (propriétaire ou candidature envoyée/acceptée), je consulte la liste des pièces jointes et j'en ajoute de nouvelles, tant que la mission n'en est pas encore au stade candidature (`canAttachLivrable`, `src/lib/attachments.ts` — bloque tant que `status` ∈ {`brouillon`, `publiee`}, pour empêcher le travail-test gratuit avant qu'une proposition ne soit acceptée).
Précision technique : Fichiers servis via le même mécanisme de token signé HMAC à durée limitée (5 min) que les documents de déclaration (`src/lib/storage.ts`, `signPrivateFileToken`/`verifyPrivateFileToken`), nouveau `kind: "mission_attachment"` ajouté à `GET /api/files/[token]` avec son propre contrôle d'accès (client ou prestataire ayant candidaté à la mission, pas « tout utilisateur authentifié » comme pour les documents de déclaration). UI intégrée à `src/app/missions/[id]/page.tsx`, réutilisant le patron `.card`/`.btn` déjà en place sur cette page plutôt que d'introduire des classes Tailwind isolées.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

**✅ Implémenté** (2026-08-06) — vérifié en direct : upload bloqué avant acceptation (403), autorisé après signature, listé avec URL signée, téléchargement authentifié réussi.

### US-409 — En tant que client, je fractionne le paiement d'un contrat en jalons dont chacun suit son propre cycle séquestre → livrable → libération
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 4/5 — Missions & contrats / Séquestre PSP. Analyse comparative avec un modèle de référence du marché (2026-08-06) : l'absence de paiement fractionné était l'écart le plus visible entre le cycle v3 (un seul HOLD → RELEASE par mission, `prisma/schema.prisma` documentait déjà ce choix comme volontaire) et un parcours client perçu comme professionnel sur un projet de plusieurs semaines. Nouveau modèle `Jalon` (id, contractId, ordre, titre, montant, status `en_attente|fonds_sous_sequestre|livrable_soumis|valide|rejete|libere`, rejectionReason, revisionCount), rattaché à `PrestationContract`. `PspEscrowOperation.jalonId` et `MissionAttachment.jalonId` nullables — un contrat SANS jalon garde exactement l'ancien comportement (jalonId = null partout, un seul mouvement HOLD/RELEASE sur le prix total).

Tâche (US-409) : En tant que client, au moment de générer le contrat (US-402), je peux optionnellement décomposer le prix convenu en plusieurs jalons (titre + montant, devant sommer exactement au prix de la proposition acceptée) ; chaque jalon se finance, reçoit son livrable, se valide ("Vérifier") ou se rejette ("Révision", motif obligatoire, `revisionCount` incrémenté) et se libère indépendamment des autres.
Précision technique : Toute la validation vit dans `src/lib/jalons.ts` (`validateJalonsSum`, testé unitairement). Routes dédiées sous `/api/missions/[id]/jalons/[jalonId]/{hold,deliverable,validate,reject}`, miroir exact des garde-fous des routes historiques (`escrow/hold`, `deliverable`, `escrow/release`) — mêmes vérifications (contrat signé des deux côtés, flag PSP par zone, assurance effective si risque élevé), jamais de libération optimiste (statut `pending` jusqu'à confirmation webhook signée, `src/lib/psp-webhook.ts`). Les routes historiques (`escrow/hold`, `escrow/release`, `deliverable`) renvoient `409 use_jalon_*` si le contrat a des jalons, pour ne jamais mélanger les deux mécanismes sur un même contrat. La mission passe automatiquement `cloturee` quand TOUS les jalons du contrat sont `libere` (calculé au webhook, pas une action cliente séparée).
Hors périmètre volontaire de cette story (à ne pas confondre avec le paiement fractionné lui-même) : le mécanisme de litige à escalade structurée (validation tacite avec délai, calcul de prorata, fenêtre d'appel 48h, arbitrage) resté identique à la médiation simple existante (Phase 6) — un chantier séparé, plus sensible juridiquement (US-601/602/603 restent la seule voie de contestation, y compris sur un jalon).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées — en particulier US-501 à US-505 pour les contrats sans jalon.
```

**✅ Implémenté** (2026-08-06) — vérifié en direct de bout en bout contre la vraie base (mission réelle, 2 comptes réels, webhooks signés HMAC réels) : contrat à 3 jalons généré (somme validée), signatures des deux parties, jalon 1 financé → webhook HOLD confirmé → jalon `fonds_sous_sequestre` (jalons 2/3 intacts) → livrable soumis → **rejeté** par le client (motif, `revisionCount: 1`) → resoumis → validé → webhook RELEASE confirmé → jalon `libere`. Répété pour les jalons 2 et 3 (financement en parallèle, sans contrainte d'ordre) → une fois les 3 `libere`, mission passée automatiquement `cloturee`. Garde-fous confirmés : `escrow/hold` sur un contrat à jalons → `409 use_jalon_hold`.

---

## Phase 5 — Séquestre via PSP
**Objectif :** intégration du PSP agréé, instructions HOLD/RELEASE/FREEZE, webhooks, acceptation tacite comme clause contractuelle.
**Prérequis bloquant** : contrat PSP signé + validation juridique du montage (etat-consolide-Flexwork.md §5, point 2). **Ne pas activer en production avant la levée de ce prérequis.**

### US-501 — En tant que plateforme, je transmets une instruction de mise sous séquestre au PSP, sans jamais détenir les fonds
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 5 — Séquestre PSP (prérequis bloquant : contrat PSP signé + validation juridique, etat-consolide-Flexwork.md §5). Table `psp_escrow_operations` (id, contract_id, psp_name, psp_reference, amount, currency, instruction_type HOLD|RELEASE|FREEZE|REFUND, instruction_sent_at, psp_confirmed_at, webhook_reference, status). Remplace intégralement l'ancien modèle `transactions_escrow`/`Wallet` où la plateforme créditait des soldes internes.

Tâche (US-501) : En tant que plateforme, une fois le contrat signé par les deux parties (US-403), je transmets au PSP une instruction `HOLD` pour le montant convenu.
Précision technique : La plateforme ne crée AUCUN mouvement de solde interne (pas de `Wallet`, pas de crédit/débit local représentant les fonds de la mission) — elle transmet une instruction et attend une confirmation. `status` de l'opération reste `PENDING` jusqu'à confirmation webhook (US-503), jamais mis à `CONFIRMED` de façon optimiste côté serveur.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-502 — En tant que prestataire, je suis notifié que les fonds sont sécurisés chez le PSP et je peux commencer la mission
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 5 — Séquestre PSP. Cycle complet (modele-skillafrica-v3-Flexwork.md §6.3) : contrat signé → paiement PSP → fonds sous séquestre chez le PSP → notification prestataire → travaux → libération.

Tâche (US-502) : En tant que prestataire, je suis notifié dès que le PSP confirme la mise sous séquestre (« fonds sécurisés chez [PSP], vous pouvez commencer »).
Précision technique : Déclenché uniquement par la confirmation webhook de l'opération `HOLD` (US-503), jamais par la simple création de l'instruction côté plateforme.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-503 — En tant que plateforme, je confirme tout mouvement d'escrow exclusivement via webhook PSP signé, jamais par capture manuelle
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 5 — Séquestre PSP. Règle impérative héritée sans changement (etat-consolide-Flexwork.md §1.3) : « Confirmation de paiement par webhook uniquement ».

Tâche (US-503) : En tant que plateforme, je ne fais passer une `psp_escrow_operations.status` à `CONFIRMED` que sur réception d'un webhook signé du PSP.
Précision technique : Signature HMAC vérifiée sur le corps brut. Aucune route admin de confirmation manuelle, même exceptionnelle — recréerait exactement la faille que cette règle ferme. `webhook_reference` stocké pour traçabilité et idempotence (rejouer le même webhook ne duplique rien).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-504 — En tant que client, je valide un livrable et déclenche l'instruction de libération des fonds au PSP
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 5 — Séquestre PSP.

Tâche (US-504) : En tant que client, je valide le livrable soumis par le prestataire, ce qui déclenche une instruction `RELEASE` transmise au PSP.
Précision technique : Instruction `RELEASE` créée dès validation client, mais `psp_escrow_operations.status` ne passe `CONFIRMED` qu'au webhook (US-503) — pas de libération optimiste. Les conditions de libération figurent dans le contrat de prestation (US-402), pas dans une règle générique de la plateforme.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-505 — En tant que plateforme, j'applique l'acceptation tacite après le délai contractuel si le client ne réagit pas
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 5 — Séquestre PSP. Élément qui a survécu à tous les arbitrages (etat-consolide-Flexwork.md §1.3) : « Acceptation tacite pour protéger le prestataire du client passif ». Modèle v3 §6.4 : c'est une clause du contrat entre parties, pas une règle imposée unilatéralement par la plateforme.

Tâche (US-505) : En tant que plateforme, si le client ne valide ni ne conteste un livrable dans le délai `acceptance_deadline_days` du contrat (7 jours proposé, point ouvert #3 du modèle v3), je transmets automatiquement l'instruction `RELEASE` au PSP.
Précision technique : Le délai est lu depuis `prestation_contracts.acceptance_deadline_days`, jamais une constante globale codée en dur — il doit pouvoir varier si une future version du contrat-type change ce délai. Job planifié (cron) qui vérifie les contrats en attente de validation dont le délai est dépassé.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 6 — Médiation
**Objectif :** ouverture, gel, dépôt d'éléments, proposition de résolution, acceptation par les parties, transmission au PSP.

### US-601 — En tant qu'utilisateur, j'ouvre une médiation sur ma mission, ce qui gèle les fonds chez le PSP
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 6 — Médiation. Remplace intégralement l'ancien modèle `Litige` à arbitrage opposable sous 5 jours. Table `mediations` (id, contract_id, opened_by, reason, client_elements, provider_elements, proposed_resolution, client_accepted, provider_accepted, outcome AGREEMENT|NO_AGREEMENT|WITHDRAWN, mediator_admin_id, created_at, closed_at).

Tâche (US-601) : En tant qu'utilisateur (client ou prestataire), j'ouvre une médiation avec un motif et des éléments de preuve, ce qui transmet une instruction `FREEZE` au PSP.
Précision technique : L'ouverture d'une médiation ne « tranche » rien — elle gèle simplement les fonds en attendant une résolution. Ne jamais nommer cette fonctionnalité « litige arbitré » ni suggérer une décision opposable dans l'UI (test de conformité §16, point 6).

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-602 — En tant qu'Admin Médiation, je propose une résolution sans jamais la trancher unilatéralement
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 6 — Médiation. Rôle Admin Médiation (modele-skillafrica-v3-Flexwork.md §13) : instruit les médiations, propose des résolutions — ne décide pas, ne libère aucun fonds unilatéralement.

Tâche (US-602) : En tant qu'Admin Médiation, je consulte les éléments déposés par les deux parties et je propose une résolution (`proposed_resolution`).
Précision technique : Aucune route admin ne doit permettre de transmettre une instruction PSP directement depuis cette proposition — la résolution doit d'abord être acceptée par les deux parties (US-603) avant toute transmission au PSP.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-603 — En tant que client et prestataire, j'accepte ou refuse la résolution proposée
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 6 — Médiation. Cycle complet (modele-skillafrica-v3-Flexwork.md §8) : contestation → gel PSP → médiation proposée → accord (instruction PSP conforme à l'accord) OU pas d'accord (fonds restent gelés selon conditions PSP, parties saisissent la juridiction compétente, la plateforme transmet les éléments sur demande).

Tâche (US-603) : En tant que client et prestataire, j'accepte ou je refuse la résolution proposée par l'Admin Médiation (US-602).
Précision technique : Si les deux parties acceptent (`client_accepted` et `provider_accepted` = true), `outcome = AGREEMENT` et une instruction PSP conforme à l'accord est transmise. Si l'une refuse, `outcome = NO_AGREEMENT`, les fonds restent gelés selon les conditions du PSP — aucune transmission d'instruction automatique. La plateforme transmet les éléments du dossier sur demande d'une juridiction, elle ne les publie ni ne les exploite autrement.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 7 — Risque élevé & assurance à la mission
**Objectif :** `domain_risk_levels`, blocage sur risque élevé, intégration de l'assureur partenaire, prime prélevée dans le paiement.
**Prérequis bloquant** : existence d'un produit d'assurance à la mission au Bénin + statut de distribution validé (etat-consolide-Flexwork.md §5, point 4 ; point ouvert #1 du modèle v3).

### US-701 — En tant qu'admin, je classe les domaines par palier de risque (faible/moyen/élevé)
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 7 — Risque élevé. Table `domain_risk_levels` (id, domain, country, risk_level LOW|MEDIUM|HIGH, insurance_required, amount_threshold, justification). Paliers de référence (modele-skillafrica-v3-Flexwork.md §7.2) : Faible = peinture/jardinage/nettoyage/digital ; Moyen = plomberie/menuiserie/carrelage/maçonnerie légère ; Élevé = électricité/travail en hauteur/gros œuvre/engins de chantier/structures porteuses.

Tâche (US-701) : En tant qu'admin, je gère le CRUD des paliers de risque par domaine et par pays.
Précision technique : `insurance_required = true` uniquement pour `risk_level = HIGH`, jamais configurable à false pour ce palier (garde-fou métier, pas seulement une convention d'usage). `amount_threshold` déclenche l'avertissement renforcé (US-404) sur le palier Moyen au-delà d'un montant.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-702 — En tant que plateforme, je bloque une mission à risque élevé sans assurance effective, sans fenêtre de tolérance
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 7 — Risque élevé. Seule exception assumée du modèle v3 (§7.1) : sur le risque élevé, la déclaration seule ne suffit pas, l'assurance doit être effective. « Assurance effective obligatoire — bloquante, sans fenêtre de tolérance. »

Tâche (US-702) : En tant que plateforme, je bloque le démarrage d'une mission classée `risk_level = HIGH` tant qu'une couverture effective (via `mission_insurance`, US-703, ou une police annuelle vérifiable) n'est pas active.
Précision technique : Contrôle serveur bloquant, pas seulement un avertissement UI (contrairement au risque moyen, US-404, qui informe mais ne bloque pas). Test de conformité §16 point 7 : aucune mission à risque élevé ne doit pouvoir démarrer sans couverture effective, sans exception ni délai de grâce.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-703 — En tant que client, je souscris une assurance à la mission au moment du paiement, sans avancer de trésorerie
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 7 — Risque élevé. Table `mission_insurance` (id, mission_id, insurer_name, policy_reference, premium_amount, coverage_ceiling, coverage_start, coverage_end, status). `[À VÉRIFIER]` (modele-skillafrica-v3-Flexwork.md §7.3) : existence du produit sur le marché béninois et statut réglementaire de distribution — ne pas activer en production avant confirmation.

Tâche (US-703) : En tant que client, sur une mission à risque élevé, je souscris une couverture ponctuelle (prime ≈ 2% du montant) intégrée au même paiement PSP, portée par un assureur partenaire.
Précision technique : La prime est prélevée dans le même mouvement de paiement puis reversée à l'assureur — la plateforme ne vérifie aucune police, l'assureur émet directement. Développer derrière un feature flag `mission_insurance_enabled`, jamais activé tant que les deux prérequis (§7.3) — produit disponible et statut de distribution validé — ne sont pas confirmés.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Phase 8 — Modération & traçabilité
**Objectif :** signalement, retrait de déclarations frauduleuses, `verification_history` append-only, `admin_audit_log` avec justification obligatoire.

### US-801 — En tant que plateforme, je journalise toute action admin avec justification obligatoire
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 8 — Modération & traçabilité. Table `admin_audit_log`. Élément qui a survécu à tous les arbitrages (etat-consolide-Flexwork.md §1.3) : « Séparation des pouvoirs administratifs » et « Traçabilité append-only avec hash chaîné ».

Tâche (US-801) : En tant que plateforme, chaque action admin (décision KYC, retrait de déclaration, proposition de médiation, classement de domaine à risque) écrit une entrée dans `admin_audit_log` avec l'identité de l'admin, l'action, la cible et une justification obligatoire non vide.
Précision technique : Table append-only (pas de UPDATE/DELETE exposé). Middleware/helper partagé réutilisé par toutes les routes admin plutôt qu'une journalisation ad hoc dupliquée par route.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

**✅ Implémenté** (2026-08-06) — `/admin` (`src/app/admin/page.tsx`) entièrement reconnecté aux vraies données (Prisma/PostgreSQL) : le contenu était auparavant 100% en dur (utilisateurs fictifs, chiffres inventés). Navigation par onglets (une rubrique à la fois, plus d'empilement scroll-spy). Rubriques sans contrepartie dans le schéma (Diplômes & VAE, Visites techniques, Retraits, Partenaires, Sessions de formation — vestiges de l'ancien modèle non migrés) retirées plutôt que laissées en mock. Deux files d'attente manquaient de route `GET` pour les alimenter : ajoutées (`/api/admin/garants/queue`, `/api/admin/mediations/queue`). Ajout de `DELETE /api/admin/users/[id]` (suppression de compte, justification obligatoire, journalisée, confirmation par saisie de l'email). Séparation des pouvoirs (US-13, §13) confirmée fonctionnelle en conditions réelles : un compte `adminRole: superviseur` reçoit un 403 explicite sur les décisions KYC/médiation, réservées aux rôles `kyc`/`mediation` — un compte par rôle existe désormais (`admin@flexwork.bj` = kyc, `admin-moderation@`, `admin-mediation@`, `admin-superviseur@`).

### US-802 — En tant qu'utilisateur, je signale une déclaration ou un profil suspect
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 8 — Modération & traçabilité. Alimente la file de travail de l'Admin Modération (US-306).

Tâche (US-802) : En tant qu'utilisateur, je signale une déclaration ou un profil que je juge frauduleux, avec un motif.
Précision technique : File d'attente admin triée par date de signalement. Pas de suppression immédiate automatique — un signalement ouvre une revue, il ne déclenche pas d'action punitive de façon autonome.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-803 — En tant qu'Admin Superviseur, je consulte en lecture seule et je revois mensuellement un échantillon de 5% des actions admin
*Priorité Should*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 8 — Modération & traçabilité. Rôle Admin Superviseur (modele-skillafrica-v3-Flexwork.md §13) : lit tout, ne modifie rien, instruit les recours, revue mensuelle de 5% des actions.

Tâche (US-803) : En tant qu'Admin Superviseur, je consulte `admin_audit_log` en lecture seule et j'échantillonne 5% des actions du mois pour revue.
Précision technique : Ce rôle n'a aucune permission d'écriture sur les entités métier (KYC, déclarations, médiations) — uniquement lecture sur les logs et les entités, pour instruire un recours. Tirage aléatoire de l'échantillon de 5%, horodaté, pour éviter tout biais de sélection.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

### US-804 — En tant que plateforme, j'implémente `verification_history` append-only pour tout évènement KYC et déclaration
*Priorité Must*

```
Tu travailles sur Flexwork, une plateforme Next.js 14 (App Router) + Tailwind + Shadcn, déployée sur Vercel, avec Supabase (Postgres, Auth, Storage, Realtime) en backend.

Contexte : Phase 8 — Modération & traçabilité. Table `verification_history`, hash chaîné, couvre KYC (Phase 2) et déclarations (Phase 3, US-303) dans un historique global consultable en cas de recours.

Tâche (US-804) : En tant que plateforme, chaque changement de statut KYC et chaque nouvelle déclaration écrit une entrée dans `verification_history`, chaînée par hash.
Précision technique : Réutilise le même mécanisme de chaînage que US-303 (`previous_hash`/`current_hash`) — ne pas réimplémenter une seconde logique de hash divergente. Fonction de vérification d'intégrité de la chaîne testée unitairement.

Livrables attendus : composants nécessaires, avec test(s) sur le chemin critique.
Contrainte : ne pas casser les stories déjà livrées.
```

---

## Annexe — Correspondance ancien modèle → v3

Pour l'équipe qui reprend un contexte de l'ancien modèle (4 filières, badges certifiés par la plateforme) :

| Ancien concept | Devenir en v3 |
|---|---|
| Badges Digital/CERT-ART/Expert/CERT-MAN, `Badge`/`Certification`/`ArtisanCertificate` | **Supprimés.** Un seul badge dérivé du KYC (US-204). Qualifications → `professional_declarations` (US-301). |
| Vérification admin des diplômes (appel CMA, décision expert) | **Supprimée.** Déclaration + document consultable, non vérifié (US-301). |
| VAE provisoire 3 mois | **Supprimée intégralement** (A1). Aucun équivalent — le niveau est auto-déclaré sans échéance (US-305). |
| Test d'entrée Digital (20 QCM), formation courte Expert obligatoire | **Supprimés** (A2). Niveau auto-déclaré (US-305). |
| Commission plateforme 5-15% par jalon (`FiliereConfig`/`Commission`) | **À reconcevoir** selon A7 — aucune commission sur une vérification/certification rendue obligatoire ; une commission sur les missions elles-mêmes n'est pas per se interdite par le modèle v3 mais n'est plus documentée ici, à trancher séparément. |
| Escrow interne (`TransactionEscrow`, `Wallet`, `WalletTransaction`) | **Remplacé** par `psp_escrow_operations` — instructions HOLD/RELEASE/FREEZE, la plateforme ne détient jamais les fonds (Phase 5). |
| `Litige` à arbitrage admin opposable sous 5 jours | **Remplacé** par `mediations` facultatives, non opposables (Phase 6). |
| 2 garants obligatoires (Artisan/Manœuvre) | **1 obligatoire + 2 optionnelles** (etat-consolide-Flexwork.md §1.3) — à ajuster dans le schéma `Garant`. |
| Pointage GPS+photo (F20), intégration SiteConnect (reconnaissance faciale/géofence) | **Réintroduit recadré (A12)** — plus de photo ni reconnaissance faciale, plus de géofence continu, plus d'intégration SiteConnect ; horodatage ponctuel arrivée/départ, opt-in des deux parties, jamais lu par la plateforme (US-406). |
| Machine à états Kanban 16 statuts (`missions.statut_kanban`) | **À simplifier** — le cycle v3 (§6.3) est HOLD → travaux → validation/tacite/contestation → RELEASE ou médiation, nettement plus court que 16 statuts ; à reconcevoir plutôt qu'à réutiliser tel quel. |
| Sessions de formation physique, partenaires CMA/CFP (`SessionFormation`, `Partenaire`) | **Hors périmètre plateforme** — la certification est déléguée à des organismes agréés externes, la plateforme n'organise plus de session ni ne collecte de frais de formation obligatoire dessus (A7). |
| Feature flags par filière/zone (`FeatureFlag`, gating Artisan/Manœuvre) | **À reconcevoir** autour des nouveaux prérequis bloquants (PSP, assurance à la mission, signature électronique) plutôt qu'autour de « filières ». |
