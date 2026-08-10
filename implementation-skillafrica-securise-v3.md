# Plan d'implémentation — SkillAfrica (Version Sécurisée v3.0 — corrigée et priorisée)
## Client, Expert Digital, Expert BTP/Autres, Artisan, Manœuvre

---

## 1. Objectif

Ce document unifie le plan fonctionnel et technique des **5 profils** de la plateforme SkillAfrica avec un renforcement sécuritaire intégral. Il fusionne le plan original avec les optimisations de sécurité, de traçabilité et d'anti-fraude.

**Profils couverts :**
- **Client**
- **Expert Digital**
- **Expert BTP/Autres**
- **Artisan**
- **Manœuvre**

**Principes de sécurité appliqués :**
- **Zero Trust** : aucun profil n'est de confiance par défaut
- **Défense en profondeur** : validation redondante à chaque niveau
- **Immuabilité** : audit trail inviolable
- **Séparation des pouvoirs** : administration segmentée
- **Circuit-breaker** : arrêt automatique en cas d'anomalie systémique

### 1.1 Niveaux d'implémentation (MVP / V2 / V3)

Toutes les mesures de sécurité n'ont pas le même rapport coût/bénéfice au lancement. Chaque mesure lourde est étiquetée dans ce document :

- **`[MVP]`** : à construire dès le lancement — coût de dev raisonnable, gain anti-fraude direct et immédiat.
- **`[V2]`** : à ajouter après la validation du marché (quelques mois de traction, premiers signaux de fraude réels) — coût de dev plus élevé, ou dépend d'un volume d'usage pour se justifier.
- **`[V3]`** : à réserver pour une échelle importante ou une exigence réglementaire spécifique — coût de dev élevé et/ou implications légales (biométrie, vidéosurveillance du personnel) à valider avant d'investir.

Les mesures non étiquetées sont considérées `[MVP]` par défaut (KYC gradué, rate limiting basique, escrow, personne ressource sans appel vocal obligatoire, etc.).

---

## 2. Tronc commun sécurisé

### 2.1 Inscription sécurisée

Données personnelles :
- Nom
- Prénom
- Pays
- Ville
- Localité
- Adresse
- Téléphone (vérifié par SMS + appel vocal si cluster suspect)
- Email (vérifié par double opt-in)
- Mot de passe (politique forte : 12 caractères min, complexité, hash bcrypt/Argon2)

**Anti-fraude à l'inscription :**
- **Unicité stricte** `[MVP]` : 1 compte par numéro de téléphone (vérifié par SMS vocal si nécessaire)
- **Détection de doublons** `[MVP pour email/téléphone/IP, V2 pour le fingerprinting navigateur, V2 pour le hash perceptuel photo]` : croisement email, téléphone, adresse IP, empreinte navigateur (fingerprinting), photo de profil (hash perceptuel)
- **Rate limiting** `[MVP]` : max 3 inscriptions par IP/jour
- **Analyse de graphe** `[V2/V3]` : détection de clusters (mêmes référents, mêmes technologies déclarées, mêmes clients) — nécessite un volume de données suffisant pour être fiable
- Si doublon détecté : fusion forcée des comptes ou suspension de tous les comptes liés

### 2.2 KYC gradué (Zero Trust)

Documents :
- Pièce d'identité (scan AV + watermark + OCR `[V2 pour la détection de falsification via IA]`)
- Selfie (comparaison faciale avec pièce d'identité `[MVP]` + comparaison à la base interne anti-sybil `[V2/V3]`, implications légales sur la biométrie à valider par pays avant implémentation)
- Selfie avec pièce d'identité

**Contraintes techniques documents :**
- Formats : PDF, JPG, PNG uniquement
- Taille max : 5 Mo
- Scan antivirus automatique (ClamAV) avant stockage
- Conversion PDF/A (archivage long terme)
- Watermark dynamique : `SkillAfrica — [ID utilisateur] — [Date]`
- Stockage : chiffrement AES-256 au repos + HTTPS en transit
- Bucket séparé : KYC (privé) vs Portfolio (public)
- Vérification IA : détection de falsification (métadonnées EXIF, cohérence polices, montage)

**Statuts KYC** : `PENDING`, `VALIDATED`, `REJECTED`

(le statut `SUSPENDED` s'applique au compte utilisateur — `users.status` — jamais au KYC lui-même ; voir la règle de suspension ci-dessous)

**Graduation des droits selon KYC :**

| Profil | KYC PENDING/REJECTED | KYC VALIDATED |
|--------|----------------------|---------------|
| **Client** | Créer brouillon mission. Publication bloquée. | Publication + paiement activé |
| **Expert** | Compléter profil. Candidature bloquée. | Candidature + badge évaluation activée |

**Règle unique de blocage (référence pour tout le document) :**

```text
KYC ne bloque JAMAIS :
  - l'inscription
  - la complétion du profil / la création d'un brouillon de mission

KYC VALIDATED bloque/débloque UNIQUEMENT :
  - Client   : la PUBLICATION d'une mission (+ le paiement)
  - Experts  : la CANDIDATURE à une mission (+ l'évaluation du badge)
```

**Règle de suspension de compte (distincte du statut KYC) :**
- KYC `REJECTED` 3 fois de suite → le **compte utilisateur** (pas le KYC) passe en `users.status = SUSPENDED` pendant 30 jours, puis révision manuelle admin obligatoire pour réactivation.
- Le statut `kyc_verifications.status` reste dans `PENDING` / `VALIDATED` / `REJECTED` uniquement — voir §25.1 et §25.3 pour la distinction avec `users.status`.

---

# PARTIE A — CLIENT

## 3. Inscription et KYC

Identiques au tronc commun sécurisé (§2.1, §2.2).

## 4. Badge Client

| KYC | Badge | Droits |
|---|---|---|
| VALIDATED | Vérifié | Publication + paiement |
| PENDING | Non vérifié | Brouillon uniquement (mission non publiable) |
| REJECTED (< 3 tentatives) | Non vérifié | Brouillon uniquement (mission non publiable) |
| REJECTED (3 tentatives) | Non vérifié | Compte `SUSPENDED` 30 jours (voir §2.2) |
| Non effectué | Non vérifié | Brouillon uniquement (mission non publiable) |

## 5. Missions

Un Client inscrit peut :
- Créer une mission (brouillon)
- Décrire son besoin
- Définir le domaine
- Définir le budget
- Définir les délais
- Publier la mission (uniquement si KYC VALIDATED)

Le badge du Client est visible sur son profil et ses missions.

**Sécurité missions :**
- CGV intégrées + smart contract simplifié (conditions, livrables, paiement)
- Paiement séquestre (escrow) activé par défaut

---

# PARTIE B — EXPERT DIGITAL

## 6. Domaines

Exemples :
- Développement Web
- Développement Mobile
- UI/UX Design
- Cybersécurité
- Réseaux
- Cloud
- Data
- Intelligence artificielle
- Marketing digital
- Community management
- Autres métiers numériques

Le test de compétences est associé au domaine déclaré.

## 7. Formation / Diplômes

**Diplôme de référence : diplômes d'État vérifiés auprès des organismes officiels — Bac, BTS, Licence, Master.**

L'Expert Digital peut déclarer, en plus du diplôme d'État :
- Certificat
- Formation professionnelle
- Certification technique
- Spécialité, établissement/organisme, lieu, année, document justificatif

Chaque qualification possède un statut : `PENDING`, `VALIDATED`, `REJECTED`.

Champ `is_state_issued` sur `expert_qualifications` pour distinguer le diplôme d'État (Bac/BTS/Licence/Master), pivot du moteur de badge, des autres certifications déclaratives.

**Sécurité qualifications :**
- Vérification humaine obligatoire (pas 100% automatique)
- Échantillon aléatoire de 20% audité manuellement
- Double validation pour les rejets (Admin A propose, Admin B confirme)

## 8. Expériences professionnelles

Module **critique pour la validation** — seul le statut `VALIDATED` intervient dans l'attribution du badge.

### Données
- Type de client : `INDIVIDUAL` ou `COMPANY`
- Nom du client/entreprise
- Domaine d'intervention
- Fonction/rôle
- Description
- Période
- Technologies utilisées
- Description de la réalisation
- Lien vers le projet
- Images/captures (modération automatique NSFW/copyright + signalement utilisateur)
- Documents justificatifs
- Lien vers le portfolio

### Portfolio

Fait partie du module Expériences. Peut être :
1. Un lien vers le portfolio général de l'Expert.
2. Un lien vers une réalisation spécifique.
3. Des images/documents liés à une expérience.

Statuts : `PENDING`, `VALIDATED`, `REJECTED`

**Sécurité expériences :**
- Échantillon aléatoire de 20% des expériences auditées manuellement
- Blacklist des entreprises clientes fictives (base interne croisée)

## 9. Test de compétences sécurisé

Statuts : `PENDING`, `PASSED`, `FAILED`

**Règle critique** : `TEST != PASSED → BADGE NON VÉRIFIÉ`, même si le KYC, les expériences et les diplômes sont validés.

**Anti-triche :**
- Randomisation des questions `[MVP]` (banque de questions par domaine, viser 500+ à terme)
- Détection de copier-coller / onglets multiples `[MVP]` (faisable côté client, coût de dev faible)
- Proctoring vidéo (caméra + écran) `[V2]` — coût d'infra (stockage vidéo) et de conformité vie privée à anticiper
- Empreinte digitale navigateur pour détecter les multi-comptes `[V2]`

**Filet humain :**
- 3 tentatives maximum, avec délai croissant (7j → 30j → 90j)
- Après 3 échecs : entretien technique vidéo avec un expert senior (évaluation humaine qui peut outrepasser le test automatique)
- Accommodements : mode oral pour personnes en situation de handicap, temps majoré sur justificatif médical

**Détail par compétence :**
- Score global stocké + détail par sous-domaine (ex: React 8/10, Node 6/10) pour cibler les formations

## 10. Moteur de badge — Expert Digital (avec VAE sécurisée)

```text
KYC = VALIDATED
EXPÉRIENCES = VALIDATED
TEST = PASSED
DIPLÔME D'ÉTAT = VALIDATED
    → BADGE = VERIFIED, VAE = NON

KYC = VALIDATED
EXPÉRIENCES = VALIDATED
TEST = PASSED
DIPLÔME D'ÉTAT != VALIDATED
    → BADGE = VERIFIED, VAE_TYPE = ANNUAL_CERTIFYING
```

### VAE annuelle renouvelable (sécurisée)

Un Bac/BTS/Licence/Master ne s'obtient pas en 3 mois. La VAE de l'Expert prend la forme d'une **formation certifiante avec partenaire externe, payante, renouvelable chaque année**.

**Mécanisme de renouvellement (plafond mou) :**

```text
DIPLÔME D'ÉTAT != VALIDATED
    → BADGE = VERIFIED (via formation certifiante)
    → Formation certifiante renouvelable chaque année
         ├── Année 1-2 : formation certifiante standard
         ├── Année 3 : entretien vidéo obligatoire avec validateur humain
         ├── Année 4+ : audit complet du parcours (revenus déclarés, missions complétées,
         │              évolution compétences) + preuve de progression vers diplôme d'État
         ├── Renouvelée chaque année (dans la limite) → BADGE reste VERIFIED
         ├── Diplôme d'État obtenu entre-temps → BADGE = VERIFIED, sortie définitive de la VAE
         └── Renouvellement manqué ou plafond atteint → BADGE = UNVERIFIED (immédiat, sans grâce)
```

**Plafond mou — mécanisme complet et définitif :**

```text
Renouvellements 1 et 2 (années 1-2) : automatiques, formation certifiante standard.

Renouvellement 3 (année 3) : entretien vidéo obligatoire avec validateur humain.
  → entretien validé → renouvellement accordé, vae_audit_required = true reste actif
  → entretien non validé / non passé → BADGE = UNVERIFIED

Renouvellement 4 (année 4) — DERNIÈRE CHANCE, non reconductible :
  a) Diplôme d'État obtenu et validé → sortie définitive de la VAE, BADGE = VERIFIED (VAE = NON)
  b) Parcours de formation en cours justifié (preuve d'inscription/progression
     vers le diplôme d'État) → 1 SEUL renouvellement supplémentaire accordé (année 4 → 5)
  c) Aucune progression démontrée → BADGE = UNVERIFIED + blocage 6 mois avant nouvelle candidature

Année 5 (uniquement si option (b) a été accordée en année 4) :
  → Diplôme obtenu → sortie définitive de la VAE
  → Diplôme toujours absent, quelle que soit la justification → BADGE = UNVERIFIED
     (aucun renouvellement supplémentaire au-delà de l'année 5 ; pas d'exception possible sans validation manuelle exceptionnelle d'un Admin Superviseur)
```

Ce mécanisme remplace la formulation initiale ambiguë : le "mou" du plafond ne s'applique **qu'une seule fois** (l'option (b) de l'année 4), après quoi le plafond devient dur. Le pseudo-code du moteur (§26) doit refléter cette limite explicite via un champ `vae_extension_used` (booléen, une seule extension possible dans la vie du profil).

Données VAE : `vae_type` (`ANNUAL_CERTIFYING`), `vae_renewal_count`, `vae_last_renewed_at`, `vae_started_at`, `vae_expires_at`, `vae_status`, `vae_reason`.

---

# PARTIE C — EXPERT BTP / AUTRES

## 11. Positionnement

L'Expert BTP/Autres réutilise **intégralement** la structure de l'Expert Digital (Inscription, KYC, Formation, Expériences, Test, moteur de badge, VAE annuelle sécurisée). Les différences sont uniquement de contenu.

## 12. Domaine

- Domaine d'intervention principal
- Sous-spécialité
- Domaine d'intervention secondaire
- Secteur : **BTP** ou **Autres** → embranchement vers un mode **Consultation**, lié aux 3 modes de devis (A : photos directes, B : plans/CDC, C : après visite technique)

## 13. Diplôme

Identique à l'Expert Digital : diplôme d'État (Bac/BTS/Licence/Master) vérifié auprès des organismes officiels, avec la même VAE annuelle sécurisée via formation certifiante partenaire.

## 14. Expériences

- Client : `INDIVIDUAL` ou `COMPANY`
- Poste/fonction : Chef de Projet, Chef de Chantier, Conducteur de Travaux, Architecte, Ingénieur, Électricien, Autre
- Description, période, livrables, portfolio

Statuts et mécanisme identiques à l'Expert Digital (§8).

---

# PARTIE D — ARTISAN

## 15. Domaine

- Domaine d'intervention (principal)
- Sous-spécialité
- Domaine d'intervention secondaire
- Secteur : **BTP** / **Autres** → même embranchement Consultation que l'Expert BTP/Autres

## 16. Formation / Qualifications

**Diplôme de référence : CQM (Certificat de Qualification aux Métiers) et CQP (Certificat de Qualification Professionnelle), délivrés par l'État.**

Autres types possibles : BEP, CAP, DTS.

Pour chaque diplôme/certificat : année d'obtention, lieu d'obtention, certificat joint. Statuts : `PENDING`, `VALIDATED`, `REJECTED`.

Réutilise `expert_qualifications` avec un champ `filiere`/`profile_type`, et `is_state_issued = true` pour le CQM/CQP.

## 17. Expériences sécurisées (avec personnes ressources)

### Données
- Client : `INDIVIDUAL` ou `COMPANY` → nom du client/entreprise
- Poste/fonction : Chef de Projet, Chef de Chantier, Conducteur de Travaux, Architecte, Ingénieur, Électricien, Autre
- Description, année, livrables

Statuts : `PENDING`, `VALIDATED`, `REJECTED`. Portfolio inclus, structure identique à l'Expert Digital/BTP.

### Personnes ressources (sécurisées)

**Structure : 1 obligatoire + 2 optionnelles**
- **Référent principal** (obligatoire) — contact direct
- **Référent secondaire** (recommandé) — collègue ou superviseur
- **Référent croisé** (optionnel) — client final du projet

**Vérification des référents :**
- Appel vocal obligatoire `[V2]` (pas seulement SMS/email) — en `[MVP]`, une vérification par SMS + questions écrites suffit ; l'appel vocal systématique est coûteux en ressources humaines et se justifie surtout à plus grand volume
- Question de sécurité aléatoire (date du projet, tâche spécifique) `[MVP]`
- Score de confiance du référent `[V2]` : nouveau référent = vérification manuelle, référent déjà confirmé N fois = vérification accélérée
- **Blacklist** `[MVP]` : si un numéro est utilisé >5 fois par des profils différents → flag automatique + vérification approfondie
- 10% des appels enregistrés et réécoutés par l'audit `[V2, dépend de l'appel vocal ci-dessus]`

Statut `reference_status` par expérience : `PENDING`, `CONFIRMED`, `NOT_RECOGNIZED`. Une expérience `NOT_RECOGNIZED` ne compte pas comme `VALIDATED` pour le badge, sans affecter les autres expériences (isolation des rejets).

## 18. Test / Formation

Statuts : `PENDING`, `PASSED`, `FAILED`.

Mêmes règles de sécurité que l'Expert Digital (§9).

## 19. Moteur de badge — Artisan (VAE 3 mois sécurisée)

```text
KYC = VALIDATED
EXPÉRIENCES = VALIDATED
TEST = PASSED
CQM/CQP = VALIDATED
    → BADGE = VERIFIED, VAE = NON

KYC = VALIDATED
EXPÉRIENCES = VALIDATED
TEST = PASSED
CQM/CQP != VALIDATED
    → BADGE = VERIFIED, VAE = ACTIVE (3 mois)
    → Proposition : formation payante menant au CQM/CQP,
      co-organisée par la plateforme et des partenaires
      agréés par l'État du pays concerné
```

**Restrictions pendant VAE active (Artisan) :**
- Badge = VERIFIED (VAE active) : peut candidater, mais **pas être sélectionné pour une mission > 500€ ou > 7 jours**
- Mission < 500€ et < 7 jours : autorisation avec avertissement au client ("Cet artisan est en période de validation de compétences")
- Paiement séquestre (escrow) obligatoire pour toutes missions pendant VAE active
- Si VAE expire pendant la mission : paiement gelé, médiation automatique

**Suivi actif VAE 3 mois :**
- Semaine 6 (sur 12) : rappel automatique + proposition formation
- Semaine 10 : alerte urgente + blocage des nouvelles candidatures
- Semaine 12 : expiration + badge UNVERIFIED + missions en cours signalées

**Formation de rattrapage :**
- Formation suivie + validée avant expiration → CQM/CQP = VALIDATED → BADGE = VERIFIED, VAE = NON
- Non suivie/validée à expiration → retour à UNVERIFIED
- Paiement ne conditionne pas l'activation de la VAE — service optionnel proposé pendant les 3 mois

---

# PARTIE E — MANŒUVRE

## 20. Sécurité (HSE)

**Diplôme de référence : certificat HSE (Hygiène, Sécurité, Environnement) / sécurité sur chantier, délivré par l'État.**

## 21. Expériences sécurisées

- Entreprise / Particulier
- Tâche / description
- Livrables
- Année
- **Personnes ressources** — même mécanisme sécurisé que l'Artisan (§17) : 1 obligatoire + 2 optionnelles, appel vocal, questions de sécurité, blacklist, enregistrement 10%.

## 22. Moteur de badge — Manœuvre (VAE 3 mois sécurisée)

```text
KYC = VALIDATED
EXPÉRIENCES = VALIDATED
TEST = PASSED
CERTIFICAT HSE = VALIDATED
    → BADGE = VERIFIED, VAE = NON

KYC = VALIDATED
EXPÉRIENCES = VALIDATED
TEST = PASSED
CERTIFICAT HSE != VALIDATED
    → BADGE = VERIFIED, VAE = ACTIVE (3 mois)
    → Proposition : formation HSE/sécurité chantier payante,
      co-organisée par la plateforme et des partenaires
      agréés par l'État du pays concerné
```

**Restrictions pendant VAE active (Manœuvre) :**
- Identiques à l'Artisan (§19) : missions restreintes > 500€/7j, escrow obligatoire, avertissement client
- Suivi actif identique (semaine 6, 10, 12)

Règle uniforme avec l'Artisan : aucune fonction ne rend le certificat HSE obligatoire sans passage possible par la VAE.

---

# 23. Récapitulatif comparatif des 5 profils (sécurisé)

| | Client | Expert Digital | Expert BTP/Autres | Artisan | Manœuvre |
|---|---|---|---|---|---|
| KYC bloquant l'activité | Publication mission | Candidature | Candidature | Candidature | Candidature |
| Diplôme pivot du badge | — | Bac/BTS/Licence/Master (État) | Bac/BTS/Licence/Master (État) | CQM/CQP (État) | Certificat HSE (État) |
| Durée VAE | — | 1 an, renouvelable (plafond mou 3 ans) | 1 an, renouvelable (plafond mou 3 ans) | 3 mois | 3 mois |
| Plafond VAE | — | Audit année 3, blocage année 4+ | Audit année 3, blocage année 4+ | 3 mois fixes | 3 mois fixes |
| Formation de rattrapage pendant VAE | — | Formation certifiante, partenaire externe, annuelle | Idem Expert Digital | Formation CQM/CQP, partenaire agréé État, par pays | Formation HSE, partenaire agréé État, par pays |
| Personne ressource par expérience | Non | Non | Non | Oui (1 obligatoire + 2 optionnelles) | Oui (1 obligatoire + 2 optionnelles) |
| Test de compétences requis pour le badge | — | Oui (proctoring, 3 tentatives max) | Oui (proctoring, 3 tentatives max) | Oui (proctoring, 3 tentatives max) | Oui (proctoring, 3 tentatives max) |
| Restrictions missions pendant VAE | — | — | — | Missions > 500€/7j bloquées + escrow | Missions > 500€/7j bloquées + escrow |
| Multi-comptes | Détection graphe + facial | Détection graphe + facial | Détection graphe + facial | Détection graphe + facial | Détection graphe + facial |

---

# 24. Matrice de décision générique (Expert Digital / BTP / Artisan / Manœuvre)

| KYC | Expériences | Diplôme pivot | Test | Badge | VAE |
|---|---|---|---|---|---|
| ❌ | ❌ | ❌ | ❌ | Non vérifié | Non |
| ❌ | ✅ | ✅ | ✅ | Non vérifié | Non |
| ✅ | ❌ | ✅ | ✅ | Non vérifié | Non |
| ✅ | ✅ | ❌ | ❌ | Non vérifié | Non |
| ✅ | ✅ | ❌ | ✅ | Vérifié | Active (3 mois ou annuelle selon profil) |
| ✅ | ✅ | ✅ | ❌ | Non vérifié | Non |
| ✅ | ✅ | ✅ | ✅ | Vérifié | Non |

**Règles additionnelles :**
- Pour Artisan/Manœuvre, une expérience avec personne ressource `NOT_RECOGNIZED` ne compte pas dans le calcul d'"Expériences = ✅", même si son statut administratif était `VALIDATED`.
- Pour tous les profils, KYC REJECTED après 3 tentatives = compte SUSPENDED.

---

# 25. Modèle de données unifié et sécurisé

## 25.1 Utilisateurs

```text
users
- id
- role
- firstname
- lastname
- email
- phone
- password_hash (bcrypt/Argon2)
- country
- state
- city
- address
- browser_fingerprint
- ip_address_history (JSON array)
- face_hash (perceptual hash du selfie)
- status (ACTIVE | SUSPENDED | BANNED)
- created_at
- updated_at
```

Rôles : `CLIENT`, `EXPERT_DIGITAL`, `EXPERT_BTP`, `ARTISAN`, `MANOEUVRE`, `ADMIN`

**Contraintes :**
- Email unique + vérifié (double opt-in)
- Phone unique + vérifié (SMS + appel vocal si cluster)
- Face_hash comparé à l'inscription pour détecter les multi-comptes

## 25.2 Profils

```text
client_profiles
- id
- user_id
- badge_status
- created_at
- updated_at
```

```text
expert_digital_profiles
- id
- user_id
- profile_type          -- EXPERT_DIGITAL | EXPERT_BTP | ARTISAN | MANOEUVRE
- professional_title
- main_domain
- secondary_domain
- sector                -- BTP | AUTRES (Expert BTP/Autres, Artisan)
- badge_status
- vae_type              -- SHORT_3_MONTHS | ANNUAL_CERTIFYING
- vae_status
- vae_started_at
- vae_expires_at
- vae_renewal_count
- vae_last_renewed_at
- vae_audit_required    -- boolean (année 3+)
- vae_extension_used    -- boolean, une seule extension possible (année 4→5)
- created_at
- updated_at
```

## 25.3 KYC

```text
kyc_verifications
- id
- user_id
- id_document
- selfie
- selfie_with_document
- status                 -- PENDING | VALIDATED | REJECTED (jamais SUSPENDED, voir users.status)
- rejection_reason
- attempt_count          -- déclenche users.status = SUSPENDED à la 3e valeur REJECTED
- validated_at
- created_at
- updated_at
```

## 25.4 Qualifications

```text
expert_qualifications
- id
- expert_id
- profile_type
- type                  -- DIPLOMA | CERTIFICATE
- is_state_issued       -- true pour Bac/BTS/Licence/Master, CQM/CQP, HSE
- name
- specialty
- institution
- location
- year
- document
- status
- rejection_reason
- validated_at
- validated_by_admin_id
- created_at
- updated_at
```

## 25.5 Expériences

```text
expert_experiences
- id
- expert_id
- profile_type
- client_type            -- INDIVIDUAL | COMPANY
- client_name
- domain
- role
- description
- start_date
- end_date
- technologies
- project_description
- project_url
- portfolio_url
- reference_name_primary
- reference_phone_primary
- reference_relation_primary
- reference_name_secondary
- reference_phone_secondary
- reference_relation_secondary
- reference_name_cross
- reference_phone_cross
- reference_relation_cross
- reference_status       -- PENDING | CONFIRMED | NOT_RECOGNIZED
- reference_call_recorded -- boolean
- status
- rejection_reason
- validated_at
- validated_by_admin_id
- created_at
- updated_at
```

## 25.6 Réalisations / Portfolio

```text
experience_attachments
- id
- experience_id
- type                   -- IMAGE | DOCUMENT | PROJECT_LINK
- file
- url
- description
- moderation_status      -- PENDING | SAFE | FLAGGED
- created_at
- updated_at
```

## 25.7 Tests

```text
expert_tests
- id
- expert_id
- domain
- score
- score_breakdown        -- JSON (sous-domaines)
- status
- proctoring_video_url
- browser_fingerprint
- started_at
- completed_at
- validated_at
- attempt_number
- created_at
- updated_at
```

## 25.8 Formations de rattrapage (VAE)

```text
platform_trainings
- id
- partner_name
- country
- domain
- training_category      -- SHORT_CERTIFICATION (CQM/CQP/HSE) | ANNUAL_CERTIFYING (Experts)
- price
- price_ceiling_by_country -- plafond tarifaire
- start_date
- end_date
- created_at
- updated_at
```

```text
expert_training_enrollments
- id
- expert_id
- training_id
- payment_status
- completion_status
- created_at
- updated_at
```

## 25.9 Historique du badge (Immuabilité)

```text
badge_history
- id
- expert_id
- profile_type
- previous_badge
- new_badge
- reason                 -- KYC_VALIDATED | TEST_PASSED | VAE_EXPIRED | VAE_RENEWED | VAE_GRANTED | MANUAL_OVERRIDE...
- triggered_by           -- SYSTEM | ADMIN
- admin_justification    -- text (obligatoire si triggered_by = ADMIN)
- admin_validator_id     -- id (double validation)
- previous_hash          -- SHA-256 de la ligne précédente
- current_hash           -- SHA-256 (previous_hash + données actuelles)
- created_at
```

**Contraintes d'immuabilité :**
- Table en append-only (pas de UPDATE/DELETE via API) `[MVP]` — simple à imposer via permissions DB/RLS
- Hash cryptographique chaîné par ligne `[MVP]` — peu coûteux, gain d'intégrité élevé
- Réplication sur stockage WORM (Write Once Read Many) `[V3]`
- Export journalier vers registre immuable `[V3]` — l'append-only + hash chaîné suffit à détecter une altération en attendant

## 25.10 Missions

```text
missions
- id
- client_id
- title
- description
- domain
- budget
- deadline
- status
- smart_contract_terms   -- JSON (conditions, livrables, paiement)
- escrow_status
- created_at
- updated_at
```

## 25.11 Journal d'audit admin

```text
admin_audit_log
- id
- admin_id
- action                 -- VALIDATE | REJECT | OVERRIDE
- target_type            -- KYC | QUALIFICATION | EXPERIENCE | BADGE
- target_id
- justification          -- text obligatoire
- screen_recording_url   -- nullable, [V3] — à activer seulement si validé juridiquement
- ip_address
- created_at
```

---

# 26. Service de validation (Pipeline sécurisée) `[V2/V3]`

> **Note de priorisation** : le moteur A/B/C avec consensus complet est coûteux à construire (3 implémentations parallèles à maintenir en synchronisation). En `[MVP]`, un seul moteur avec logs d'anomalie et alertes admin en cas de résultat inattendu couvre l'essentiel du risque. Le moteur B (shadow) peut être ajouté en `[V2]` une fois le volume de profils le justifiant, et le circuit-breaker à 3 moteurs complet en `[V3]` si la fraude constatée le justifie.

Architecture en **pipeline + consensus** plutôt qu'un service unique :

## Étape 1 — Collecte (read-only)
- KYC service → statut
- Experience service → statut + référents
- Qualification service → statut + is_state_issued
- Test service → statut + score_breakdown

## Étape 2 — Calcul redondant
- **Moteur A** (principal) : règles métier
- **Moteur B** (shadow) : règles métier (code différent, même équipe ou non)
- **Moteur C** (audit) : règles simplifiées, vérifie la cohérence A vs B

## Étape 3 — Consensus
- Si A == B == C → badge appliqué
- Si A != B → alerte admin + badge figé (pas de changement)
- Si A != C ou B != C → log d'anomalie + revue manuelle sous 24h

**Circuit-breaker :**
- Si >10 divergences/jour → arrêt automatique du moteur + mode manuel

## Pseudo-code générique (sécurisé)

```text
if (kyc !== VALIDATED) return UNVERIFIED;
if (kyc_attempt_count >= 3 && kyc === REJECTED) {
    users.status = SUSPENDED; // compte, pas le KYC — durée 30 jours
    return UNVERIFIED;
}
if (experiences_valides(profile_type) !== VALIDATED) return UNVERIFIED;
  // isole les NOT_RECOGNIZED pour Artisan/Manœuvre
  // vérifie reference_status CONFIRMED pour les profils concernés
if (test !== PASSED) return UNVERIFIED;
if (test_attempt_number > 3 && test === FAILED) return MANUAL_REVIEW_REQUIRED;

if (diplome_pivot !== VALIDATED) {
    if (profile_type in [EXPERT_DIGITAL, EXPERT_BTP]) {
        if (vae_renewal_count >= 4) {
            // plafond dur atteint : une seule extension possible dans la vie du profil
            if (vae_extension_used) return UNVERIFIED;
            if (!formation_en_cours_justifiee) return UNVERIFIED;
            vae_extension_used = true; // renouvellement 4→5, non reconductible
        } else if (vae_renewal_count === 3) {
            if (!vae_audit_required || !audit_passed) return UNVERIFIED;
        }
        activateOrRenewAnnualVae();
    } else {
        activateVaeForThreeMonths();
        restrictMissionsDuringVae(); // >500€/7j bloquées
        activateEscrow();
    }
    return VERIFIED;
}

return VERIFIED;
```

---

# 27. Administration (Séparation des pouvoirs)

## Rôles admin segmentés

| Rôle | Pouvoirs | Contraintes |
|------|----------|-------------|
| **Admin KYC** | Valide/rejette KYC uniquement | Max 30 validations/heure. Flag si dépassement. |
| **Admin Qualification** | Valide/rejette diplômes uniquement | Double validation pour les rejets |
| **Admin Expérience** | Valide/rejette expériences + référents | 10% des appels réécoutés. Enregistrement écran. |
| **Admin Superviseur** | Lit tout, ne modifie rien | Auditeur. Revue mensuelle de 5% des actions. |
| **Admin Technique** | Gère les formations, pas les validations | Pas d'accès aux données utilisateurs |

## Traçabilité obligatoire
- Justification texte obligatoire pour chaque action admin `[MVP]`
- Double validation pour les rejets (Admin A propose, Admin B confirme) `[MVP]`
- Alertes : un admin qui valide >50 profils/heure = flag automatique `[MVP]`
- Enregistrement vidéo-écran de chaque action admin `[V3]` — implications légales sur la surveillance du personnel à valider avec un juriste avant implémentation ; la justification texte + double validation couvrent l'essentiel du besoin de traçabilité en attendant
- Journal dans `admin_audit_log` (§25.11)

## Client
- Consulter le profil, le KYC
- Valider/rejeter le KYC (Admin KYC uniquement)
- Voir le badge

## Expert Digital / Expert BTP / Artisan / Manœuvre
- Consulter le profil
- Valider/rejeter le KYC (Admin KYC)
- Valider/rejeter les diplômes/certificats (Admin Qualification)
- Valider/rejeter les expériences (Admin Expérience)
- Confirmer/rejeter la personne ressource (Admin Expérience)
- Consulter les portfolios
- Consulter les résultats du test
- Voir le badge, la VAE, l'historique (`badge_history`)
- Gérer les formations partenaires (`platform_trainings`) et les inscriptions (`expert_training_enrollments`) (Admin Technique)

---

# 28. Notifications (Canaux de secours)

## Client
- KYC validé/rejeté/suspendu
- Mission publiée/bloquée (KYC)

## Expert Digital / Expert BTP / Artisan / Manœuvre
- KYC validé/rejeté/suspendu
- Diplôme/certificat validé/rejeté
- Expérience validée/rejetée
- Personne ressource confirmée / non reconnue (Artisan/Manœuvre)
- Test réussi/échoué/entretien requis (3ème échec)
- Badge vérifié attribué
- VAE attribuée / bientôt expirée (semaine 10) / expirée / renouvelée
- Formation partenaire disponible pendant la VAE
- Badge repassé en non vérifié
- Alertes audit VAE (année 3+)

**Canaux (hiérarchisés) :**
1. Push application
2. Email
3. SMS (fallback si email non ouvert sous 24h)

---

# 29. Expiration et renouvellement automatique de la VAE

Tâche planifiée (cron / job scheduler) :

1. Rechercher les VAE actives (`SHORT_3_MONTHS` et `ANNUAL_CERTIFYING`).
2. Vérifier `vae_expires_at`.
3. Pour `SHORT_3_MONTHS` (Artisan/Manœuvre) :
   - Semaine 6 : rappel + proposition formation
   - Semaine 10 : alerte urgente + blocage nouvelles candidatures
   - Semaine 12 : expiration sans diplôme validé → `EXPIRED` + badge `UNVERIFIED` + missions en cours signalées + escrow gelé
4. Pour `ANNUAL_CERTIFYING` (Experts) :
   - Vérifier si formation renouvelée/validée dans l'année
   - Si oui et `vae_renewal_count < 3` : réinitialiser `vae_expires_at` (+1 an) + incrémenter `vae_renewal_count`
   - Si `vae_renewal_count === 3` (année 3) : flag `vae_audit_required = true` + entretien vidéo obligatoire ; renouvellement accordé seulement si audit validé
   - Si `vae_renewal_count === 4` (année 4) : dernière chance — diplôme obtenu → sortie définitive ; sinon formation en cours justifiée et `vae_extension_used = false` → 1 seule extension accordée (`vae_extension_used = true`) ; sinon → `EXPIRED` + badge `UNVERIFIED` + blocage 6 mois
   - Si extension déjà utilisée (année 5) sans diplôme obtenu → `EXPIRED` + badge `UNVERIFIED`, aucune exception automatique possible
   - Si non renouvelé à quelque étape que ce soit : `EXPIRED` + badge `UNVERIFIED`
5. Recalculer le badge via pipeline consensus (§26).
6. Écrire l'événement dans `badge_history` (hash chaîné).
7. Envoyer notification (push → email → SMS).

---

# 30. Plan de réponse aux incidents

| Niveau | Déclencheur | Réponse |
|--------|-------------|---------|
| **Niveau 1** | Badge faussé individuel (< 5 profils) | Correction manuelle + notification utilisateur + log dans badge_history |
| **Niveau 2** | Fraude systémique (5-100 profils) | Audit complet + recalcul batch via Moteur C + revue manuelle |
| **Niveau 3** | Compromission majeure (>100 profils ou admin corrompu) | Arrêt du moteur + mode manuel + communication publique + recalcul complet avec moteur de secours + réinitialisation des hashes badge_history |

---

# 31. Données sensibles et minimisation

- **Numéro de pièce d'identité** : hash uniquement, jamais stocké en clair
- **Selfies** : supprimés 30j après validation (conservation du hash perceptuel uniquement)
- **Données référents** : anonymisées après 1 an (nom remplacé par ID interne)
- **Mots de passe** : bcrypt/Argon2 uniquement, jamais en clair
- **Données financières** : tokenisées, jamais stockées en base

---

# 32. Ordre recommandé de développement

## MVP — Phases 1 à 8 (lancement)

### Phase 1 — Fondations sécurisées
- Authentification, gestion des rôles, hash bcrypt/Argon2
- Détection multi-comptes de base : téléphone, email, IP `[MVP]` (fingerprint navigateur et face hash en `[V2]`, voir §2.1)
- Rate limiting et anti-spam
- Profil Client, Expert Digital, Expert BTP, Artisan, Manœuvre

### Phase 2 — KYC sécurisé
- Upload des documents (scan AV, watermark) `[MVP]` ; OCR et détection de falsification IA en `[V2]`
- Statuts, interface d'administration KYC segmentée
- Graduation des droits (brouillon vs publication) — règle unique définie en §2.2

### Phase 3 — Profils spécifiques
- Domaines, Formations/Diplômes (avec `is_state_issued`)
- Expériences, Portfolio (modération auto basique)
- Personnes ressources : 1 obligatoire + 2 optionnelles, vérification SMS + question de sécurité `[MVP]` ; appel vocal et blacklist avancée en `[V2]`

### Phase 4 — Test sécurisé
- Création des tests, banque de questions (viser 500+ progressivement)
- Randomisation, détection copier-coller/onglets `[MVP]` ; proctoring vidéo en `[V2]`
- 3 tentatives + entretien de secours

### Phase 5 — Badge (moteur simple avec logs)
- Un seul moteur, paramétrable par filière, avec logs d'anomalie et alerte admin `[MVP]`
- Calcul automatique, badge Vérifié/Non vérifié
- Consensus multi-moteurs et circuit-breaker reportés en `[V2/V3]` (§26)

### Phase 6 — VAE sécurisée
- VAE courte (3 mois, Artisan/Manœuvre) avec restrictions missions + escrow
- VAE annuelle renouvelable (Experts) avec plafond mou clarifié (§10) + audit année 3
- Formations partenaires (`platform_trainings`, `expert_training_enrollments`)
- Expiration/renouvellement automatique, notifications hiérarchisées

### Phase 7 — Missions sécurisées
- Création, publication, consultation
- CGV + smart contract simplifié
- Paiement séquestre (escrow)
- Affichage des badges et avertissements VAE

### Phase 8 — Administration sécurisée (rôles + justification)
- Dashboard segmenté (KYC, Qualification, Expérience, Superviseur, Technique)
- Double validation, justification obligatoire `[MVP]` ; enregistrement écran en `[V3]`
- Journal d'audit immuable append-only + hash chaîné (`admin_audit_log`, `badge_history`) `[MVP]` ; réplication WORM et export blockchain en `[V3]`

## V2 — Après validation du marché (traction confirmée, premiers signaux de fraude réels)
- Fingerprinting navigateur, hash perceptuel photo, analyse de graphe anti-sybil
- Détection de falsification de documents par IA (métadonnées EXIF, montage)
- Appel vocal systématique + score de confiance des référents + écoute d'échantillon
- Proctoring vidéo des tests
- Moteur shadow (B) en parallèle du moteur principal, alertes sur divergence

## V3 — À l'échelle / si exigence réglementaire spécifique
- Reconnaissance faciale anti-sybil (base interne) — validation juridique préalable obligatoire (données biométriques)
- Enregistrement vidéo-écran systématique des actions admin — validation juridique préalable obligatoire (droit du travail/vie privée du personnel)
- Pipeline à 3 moteurs (A/B/C) avec consensus complet et circuit-breaker
- Réplication WORM et export vers registre immuable/blockchain privée pour `badge_history`

### Phase 9 — Audit et conformité
- Tests de pénétration
- Audit de code du moteur de badge
- Revue des processus admin
- Certification des partenaires formation
