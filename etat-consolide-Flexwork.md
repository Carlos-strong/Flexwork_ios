# Flexwork — État consolidé des décisions

**Date** : 3 août 2026
**Objet** : document de référence unique. Recense l'état des décisions arrêtées, les arbitrages successifs et leurs motifs, les prérequis bloquants, et le statut de chaque document produit.
**Statut du modèle** : **arbitré** — option A (intermédiaire neutre) retenue le 3 août 2026, voir §6. Reste conditionné aux prérequis juridiques du §5.

---

## 1. Où en est le projet

### 1.1 En une phrase

Flexwork est une plateforme de mise en relation entre clients et prestataires (5 profils : Client, Expert Digital, Expert BTP/Autres, Artisan, Manœuvre) pour le Bénin et l'Afrique de l'Ouest, adossée à un paiement séquestre en Mobile Money.

### 1.2 Le modèle actuellement retenu

**Intermédiaire pur** (`modele-Flexwork-v3-intermediaire.md`) :

| Élément | État |
|---|---|
| Vérification effective par la plateforme | **Identité uniquement (KYC)** |
| Qualifications, assurance, expérience | **Déclarées** par le prestataire, affichées comme non vérifiées |
| Contrat de prestation | Entre client et prestataire — **plateforme non signataire** |
| Détention des fonds | **Par un PSP agréé** — jamais par la plateforme |
| Litige | **Médiation facultative** — la plateforme ne tranche pas |
| Exception | Domaines à risque physique élevé : assurance effective bloquante |

### 1.3 Ce qui n'a jamais changé sur toute la session

Ces éléments ont survécu à tous les arbitrages — ils constituent le socle stable :

- **KYC interne, jamais délégable** — recto/verso + selfie + selfie avec pièce
- **Séquestre systématique** sur tous les paiements
- **Acceptation tacite** pour protéger le prestataire du client passif
- **Personnes ressources** pour Artisan et Manœuvre (1 obligatoire + 2 optionnelles)
- **Isolation des rejets** — un élément rejeté n'affecte que lui-même
- **Traçabilité append-only** avec hash chaîné
- **Séparation des pouvoirs** administratifs
- **Confirmation de paiement par webhook uniquement**
- **Mobile Money** comme moyen de paiement (FedaPay / MTN / Moov / Orange)

---

## 2. Journal des arbitrages

Chronologie des décisions, avec le motif de chaque bascule. À conserver pour ne pas rejouer ces débats.

### A1 — Abandon de la VAE
**Décision** : suppression complète du mécanisme de Validation des Acquis de l'Expérience (VAE courte 3 mois, VAE annuelle renouvelable, plafond mou, extensions, audits par palier).
**Motif** : un badge à échéance est une dette à échéance ; il ne peut pas fonder un signal de confiance. Complexité disproportionnée (crons, compteurs, notifications en cascade).
**Conséquence** : suppression de ~15 champs et 3 sections.

### A2 — Abandon du test de compétences interne
**Décision** : plus de banque de questions, proctoring, tentatives limitées, accommodements.
**Motif** : coût d'infrastructure élevé ; la plateforme n'a pas l'autorité pour évaluer une compétence technique métier.
**Conséquence** : suppression de la table `expert_tests`.

### A3 — Abandon de l'évaluation graduée du diplôme
**Décision** : suppression de `vae_gap`, `vae_tier`, `domain_adequacy`, `computed_level`, `required_test_score`.
**Motif** : le classement d'adéquation d'un diplôme à un domaine était un jugement humain arbitraire, exposant la plateforme et nécessitant un rôle admin expert par domaine.

### A4 — Abandon du scoring pondéré et du niveau calculé
**Décision** : le niveau (Débutant → Expert) redevient **auto-déclaré**. Aucun algorithme de scoring.
**Motif** : un score est un jugement, non un fait. Un client compare mieux des faits bruts qu'un score opaque qu'il ne comprend pas.
**Note** : l'algorithme avait pourtant été spécifié et validé sur 4 cas de référence — il reste disponible si le positionnement change (§6).

### A5 — Délégation de la certification à des partenaires externes
**Décision** : l'évaluation de compétence est déléguée à des organismes agréés par l'État. La plateforme **atteste**, ne certifie pas.
**Motif** : légitimité (un organisme agréé a une autorité que la plateforme n'aura jamais) et simplification.
**Formulation retenue** : « [Organisme agréé n° X] a délivré [certification] à [Nom] le [date] — vérifié et enregistré par Flexwork ».
**Formulation interdite** : « Flexwork certifie que M. X est qualifié ».

### A6 — Certification obligatoire pour BTP / Artisan / Manœuvre, avec fenêtre de 6 mois
**Décision** : certification exigée, avec tolérance unique de 6 mois à compter de la **première candidature**.
**Motif** : exigence d'assurabilité des chantiers.
**Statut** : **partiellement dépassé par A8** — l'exigence ne subsiste que sur les domaines à risque élevé.

### A7 — Commission nulle sur les certifications obligatoires
**Décision** : aucune commission plateforme sur une certification qu'elle rend obligatoire ; commission normale sur les formations optionnelles.
**Motif** : prélever un pourcentage sur un péage qu'on érige soi-même est indéfendable. Le conflit d'intérêt aurait fini par corrompre le signal de confiance.
**Statut** : **toujours valide et impératif** quel que soit le modèle final.

### A8 — Bascule vers l'intermédiaire pur
**Décision** : la plateforme cesse de vérifier les qualifications et les assurances ; elle collecte et affiche des déclarations engageantes. Le séquestre passe chez un PSP agréé. Le litige devient une médiation facultative.
**Motif** : cohérence avec la nature de plateforme de mise en relation ; réduction de l'exposition juridique ; ouverture du marché aux prestataires non assurés.
**Contrepartie assumée** : le client porte le risque de son choix.

### A9 — Exception sur les domaines à risque physique élevé
**Décision** : électricité, travail en hauteur, gros œuvre, engins → assurance effective obligatoire, sans tolérance.
**Motif** : ce n'est pas une obligation juridique mais un choix assumé. Une architecture contractuelle parfaite ne protège pas de l'onde de choc réputationnelle d'un accident grave.

### A10 — Répartition clausulaire CGU / contrat de prestation
**Décision** : les clauses protégeant la plateforme vivent **principalement dans les CGU** ; le contrat de prestation contient des **reconnaissances** par les deux parties, brèves et déclaratives.
**Motif** : on ne peut invoquer à son profit un contrat auquel on n'est pas partie (effet relatif). Et un contrat de prestation truffé de clauses protégeant la plateforme suggérerait qu'elle y joue un rôle — fragilisant le statut d'intermédiaire.

### A11 — Arbitrage du positionnement : option A retenue
**Décision** : la plateforme est un **intermédiaire neutre**. Elle vérifie l'identité et affiche des déclarations non vérifiées, avec une exception bloquante sur les domaines à risque physique élevé. Le modèle v3 devient la référence unique.
**Motif** : cohérence avec la nature de plateforme de mise en relation ; réalité d'un marché largement informel où exiger des vérifications fermerait l'offre ; coût opérationnel récurrent de la vérification insoutenable au stade actuel.
**Contrepartie assumée** : abandon de la « double certification anti-fraude » comme différenciateur d'origine. Nouveau discours : « nous savons qui est en face de vous, et votre argent est protégé jusqu'à ce que le travail soit fait ».
**Point acté** : aucun modèle ne libère de tout engagement — quatre engagements restent irréductibles (§6).

### A12 — Outil de pointage : outil de preuve entre les parties
**Décision** : la plateforme intègre un outil de pointage (horodatage de présence), conçu comme **outil de preuve entre le client et le prestataire**, et non comme système d'information de la plateforme. L'outil est générique et utilisable par des applications tierces.
**Motif** : utilité réelle sur les missions facturées au temps passé — la preuve de présence règle une catégorie de litiges avant qu'ils naissent. Le caractère générique de l'outil est un élément objectif : un instrument conçu pour un usage tiers n'a pas été conçu pour contrôler les prestataires de la plateforme.

**Règle structurante — cécité de la plateforme :**

```text
Les données de pointage TRANSITENT par la plateforme, elles ne l'INFORMENT PAS.
```

| Usage de la donnée | Qualification | Autorisé |
|---|---|---|
| Visible uniquement par le client et le prestataire | Outil | **Oui** |
| Produite par une partie comme preuve en médiation | Outil | **Oui** — à l'initiative des parties |
| Alimente un score, un classement, une visibilité | Contrôle | **Non** |
| Justifie une pénalité ou un déréférencement | Contrôle | **Non** |
| Consultée par la plateforme pour décider d'un litige | Contrôle | **Non** |

**Trois conditions impératives :**

1. **Opt-in réellement libre** — le refus d'utiliser l'outil doit être **sans conséquence** : ni condition de paiement, ni dégradation de visibilité. Un opt-in dont le refus coûte quelque chose est fictif, et le contrôle serait établi.
2. **Pointage ponctuel, jamais suivi continu** — horodatage à l'arrivée et au départ uniquement. Un suivi de position en temps réel serait du contrôle quel que soit l'habillage, pour une utilité supplémentaire nulle.
3. **Activation par mission, décidée par les deux parties** — inscrite dans le contrat de prestation (« les parties conviennent d'utiliser l'outil de pointage »). Ce sont elles qui activent, pas la plateforme.

**Point de vigilance permanent** : toute proposition future du type « pénalisons les prestataires souvent en retard » ferait basculer l'outil du service vers le contrôle, sans que la bascule soit visible. À traiter comme une violation de la règle de conformité n° 4 (§9).

**Limite de l'argument de neutralité — protection des données** :

L'argument « outil sous la responsabilité des parties » fonctionne pour la responsabilité **contractuelle**, mais **pas** pour la protection des données personnelles. La géolocalisation est une donnée sensible : héberger et traiter ces données confère la qualité de responsable (ou co-responsable) de traitement, indépendamment de toute clause. Obligations en découlant :

- **Finalité déclarée et limitée** : preuve de présence sur une mission, rien d'autre
- **Conservation courte** : durée de la mission + délai de contestation, puis suppression
- **Aucun usage secondaire** : ni statistiques, ni amélioration produit, ni revente
- **Consentement libre et révocable** du prestataire
- **Déclaration APDP** éventuellement requise (voir §5, prérequis n° 7)

### A13 — Contrôle d'âge sur les filières chantier : flag par pays
**Décision** : l'âge minimum d'exercice sur les filières chantier (Manœuvre, Artisan, Expert BTP/Autres) est un **paramètre administrable par pays d'exercice**, affiché dans le contrat de prestation entre le client et le prestataire.
**Motif** : les règles varient selon les pays et selon les activités (conduite d'engins, travail en hauteur peuvent exiger davantage). Un paramètre évite de coder en dur une règle qui diffère d'une juridiction à l'autre.

**Plancher impératif — non administrable :**

```text
minimum_age >= 18 sur toute filière chantier.
L'interface d'administration REFUSE toute valeur inférieure à 18.
```

L'âge minimum pour les travaux dangereux relève des conventions OIT ratifiées par les pays de la sous-région : ce n'est pas un paramètre commercial. Le flag est configurable **vers le haut uniquement** (ex. 21 ans pour la conduite d'engins), jamais en dessous.

**Modèle de données :**

```text
country_age_requirements
- id
- country
- profile_type            -- MANOEUVRE | ARTISAN | EXPERT_BTP
- domain                  -- nullable : règle spécifique à un domaine
                             (ex. conduite d'engins, travail en hauteur)
- minimum_age             -- CONTRAINTE : >= 18, refusée sinon
- legal_reference         -- texte ou convention invoquée
- set_by_admin_id
- justification           -- obligatoire
- effective_from
- created_at, updated_at
```

**Mécanisme de blocage :**

```text
Au moment de la validation du KYC :
    date_naissance extraite de la pièce d'identité (saisie par l'Admin KYC)
    age = calcul à la date du jour
    seuil = country_age_requirements(pays, profile_type, domaine)

Si age < seuil ET profile_type in [MANOEUVRE, ARTISAN, EXPERT_BTP]
    → ACTIVATION DU PROFIL CHANTIER REFUSÉE
    → aucune candidature possible
    → AUCUNE dérogation admin possible
```

Deux précisions importantes :
- Le blocage porte sur **l'activation du profil**, pas seulement sur la candidature — sinon un mineur constitue tout son dossier avant de découvrir qu'il ne peut rien en faire.
- **Réévaluation automatique à l'anniversaire** : un profil refusé à 17 ans s'active à 18 sans repasser le KYC.

**Affichage dans le contrat de prestation** (clause type) :

> Le prestataire déclare être âgé de **[âge]** ans et satisfaire l'âge minimum de **[minimum_age]** ans requis au **[pays]** pour l'exercice de l'activité objet du présent contrat.
>
> Le client reconnaît avoir été informé de cette exigence légale.

**Nature de cette règle** : contrairement aux autres éléments du modèle v3, il ne s'agit pas d'une déclaration non vérifiée mais d'une **vérification effective par la plateforme** — l'âge est extrait de la pièce d'identité déjà contrôlée au KYC. C'est la **deuxième exception** au principe d'intermédiaire pur, à côté de l'assurance sur le risque physique élevé (§6).

Elle est encore moins négociable que la première : elle protège des personnes qui ne peuvent pas consentir valablement au risque, et faciliter un travail illégal n'est couvert par aucun argument de neutralité.

### A14 — Le contrôle d'âge porte sur la filière prestataire, jamais sur le compte
**Décision** : la barrière A13 s'applique à la **filière prestataire** (ce que la personne offre : artisan, manœuvre, expert BTP/Autres), jamais au compte. Un compte à double face (client **et** manœuvre, à venir avec le dual-role) est donc : **jamais soumis** au seuil côté client (hors sujet) et **toujours soumis** côté prestataire (pas d'esquive). En mono-rôle actuel, la filière prestataire == `user.role` — la règle est déjà implémentée telle quelle ; l'arbitrage lève l'ambiguïté pour la bascule dual-role.
**Motif** : `user.role` est une filière métier, pas une face du marché. Si le contrôle était porté par le compte, un compte à double face échapperait au seuil légal (ou le subirait sans objet côté client) — soit l'inverse exact de l'intention d'A13.
**Implémentation** : module partagé `src/lib/chantier-age.ts` (`isChantierPrestataireAgeOk`) réutilisé par (1) l'activation du profil (`POST /api/profile` → `profile_below_minimum_age`) et (2) la candidature (`src/lib/candidature-guard.ts` → `age_under_minimum` / `kyc_required_for_age`) — défense en profondeur, un mineur ne peut ni activer son profil chantier ni candidater, même en contournant l'une des deux portes. Réévaluation en direct à chaque appel (jamais un statut figé) : un profil refusé à 17 ans s'active à 18 sans repasser le KYC.

---

## 3. Architecture contractuelle retenue

```text
┌──────────────────────────────────────────────────────┐
│ CGU — Plateforme ↔ Client                            │
│ Non-garantie du résultat · plafond de responsabilité │
│ · absence de vérification des déclarations           │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ CGU — Plateforme ↔ Prestataire                       │
│ Déclarations engageantes (assurance, qualifications) │
│ · garantie au profit de la plateforme                │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ CONTRAT DE PRESTATION — Client ↔ Prestataire         │
│ Objet, prix, délais, responsabilités                 │
│ · conditions de libération des fonds                 │
│ · acceptation tacite · médiation facultative         │
│ · RECONNAISSANCE : Flexwork n'est pas partie,     │
│   n'a rien vérifié, ne garantit pas le résultat      │
│ → généré par la plateforme comme OUTIL               │
│ → signé par les DEUX PARTIES uniquement              │
└──────────────────────────────────────────────────────┘
```

### Répartition des clauses

| Clause | CGU | Contrat de prestation |
|---|---|---|
| Non-garantie du résultat | **Principal** | Rappel |
| Plafond de responsabilité plateforme | **Principal** | — |
| Absence de vérification | **Principal** | **Reconnaissance des parties** |
| Garantie du prestataire au profit de la plateforme | **Principal** | Reprise nommée |
| Plateforme non partie au contrat | — | **Principal** |
| Responsabilités client / prestataire | — | **Principal** |
| Conditions de libération des fonds | — | **Principal** |
| Acceptation tacite | — | **Principal** |
| Déclaration d'âge et seuil légal applicable (A13) | — | **Principal** |
| Médiation facultative | Rappel | **Principal** |
| Juridiction entre les parties | — | **Principal** |

### Conditions de forme — plus décisives que la rédaction
- Acceptation active et horodatée des CGU, version conservée (`terms_snapshot`)
- Clauses limitatives **visibles**, non enfouies
- Signature des deux parties avec texte figé (`declaration_text_snapshot`)

---

## 4. Matrice de responsabilités

| Domaine | Responsable |
|---|---|
| Qualité et conformité des travaux | **Prestataire** |
| Sécurité d'exécution sur site | **Prestataire** |
| Dommages pendant l'exécution | **Prestataire** (RC pro) |
| Détention effective des qualifications | **Prestataire** (déclare et garantit) |
| Souscription et maintien de l'assurance | **Prestataire** |
| Exactitude de ses déclarations | **Prestataire** |
| Description exacte du besoin et du site | **Client** |
| Accès et sécurité des lieux | **Client** |
| Paiement du prix convenu | **Client** |
| **Choix du prestataire** | **Client** |
| Vérification de l'identité | **Plateforme** |
| Vérification de l'âge minimum légal sur filières chantier (A13) | **Plateforme** |
| Affichage fidèle **des déclarations** | **Plateforme** |
| Fonctionnement technique | **Plateforme** |
| Instructions de paiement au PSP | **Plateforme** |
| **Résultat de la mission** | **Hors périmètre plateforme** |

---

## 5. Prérequis bloquants — à traiter avant tout développement

Aucun de ces points ne se résout en développant. Ils déterminent **ce qu'il faut développer**.

| # | Sujet | Interlocuteur | Effet si non résolu |
|---|---|---|---|
| **1** | Validation du **statut d'intermédiaire** | Avocat béninois | Tout le modèle v3 repose sur cette qualification |
| **2** | **Montage PSP** : la plateforme jamais bénéficiaire des fonds | FedaPay + juriste | Requalification en intermédiaire financier (BCEAO) |
| **3** | **Opposabilité des clauses limitatives** | Avocat | Sans elle, la matrice du §4 est décorative |
| **4** | **Assurance à la mission** : existence, taux, statut de distribution | Courtier / assureur | Bloque l'exception risque élevé (A9) |
| **5** | **Requalification en relation de travail** | Avocat | Contrôler : pas de tarifs imposés, pas de disponibilité obligatoire, pas d'exclusivité |
| **6** | Validité de la **génération automatique de contrats** entre tiers | Avocat | Forme et signature électronique |
| **7** | **Protection des données personnelles** : statut de responsable de traitement sur les données de pointage (géolocalisation), obligations et déclaration APDP éventuelle (loi 2009-09) | Avocat / APDP | L'argument d'outil neutre (A12) ne couvre pas cette dimension — sanctions concrètes possibles |

### Vérification terrain, également bloquante

> Sur 20 artisans recrutables demain : combien ont un CQM/CQP ? Combien ont une assurance ?

Cette réponse détermine quel modèle est **applicable**, indépendamment de sa qualité théorique. Si la couverture est très faible, l'exception A9 fermera de fait les domaines concernés.

---

## 6. L'arbitrage stratégique — TRANCHÉ

**Décision arrêtée le 3 août 2026 : option A — intermédiaire neutre, avec exception sur le risque physique élevé.**

Le concept d'origine était : *« un Upwork vérifié localement, différencié par la certification anti-fraude »*. Cette différenciation est abandonnée au profit d'un positionnement d'intermédiaire.

| Option A — **RETENUE** | Option B — écartée |
|---|---|
| Vérifie l'identité, affiche des déclarations | Vérifie identité, qualifications, assurance |
| Exposition minimale | Exposition réelle mais différenciation forte |
| Marché largement ouvert | Offre restreinte aux prestataires en règle |
| Différenciateurs : KYC, séquestre, réputation d'usage | Différenciateur : la vérification elle-même |
| Développement léger | Développement et charge opérationnelle lourds |
| **Modèle v3** | Modèle v2 / minimal v2 |

### Motifs de la décision

1. **Cohérence avec la nature de la plateforme** — un intermédiaire met en contact, il ne se substitue pas au jugement du client. Vérifier les qualifications équivaut à présélectionner, donc à endosser une part du choix.
2. **Réalité du marché béninois** — largement informel. Exiger assurance et certification vérifiées fermerait la plateforme à l'essentiel de l'offre potentielle. Une marketplace sans prestataires n'a pas de clients.
3. **Coût opérationnel récurrent** — chaque diplôme et chaque police à contrôler représente du temps humain permanent, non un développement livré une fois. Charge difficilement soutenable au stade actuel.

### L'exception maintenue — risque physique élevé

```text
Faible et moyen risque  →  option A pure (déclarations affichées, non vérifiées)
Risque physique élevé   →  assurance effective exigée, bloquante
                           (électricité, travail en hauteur, gros œuvre, engins)
```

Ce n'est pas une incohérence mais une exception délimitée et assumée, justifiée par la gravité : un accident grave laisserait un client sans recours effectif face à un prestataire insolvable, et la réputation de la plateforme en serait atteinte quelle que soit la qualité de ses CGU.

### Ce qui reste comme différenciation

Trois éléments réels, à ne pas sous-estimer sur un marché où la confiance passe aujourd'hui par le bouche-à-oreille :
- **KYC** — vrai différenciateur dans un marché largement informel
- **Séquestre** — résout l'impayé, premier risque du prestataire
- **Réputation d'usage accumulée** — devient le principal signal de confiance

### Conséquence sur le discours commercial

L'argument n'est plus « nous vérifions les compétences » mais :

> **« Nous savons qui est en face de vous, et votre argent est protégé jusqu'à ce que le travail soit fait. »**

Positionnement différent du concept initial, mais plus honnête et plus défendable.

### Le risque spécifique à surveiller

Les **premiers mois sont les plus risqués pour les clients** : la réputation d'usage — principal signal de confiance du modèle — n'existe pas encore. Contre-mesure : être très sélectif sur les prestataires recrutés au lancement, même sans les vérifier formellement.

### Ce dont il faut prendre acte

Aucun modèle ne libère totalement la plateforme de tout engagement. Quatre engagements sont irréductibles, même en option A :

| Engagement | Motif |
|---|---|
| Exactitude du KYC | La plateforme le vérifie, donc elle en répond |
| Fidélité de l'affichage des déclarations | Affirmer « voici ce que le prestataire a déclaré » engage sur cette fidélité |
| Fonctionnement du service | Un accès vendu doit fonctionner |
| Justesse des instructions de paiement au PSP | Une instruction erronée engage |

Au-delà du droit : **aucune clause ne protège de la réputation.** Ce qui protège réellement, ce sont trois mécanismes concrets — une **assurance RC professionnelle de la plateforme elle-même** (point le plus rentable et le plus souvent négligé), le **séquestre chez un PSP agréé**, et des **contrats clairs en amont**, la prévention réglant plus de litiges que toute clause de non-responsabilité.

---

## 7. Actions recommandées, dans cet ordre

L'arbitrage du positionnement étant tranché (§6), il reste trois étapes avant le développement :

1. **Consultation juridique** avec les 6 questions du §5. Une séance apportera plus que dix documents supplémentaires. Y ajouter la question de l'**assurance RC professionnelle de la plateforme elle-même** — c'est la protection la plus efficace et la plus souvent négligée.
2. **Vérification terrain** sur le taux de couverture assurance dans le vivier réel, pour calibrer la liste des domaines à risque élevé (§6, exception).
3. **Souscription de la RC professionnelle de la plateforme** avant l'ouverture au public.
4. **Seulement ensuite** : figer le document d'implémentation à partir de la v3 et développer.

**Arrêter la conception documentaire** jusqu'à la consultation juridique. Le corpus a été stabilisé par l'arbitrage A11 ; ce qui manque désormais n'est pas de la spécification mais des réponses de tiers.

---

## 8. Statut des documents produits

### Actifs
| Document | Rôle |
|---|---|
| `etat-consolide-Flexwork.md` | **Ce document — référence unique** |
| `modele-Flexwork-v3-intermediaire.md` | **Modèle de référence confirmé par l'arbitrage A11** — base du développement |
| `mission.md` | Module publication de mission — largement indépendant du modèle de badge, reste valable |
| `cdc-partenaires-certification.md` | Rôle réduit : volet formation optionnelle et sa monétisation (avec A7) |

### Obsolètes — à archiver, ne pas implémenter
| Document | Motif |
|---|---|
| `implementation-1.md` | Stack Laravel, VAE, dépassé |
| `implementation-2-artisan-manoeuvre.md` | VAE |
| `implementation-Flexwork-complet.md` | VAE |
| `implementation-Flexwork-securise-v3.md` | VAE, évaluation graduée |
| `implementation-Flexwork-v4.md` | Badge à 3 niveaux (A8) |
| `cdc-evaluation-graduee-vae.md` | A3 |
| `algorithme-niveau-professionnel.md` | A4 — option B écartée (A11), archivage définitif |
| `cdc-evaluation-badges.md` | A8 |
| `principe-fondamental-Flexwork.md` | A8 |
| `modele-minimal-Flexwork.md` (v1) | A8 |
| `modele-minimal-Flexwork-v2.md` | A8 — option B écartée (A11), archivage définitif |
| `enregistrement.md` | Analyse de sécurité surdimensionnée pour le modèle actuel |
| Prototypes HTML | À refaire selon la v3 : affichage en trois blocs séparés (§10 de la v3), déclarations au lieu de vérifications |

### Recommandation d'archivage
Créer un dossier `archive/`. L'arbitrage A11 ayant écarté l'option B, ces documents n'ont plus qu'une valeur historique — ils documentent des pistes explorées et les motifs de leur abandon, ce qui reste utile pour ne pas les rejouer.

---

## 9. Règles de conformité permanentes

Neuf questions à passer avant toute évolution future. **Toute réponse divergeant de la réponse attendue invalide la décision.**

1. La plateforme affiche-t-elle les informations comme **déclarées**, sans les certifier ? *(si non → refuser)*
2. La plateforme est-elle **partie** à un contrat de prestation ? *(si oui → refuser)*
3. La plateforme **détient-elle** des fonds à un moment quelconque ? *(si oui → refuser)*
4. La plateforme **impose-t-elle** tarifs, disponibilité ou exclusivité au prestataire ? *(si oui → refuser)*
5. La plateforme **recommande-t-elle** un prestataire sur un critère non publié ? *(si oui → refuser)*
6. La plateforme **tranche-t-elle** un litige de manière opposable ? *(si oui → refuser)*
7. Un domaine à risque physique élevé peut-il être exercé **sans couverture effective** ? *(si oui → refuser)*
8. Les données de l'outil de pointage sont-elles utilisées **par la plateforme** pour scorer, classer, sanctionner ou décider ? *(si oui → refuser — voir A12)*
9. Un profil de filière chantier peut-il être activé **en dessous de l'âge minimum légal** du pays, ou une dérogation est-elle possible ? *(si oui → refuser — voir A13)*

**Règle additionnelle permanente (A7)** : aucune commission sur une certification que la plateforme rend obligatoire.

**Règle additionnelle permanente (A12)** : la plateforme reste aveugle aux données de pointage — elles transitent, elles ne l'informent pas.

**Règle additionnelle permanente (A13)** : le seuil d'âge des filières chantier est administrable par pays mais **jamais en dessous de 18 ans**, sans dérogation possible.
