# Modèle Flexwork — v3.1
## Plateforme de mise en relation : intermédiaire pur

**Version** : 3.1
**Change par rapport à v2.0** : la plateforme cesse d'être garante. L'assurance devient une obligation contractuelle du prestataire envers le client, déclarée et non vérifiée. Le séquestre est délégué à un prestataire de paiement agréé. Le litige devient une médiation facultative.
**Change par rapport à v3.0 (arbitrages A12/A13)** : réintroduction encadrée d'un outil de pointage entre les parties, qui ne doit jamais informer la plateforme (§9.1) ; ajout d'un contrôle d'âge effectif — deuxième exception au modèle déclaratif après l'assurance — sur les filières chantier, avec un plancher légal non négociable de 18 ans (§9.2).

**Remplace** : `modele-minimal-Flexwork.md` v1 et v2, `principe-fondamental-Flexwork.md`, `cdc-evaluation-badges.md`, `algorithme-niveau-professionnel.md`, `cdc-evaluation-graduee-vae.md`

> **Avertissement** : ce document décrit une architecture fonctionnelle et contractuelle. Il ne constitue pas un avis juridique. La qualification d'un intermédiaire, la validité des clauses de responsabilité et le statut réglementaire des paiements et de l'assurance relèvent du droit béninois et de la réglementation UEMOA. **Une validation par un avocat est un prérequis au lancement.**

---

## 1. La nature de la plateforme

> **Flexwork met en relation des clients et des prestataires. Elle ne réalise aucun travaux, ne garantit aucun résultat, et n'est partie à aucun contrat de prestation.**

### 1.1 La tension à comprendre

```text
Plus la plateforme vérifie, sélectionne, impose et détient les fonds
    → plus elle ressemble à une partie au contrat

Moins elle en fait
    → plus elle est un intermédiaire neutre, mais moins elle protège
```

Ce modèle place délibérément le curseur du côté de l'intermédiation, avec **une seule exception assumée** (§7 : domaines à risque physique élevé).

### 1.2 Ce que la plateforme fait / ne fait pas

| La plateforme **fait** | La plateforme **ne fait pas** |
|---|---|
| Vérifier l'identité de ses utilisateurs | Vérifier les assurances ni les qualifications |
| Collecter et afficher des déclarations | Certifier l'exactitude de ces déclarations |
| Fournir un modèle de contrat comme outil | Signer ce contrat |
| Donner instruction à un PSP agréé | Détenir les fonds |
| Proposer une médiation | Juger un litige |
| Classer selon des critères objectifs publiés | Recommander « le meilleur » prestataire |

---

## 2. Architecture contractuelle — trois contrats

C'est le point technique décisif du modèle.

```text
┌─────────────────────────────────────────────────────────┐
│ CGU — Plateforme ↔ Client                               │
│ Objet : accès au service de mise en relation            │
│ La plateforme s'engage sur le fonctionnement du service │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ CGU — Plateforme ↔ Prestataire                          │
│ Objet : accès au service de mise en relation            │
│ Le prestataire déclare et GARANTIT ses qualifications   │
│ et son assurance (§4)                                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ CONTRAT DE PRESTATION — Client ↔ Prestataire            │
│ Objet, prix, délais, obligations, assurance,            │
│ responsabilités, conditions de libération des fonds     │
│                                                          │
│ → généré par la plateforme comme OUTIL                  │
│ → signé par les DEUX PARTIES                            │
│ → LA PLATEFORME N'EST PAS SIGNATAIRE                    │
└─────────────────────────────────────────────────────────┘
```

La plateforme fournit le modèle de contrat comme un éditeur fournit un modèle de facture : elle en propose la forme, elle n'en garantit pas l'exécution.

### 2.1 Contenu minimal du contrat de prestation

Généré automatiquement à partir des données de la mission et du profil :

- Identité des deux parties (telles que vérifiées pour le KYC)
- Objet précis, périmètre, livrables attendus
- Prix, devise, modalités et conditions de libération des fonds
- Délais d'exécution, date de début et de fin
- **Déclaration d'assurance du prestataire** (assureur, police, plafond, validité) ou mention explicite de son absence
- **Déclaration de qualification** du prestataire
- Responsabilité du prestataire sur la qualité, la conformité et la sécurité d'exécution
- Responsabilité du client sur la description du besoin, l'accès et la sécurité du site
- Clause de médiation facultative par la plateforme, sans caractère obligatoire
- Mention : *« Flexwork n'est pas partie au présent contrat. »*

---

## 3. Matrice de responsabilités

| Domaine | Responsable |
|---|---|
| Qualité et conformité des travaux | **Prestataire** |
| Respect des règles de sécurité sur site | **Prestataire** |
| Dommages causés pendant l'exécution | **Prestataire** (via sa RC professionnelle) |
| Détention effective des qualifications requises | **Prestataire** (déclare et garantit) |
| Souscription et maintien de son assurance | **Prestataire** |
| Exactitude de ses déclarations | **Prestataire** |
| Description exacte du besoin, du site et des contraintes | **Client** |
| Accès au chantier, sécurité des lieux | **Client** |
| Paiement du prix convenu | **Client** |
| **Choix du prestataire** | **Client** |
| Vérification de l'identité des utilisateurs | **Plateforme** |
| Affichage fidèle des informations **telles que déclarées** | **Plateforme** |
| Fonctionnement technique du service | **Plateforme** |
| Transmission des instructions de paiement au PSP | **Plateforme** |
| **Résultat de la mission** | **Hors périmètre plateforme** |

---

## 4. Assurance — obligation contractuelle du prestataire

## 4.1 Le déplacement

| | Modèle v2 (abandonné) | Modèle v3 |
|---|---|---|
| Nature | Condition d'accès imposée par la plateforme | **Obligation contractuelle du prestataire envers le client** |
| Qui vérifie | La plateforme — donc elle s'engage | Le prestataire déclare et **garantit** |
| Rôle plateforme | Bloque l'accès | Collecte la déclaration et l'affiche |
| Si absence | Candidature bloquée | Affichée au client, qui décide |
| Si déclaration mensongère | Faute de la plateforme (mauvaise vérification) | **Faute du prestataire** (fausse déclaration contractuelle) |

## 4.2 La déclaration engageante

Le prestataire souscrit, dans les CGU et dans chaque contrat de prestation, une déclaration dont la formulation type est :

> Je déclare détenir une assurance de responsabilité civile professionnelle valide, souscrite auprès de **[assureur]** sous le numéro de police **[numéro]**, d'un plafond de **[montant]**, valable jusqu'au **[date]**.
>
> Je garantis le client et Flexwork contre toute conséquence d'une déclaration inexacte ou d'un défaut de couverture.

```text
professional_declarations
- id, profile_id
- declaration_type       -- INSURANCE | QUALIFICATION
- insurer_name, policy_number, coverage_ceiling, valid_until
- declared_at
- declaration_text_snapshot   -- texte figé au moment de la déclaration
- ip_address, user_agent
- signature_reference
- previous_hash, current_hash  -- append-only
```

La déclaration est **horodatée, figée et immuable**. En cas de litige, elle constitue la preuve de l'engagement pris.

## 4.3 Formulations d'affichage — impératives

| Situation | Affichage obligatoire |
|---|---|
| Assurance déclarée | « Assurance déclarée par le prestataire — **non vérifiée par Flexwork** » suivi de : assureur, police, plafond, validité |
| Aucune déclaration | « **Aucune assurance déclarée par ce prestataire** » |
| Déclaration expirée | « Assurance déclarée expirée le [date] » |

**Formulations interdites** : ~~« assurance vérifiée »~~, ~~« prestataire assuré »~~, ~~« couverture garantie »~~ — chacune ferait de la plateforme la garante de l'information.

## 4.4 Avertissement au client avant engagement

Lorsqu'un client s'apprête à retenir un prestataire sans assurance déclarée, sur une mission de risque moyen ou élevé :

```text
⚠ Ce prestataire n'a déclaré aucune assurance de responsabilité civile
  professionnelle.

  En cas de dommage pendant les travaux, aucune indemnisation par une
  assurance ne sera possible. Le recours éventuel serait à exercer
  directement contre le prestataire.

  [ ] J'ai compris et je choisis ce prestataire
```

Le consentement est horodaté et conservé. Il ne transforme pas la plateforme en garante : il documente que le client a choisi en connaissance de cause.

---

## 5. Qualifications — déclarées, affichées, non certifiées

Même logique que l'assurance.

| | Traitement |
|---|---|
| Diplômes et certifications | **Déclarés** par le prestataire, avec document joint |
| Rôle plateforme | Collecte, affiche, conserve le document |
| Vérification | **Non effectuée** — affichage explicite |
| Engagement | Le prestataire garantit l'exactitude et l'authenticité |

**Affichage** : « CQP Plomberie — déclaré par le prestataire, document joint, **non vérifié par Flexwork** ».

**Ce que la plateforme peut faire sans s'engager** : rendre le document consultable par le client, qui vérifie lui-même s'il le souhaite. Fournir l'accès à l'information n'est pas la certifier.

**Modération a posteriori** : la plateforme peut retirer une déclaration manifestement frauduleuse signalée par un tiers, et suspendre le compte pour fausse déclaration — non pas au titre d'une obligation de vérification, mais au titre du respect des CGU.

---

## 6. Séquestre délégué à un prestataire de paiement agréé

## 6.1 Le problème résolu

Détenir les fonds ferait de la plateforme un intermédiaire financier soumis à agrément BCEAO, et la replacerait au cœur de la transaction.

## 6.2 L'architecture

```text
Le séquestre est opéré par un PRESTATAIRE DE PAIEMENT AGRÉÉ
(FedaPay ou équivalent licencié)

La plateforme :
  - transmet l'instruction de mise sous séquestre
  - transmet l'instruction de libération selon les conditions du contrat
  - NE DÉTIENT JAMAIS LES FONDS
  - n'apparaît pas comme bénéficiaire intermédiaire

Les conditions de libération figurent dans le contrat CLIENT ↔ PRESTATAIRE,
pas dans les CGU de la plateforme.
```

Vous conservez le bénéfice protecteur du séquestre — le meilleur mécanisme pour les deux parties — sans acquérir le statut réglementé ni la responsabilité de la détention.

## 6.3 Cycle

```text
1. Contrat de prestation signé par les deux parties
       ↓
2. Client paie via le PSP agréé (Mobile Money)
       ↓  fonds sous séquestre CHEZ LE PSP
3. Prestataire notifié : « fonds sécurisés chez [PSP], vous pouvez commencer »
       ↓
4. Travaux réalisés, livrables soumis
       ↓
5a. Client valide            → instruction de libération au PSP
5b. Client ne réagit pas     → acceptation tacite après délai contractuel
                               (7 jours proposé) → instruction de libération
5c. Client conteste          → instruction de gel au PSP, médiation (§8)
```

**Règles** : confirmation par webhook PSP uniquement · aucune instruction de libération hors des conditions du contrat · l'acceptation tacite est une **clause du contrat entre parties**, pas une règle de la plateforme.

## 6.4 Pourquoi l'acceptation tacite est essentielle

Sans elle, un client passif ou de mauvaise foi bloque indéfiniment le paiement du prestataire. C'est aussi important que le séquestre lui-même pour l'équilibre entre les parties. Elle doit figurer explicitement dans le contrat de prestation, acceptée par les deux.

---

## 7. L'exception assumée — domaines à risque physique élevé

## 7.1 Pourquoi une exception

Sur les domaines à risque physique élevé, un accident grave laisse un client sans recours effectif face à un prestataire insolvable. Une architecture contractuelle irréprochable protégera peut-être la plateforme en droit — **elle ne la protégera pas en réputation**, et elle ne réparera rien pour les personnes concernées.

Cette exception n'est donc pas une obligation juridique : c'est un **choix assumé** de ne pas laisser ce risque se réaliser.

## 7.2 Paliers de risque

| Palier | Exemples | Assurance |
|---|---|---|
| **Faible** | Peinture, jardinage, nettoyage, petit montage, prestations digitales | Déclarative — non bloquante |
| **Moyen** | Plomberie, menuiserie, carrelage, maçonnerie légère | Déclarative + avertissement client renforcé (§4.4) au-delà d'un montant configurable |
| **Élevé** | Électricité, travail en hauteur, gros œuvre, engins de chantier, structures porteuses | **Assurance effective obligatoire — bloquante, sans fenêtre de tolérance** |

```text
domain_risk_levels
- id, domain, country
- risk_level             -- LOW | MEDIUM | HIGH
- insurance_required     -- boolean (true pour HIGH)
- amount_threshold       -- déclenche l'avertissement renforcé (MEDIUM)
- justification          -- motif de sécurité
```

## 7.3 Rendre l'exception praticable — assurance à la mission

Exiger une police annuelle exclurait la majorité des artisans du marché. La solution : une **couverture ponctuelle souscrite au moment de la réservation**, portée par un assureur partenaire.

```text
Mission électricité         250 000 XOF
+ couverture chantier (2 %)   5 000 XOF
= total                     255 000 XOF
       ↓
prélevé dans le même paiement, la prime est reversée à l'assureur
```

| Avantage | Pour qui |
|---|---|
| Aucune trésorerie à avancer | Prestataire |
| Couverture effective pendant la mission | Client |
| Aucune police à vérifier — l'assureur émet | Plateforme |

**`[À VÉRIFIER]`** — deux prérequis :
1. Ce produit existe-t-il sur le marché béninois, et à quel taux ?
2. Distribuer de l'assurance est une activité réglementée : statut de courtier/intermédiaire d'assurance nécessaire, ou partenariat où l'assureur porte la distribution.

Sans ce produit, l'alternative sur le risque élevé est le blocage jusqu'à production d'une police annuelle — plus restrictif, mais ce palier ne peut pas rester sans couverture.

---

## 8. Médiation facultative — la plateforme ne juge pas

| | Modèle v2 (abandonné) | Modèle v3 |
|---|---|---|
| Nature | La plateforme décidait de la libération | **Médiation proposée**, non imposée |
| Effet de la décision | Opposable aux parties | Proposition que les parties acceptent ou refusent |
| Si refus | — | Les parties saisissent la juridiction compétente |

```text
1. Client conteste dans le délai contractuel
       ↓
2. Instruction de GEL transmise au PSP
       ↓
3. Médiation proposée aux deux parties (facultative)
       ↓
4a. Accord trouvé   → instruction au PSP conforme à l'accord des parties
4b. Pas d'accord    → les fonds restent gelés selon les conditions du PSP
                      les parties saisissent la juridiction compétente
                      la plateforme transmet les éléments sur demande
```

La plateforme **facilite** : elle recueille les éléments, propose une solution, transmet l'accord au PSP. Elle ne tranche pas.

**Conséquence à assumer** : sans décision opposable, certains litiges resteront sans issue rapide. C'est le prix de la neutralité. À compenser par une médiation de qualité, un délai affiché, et des contrats de prestation clairs en amont — c'est là que se joue la prévention.

---

## 9. Ce que la plateforme vérifie encore : l'identité

Le KYC reste **la seule vérification effective**, et il ne peut pas être abandonné : sans identification, il n'y a ni recours possible entre les parties, ni traçabilité, ni lutte contre les faux comptes.

Éléments : type de pièce, **recto** et **verso**, selfie, selfie avec pièce.
Statuts : `PENDING`, `VALIDATED`, `REJECTED`.

**Règle de blocage** :

```text
Le KYC ne bloque JAMAIS l'inscription ni la complétion du profil.
Le KYC VALIDATED conditionne UNIQUEMENT :
  - Client       : PUBLIER une mission
  - Prestataire  : CANDIDATER à une mission
```

Justification tenable en tant qu'intermédiaire : on n'engage pas un contrat entre deux parties dont l'une n'est pas identifiée.

Sécurité : formats PDF/JPG/PNG · max 5 Mo · scan ClamAV · watermark · AES-256 · bucket privé · 1 compte par numéro (SMS) · rate limiting `[MVP]`. OCR et détection de falsification `[V2]`.

**Badge unique** : `badge = (kyc.status == VALIDATED) ? IDENTITE_VERIFIEE : NON_VERIFIE`

Aucun autre badge. Tout le reste est déclaratif.

### 9.1 Outil de pointage (A12) — preuve entre les parties, pas information de la plateforme

Le pointage est réintroduit, mais recadré : c'est un outil de **preuve de présence entre le client et le prestataire**, jamais un système d'information ou de contrôle de la plateforme.

```text
Les données de pointage TRANSITENT par la plateforme, elles ne l'INFORMENT PAS.
```

Trois conditions impératives, cumulatives :

1. **Opt-in réellement libre** — le refus de l'une ou l'autre partie est sans aucune conséquence sur le reste du contrat.
2. **Horodatage ponctuel arrivée/départ uniquement** — jamais de suivi continu ou de géolocalisation en tâche de fond.
3. **Activation par mission, par les deux parties**, via le contrat — jamais activée par la plateforme.

Interdictions absolues : aucune route, job ou tableau de bord ne doit agréger, scorer, classer ou faire dépendre une décision (paiement, litige, visibilité, réputation) de ces évènements. Consultable uniquement par les deux parties du contrat concerné ; producible comme preuve en médiation (§8) seulement à l'initiative d'une des parties — jamais consultée d'office par un admin.

La géolocalisation ponctuelle reste une donnée sensible : purpose limité et déclaré, rétention courte (durée de la mission + délai de contestation), aucun usage secondaire, consentement révocable, déclaration APDP le cas échéant (prérequis bloquant #7, §17).

### 9.2 Contrôle d'âge sur les filières chantier (A13) — deuxième exception au modèle déclaratif

Aux côtés de l'assurance sur le risque élevé (§7), une deuxième exception assumée : l'âge minimum sur les filières chantier (Artisan, Manœuvre, Expert BTP/Autres) fait l'objet d'une **vérification effective** par la plateforme, pas d'une déclaration.

- Le seuil est **administrable par pays** (et, le cas échéant, par domaine — ex. conduite d'engins), mais avec un **plancher légal absolu et non négociable de 18 ans**. L'interface d'admin doit refuser toute valeur inférieure ; un seuil ne peut être ajusté que vers le haut.
- La donnée d'âge faisant foi est la **date de naissance extraite de la pièce d'identité**, saisie par l'Admin KYC au moment de sa décision (§9) — jamais déclarée par l'utilisateur lui-même.
- Le blocage porte sur **l'activation du profil**, pas seulement sur la candidature à une mission.
- Le contrôle est **toujours réévalué en direct**, jamais un statut figé stocké en base : un profil refusé à 17 ans s'active de lui-même à 18 ans, sans repasser le KYC.
- Le contrat de prestation (§2.1) porte une clause déclarative correspondante : *« Le prestataire déclare être âgé de [âge] ans et satisfaire l'âge minimum de [minimum_age] ans requis au [pays]... Le client reconnaît avoir été informé de cette exigence légale. »*

---

## 10. Affichage du profil — trois blocs strictement séparés

```text
┌─ VÉRIFIÉ PAR Flexwork ────────────────────────────┐
│ ✓ Identité vérifiée                                   │
└───────────────────────────────────────────────────────┘

┌─ DÉCLARÉ PAR LE PRESTATAIRE (non vérifié) ───────────┐
│ Assurance : RC Pro — [Assureur], police n° X,          │
│             plafond 5 000 000 XOF, valide au 31/12/26 │
│ Qualification : CQP Plomberie — document joint         │
│ Expérience : 8 ans · 12 réalisations                   │
│ Niveau : Senior                                        │
│ Tarif indicatif : 25 000 XOF / jour                    │
│                                                        │
│ Ces informations sont déclarées par le prestataire.    │
│ Flexwork ne les a pas vérifiées.                    │
└───────────────────────────────────────────────────────┘

┌─ ACTIVITÉ SUR LA PLATEFORME ─────────────────────────┐
│ 12 missions complétées · note 4,6/5                    │
│ membre depuis mars 2024                                │
└───────────────────────────────────────────────────────┘
```

**La séparation visuelle est structurante** : c'est elle qui matérialise la frontière entre ce que la plateforme garantit (l'identité) et ce dont elle n'est que le support (tout le reste).

### 10.1 Ce que la plateforme peut ajouter sans s'engager

Les avis clients et les missions complétées sont des **faits d'usage constatés sur la plateforme** — elle peut donc les afficher sans risque : ils ne portent pas sur une qualification déclarée mais sur ce qui s'est réellement produit dans le système.

C'est même, dans ce modèle, le signal de confiance le plus solide dont dispose le client. Il mérite d'être soigné.

---

## 11. Ce qu'il faut maintenir pour préserver ce statut

| À faire | À éviter absolument |
|---|---|
| Afficher les faits comme **déclarés** | « Prestataire qualifié », « nous garantissons » |
| Laisser le client choisir librement | Sélectionner ou recommander « le meilleur » |
| Classement par critères **objectifs et publiés** | Classement discrétionnaire valant recommandation |
| Contrat entre les parties, plateforme non signataire | Se porter caution ou garant |
| **Prix fixé par les parties** | Imposer les tarifs |
| Prestataire **libre de refuser** une mission | Obligations de disponibilité, sanctions de refus |
| Prestataire libre de travailler ailleurs | Clause d'exclusivité |

**Les trois derniers points sont critiques** : plus la plateforme encadre le prestataire (tarifs imposés, disponibilité obligatoire, exclusivité), plus la relation peut être requalifiée en relation de travail. C'est un risque qui a coûté cher à plusieurs plateformes dans d'autres juridictions.

---

## 12. Modèle de données

```text
users
- id, role, firstname, lastname
- email (unique), phone (unique, SMS)
- password_hash, country, state, city, locality, address
- status                     -- ACTIVE | SUSPENDED | BANNED
- date_naissance             -- A13 : saisie par l'Admin KYC uniquement, jamais déclarée
- date_naissance_set_by_id, date_naissance_set_at
```

```text
kyc_verifications
- id, user_id
- id_document_type, id_document_front, id_document_back
- selfie, selfie_with_document
- status, rejection_reason, attempt_count
- validated_at, validated_by_admin_id
```

```text
profiles
- id, user_id, profile_type
- identity_verified          -- dérivé du KYC
- declared_level             -- auto-déclaré
- main_domain, sub_specialty, secondary_domain
- sector, devis_mode, indicative_rate
- declared_experience_years  -- déclaré
- portfolio_items_count      -- dérivé
```

```text
professional_declarations    -- append-only, hash chaîné (voir §4.2)
declaration_documents        -- documents joints aux déclarations, consultables
```

```text
missions
- id, client_id
- title, description, domain
- risk_level                 -- dérivé de domain_risk_levels
- insurance_required         -- dérivé (true si HIGH)
- budget, currency, deadline
- contract_id
- status
```

```text
prestation_contracts
- id, mission_id, client_id, provider_id
- contract_document_url
- client_signed_at, provider_signed_at
- terms_snapshot             -- JSON : conditions figées à la signature
- acceptance_deadline_days
- previous_hash, current_hash
- client_opted_in_check_in, provider_opted_in_check_in  -- A12, indépendants
```

```text
check_in_events              -- A12 : preuve entre les parties, jamais lue par la plateforme
- id, contract_id, party_id
- type                       -- ARRIVEE | DEPART, ponctuel uniquement
- occurred_at, gps_lat, gps_lng
- retain_until               -- fin de mission + délai de contestation, puis purge
```

```text
country_age_requirements     -- A13, plancher légal 18 ans non administrable en dessous
- id, country, profile_type, domain (optionnel)
- minimum_age                -- >= 18, rejeté en base sinon
- legal_reference, justification
- set_by_admin_id, effective_from
```

```text
psp_escrow_operations        -- la plateforme instruit, ne détient pas
- id, contract_id
- psp_name, psp_reference
- amount, currency
- instruction_type           -- HOLD | RELEASE | FREEZE | REFUND
- instruction_sent_at
- psp_confirmed_at
- webhook_reference
- status
```

```text
mission_insurance            -- assurance à la mission (§7.3)
- id, mission_id
- insurer_name, policy_reference
- premium_amount, coverage_ceiling
- coverage_start, coverage_end
- status
```

```text
client_acknowledgements      -- consentement éclairé (§4.4)
- id, client_id, mission_id, provider_id
- acknowledgement_type       -- NO_INSURANCE | UNVERIFIED_QUALIFICATION
- text_snapshot
- acknowledged_at, ip_address
```

```text
mediations
- id, contract_id, opened_by
- reason, client_elements, provider_elements
- proposed_resolution
- client_accepted, provider_accepted
- outcome                    -- AGREEMENT | NO_AGREEMENT | WITHDRAWN
- mediator_admin_id
- created_at, closed_at
```

```text
domain_risk_levels           -- voir §7.2
verification_history         -- append-only, hash chaîné (KYC et déclarations)
admin_audit_log              -- justification obligatoire
```

**Tables supprimées** : toutes les `vae_*`, `expert_tests`, `professional_insurance` (devient une déclaration), `disputes` (devient `mediations`), `escrow_transactions` (devient `psp_escrow_operations`).

---

## 13. Administration — quatre rôles

| Rôle | Pouvoirs | Contraintes |
|---|---|---|
| **Admin KYC** | Valide/rejette le KYC — **seule vérification effective** | Max 30 validations/heure · justification obligatoire |
| **Admin Modération** | Retire les déclarations manifestement frauduleuses signalées · suspend pour fausse déclaration | Agit sur signalement, **pas de vérification systématique** |
| **Admin Médiation** | Instruit les médiations · propose des résolutions | **Ne décide pas** · ne libère aucun fonds unilatéralement |
| **Admin Superviseur** | Lit tout, ne modifie rien · instruit les recours | Revue mensuelle de 5 % des actions |

Le rôle **Admin Vérification** de la v2 disparaît : la plateforme ne vérifie plus les expériences, les qualifications ni les assurances.

---

## 14. Ordre de développement

**Phase 1 — Comptes** : authentification, rôles, unicité téléphone, rate limiting, profils.

**Phase 2 — KYC** : upload recto/verso/selfie, scan AV, watermark, chiffrement, parcours 4 étapes, interface Admin KYC.

**Phase 3 — Déclarations** : formulaires de déclaration (assurance, qualifications, expérience), documents joints consultables, textes d'engagement figés et horodatés, affichage en trois blocs séparés.

**Phase 4 — Missions et contrats** : création, paliers de risque par domaine, génération du contrat de prestation, signature des deux parties, avertissements et consentement éclairé.

**Phase 5 — Séquestre via PSP** : intégration du PSP agréé, instructions HOLD/RELEASE/FREEZE, webhooks, acceptation tacite comme clause contractuelle.
**Prérequis** : contrat PSP signé + validation juridique du montage.

**Phase 6 — Médiation** : ouverture, gel, dépôt d'éléments, proposition de résolution, acceptation par les parties, transmission au PSP.

**Phase 7 — Risque élevé et assurance à la mission** : `domain_risk_levels`, blocage sur HIGH, intégration de l'assureur partenaire, prime prélevée dans le paiement.
**Prérequis** : produit d'assurance à la mission disponible + statut de distribution validé.

**Phase 8 — Modération et traçabilité** : signalement, retrait de déclarations frauduleuses, `verification_history` append-only, `admin_audit_log`.

---

## 15. Ce que ce modèle coûte — assumé

**Le client porte le risque de son choix.** Sur du faible risque, c'est normal et acceptable. Sur le risque moyen sans assurance déclarée, un dommage peut rester sans indemnisation malgré le consentement éclairé.

**Les litiges peuvent rester sans issue rapide.** Sans décision opposable, une partie de mauvaise foi peut bloquer. Le séquestre limite le préjudice financier, pas le temps perdu.

**La réputation reste exposée même sans responsabilité juridique.** Un accident grave sur une mission trouvée via la plateforme sera associé à la plateforme dans l'opinion, quelle que soit l'architecture contractuelle. C'est la raison de l'exception du §7.

**La qualité de l'offre n'est pas garantie.** Sans vérification des qualifications, des prestataires incompétents peuvent exercer. Le contre-poids est la réputation d'usage (§10.1) — qui met du temps à se constituer, ce qui rend les premiers mois les plus risqués pour les clients.

---

## 16. Test de conformité de toute évolution

Neuf questions. **Toute réponse divergeant de la réponse attendue invalide la décision.**

1. La plateforme affiche-t-elle les informations comme **déclarées**, sans les certifier ? *(si non → refuser)*
2. La plateforme est-elle **partie** à un contrat de prestation ? *(si oui → refuser)*
3. La plateforme **détient-elle** des fonds à un moment quelconque ? *(si oui → refuser)*
4. La plateforme **impose-t-elle** des tarifs, une disponibilité ou une exclusivité au prestataire ? *(si oui → refuser)*
5. La plateforme **recommande-t-elle** un prestataire plutôt qu'un autre sur un critère non publié ? *(si oui → refuser)*
6. La plateforme **tranche-t-elle** un litige de manière opposable ? *(si oui → refuser)*
7. Un domaine à risque physique élevé peut-il être exercé **sans couverture effective** ? *(si oui → refuser)*
8. Les données de pointage (§9.1) **informent-elles** la plateforme — alimentent-elles un score, un classement, une pénalité ou une décision de litige ? *(si oui → refuser)*
9. Un profil filière chantier (§9.2) peut-il être **activé** en dessous du seuil d'âge minimum du pays, ou ce seuil peut-il descendre **sous 18 ans** ? *(si oui → refuser)*

---

## 17. Prérequis juridiques — bloquants

| # | Sujet | Effet si non résolu |
|---|---|---|
| 1 | **Validation du statut d'intermédiaire** par un avocat béninois | Le modèle entier repose sur cette qualification |
| 2 | **Opposabilité des clauses de responsabilité** dans les CGU et le contrat de prestation | Sans elle, la répartition du §3 ne tient pas |
| 3 | **Montage PSP** : la plateforme ne doit à aucun moment être bénéficiaire des fonds | Requalification en intermédiaire financier |
| 4 | **Statut pour la distribution d'assurance à la mission** (§7.3) | Bloque la Phase 7 |
| 5 | **Risque de requalification en relation de travail** | Contrôler tarifs, disponibilité, exclusivité (§11) |
| 6 | Validité de la génération automatique de contrats entre tiers | Forme et signature électronique |
| 7 | **Protection des données pour la géolocalisation du pointage** (§9.1) — déclaration APDP le cas échéant | Bloque l'activation de l'outil de pointage en production |

---

## 18. Points ouverts

| # | Sujet |
|---|---|
| 1 | Existence et taux d'un produit d'assurance à la mission au Bénin |
| 2 | Liste des domaines classés à risque élevé, par pays |
| 3 | Délai d'acceptation tacite (7 jours proposé) |
| 4 | Seuil de montant déclenchant l'avertissement renforcé en risque moyen |
| 5 | Délai affiché de traitement d'une médiation |
| 6 | Critères de classement des prestataires — à publier pour rester objectifs |
