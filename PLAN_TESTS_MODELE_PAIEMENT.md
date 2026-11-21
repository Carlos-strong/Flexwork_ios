# Plan de tests — Modèle de paiement défini par le devis (fixe ou par jalons)

> Règle testée (2026-10-01) : **c'est la soumission du devis par le prestataire qui fixe le modèle de
> paiement** (prix fixe ou par jalons). Le client l'accepte en même temps que le prix, et il est
> figé dans le contrat. Seuls les contrats **au temps** (S2H/S2J/S2W/S2M) gardent un mode posé à la
> publication.

Légende de la colonne **Auto** : ✅ déjà couvert par un test automatisé · ❌ à automatiser · 🖐 test manuel (UI).

---

## 1. Analyse

### 1.1 Points d'entrée touchés

| Côté | Écran / route | Rôle dans la règle |
|---|---|---|
| Client | `/missions/new` (MissionWizard) | Ne choisit plus fixe/jalons — encart « Défini par le devis ». Mode au temps dérivé de l'unité. |
| Prestataire | `/missions/[id]/devis` (mission QUOTE) | Sélecteur obligatoire Prix fixe / Par jalons (+ variante J1, J3, J4, S1). |
| Prestataire | `/missions/[id]` → « Candidater » (mission FIXED) | Même sélecteur, avec le montant unique. |
| Client | `/missions/[id]/proposals` | Badge « Prix fixe » / « Par jalons » par candidature, colonne « Paiement ». |
| Client | DevisDetails (tiroir, aperçu, panneau) | Bloc « Modèle de paiement » + définition, avant le tableau. |
| Client | `/missions/[id]/contract` | Aperçu de financement calculé à partir du mode **du devis accepté**. |
| API | `POST /api/missions/[id]/devis` | Exige un mode (sinon `payment_mode_required`), refuse J4 sur 1 ligne (`retention_requires_two_lines`). |
| API | `POST /api/missions/[id]/proposals` | Mode optionnel ; à défaut → round précédent → mode legacy de la mission → **F2**. |
| API | `POST /api/missions` | Ignore tout mode non-temps envoyé par le client. |
| API | `PATCH /api/missions/[id]/financing-mode` | Ne pose plus de mode fixe/jalons (sortir du temps uniquement). |
| API | `POST /api/missions/[id]/contract` + `GET .../financing-mode` | Mode = `effectiveFinancingModeKey(mission, devis)`. |

### 1.2 Matrice des combinaisons à couvrir

| Type de mission | Modèle choisi par le prestataire | Effet attendu au contrat |
|---|---|---|
| QUOTE (devis détaillé) | F2 — Prix fixe | Aucun jalon, 1 séquestre, 1 libération |
| QUOTE | J1 — Jalons au coût réel | 1 ligne = 1 jalon, montants proratisés au TTC |
| QUOTE | J3 — Jalons + progression | Jalons dérivés + libérations partielles à chaque palier |
| QUOTE | J4 — Jalons + retenue 5 % | Jalons dérivés, 95 % libéré par jalon, retenue libérée à la fin (≥ 2 lignes) |
| QUOTE | S1 — Forfait à sous-tâches | Jalons dérivés, **un seul** séquestre consommé jalon par jalon |
| FIXED (montant unique) | F2 | 1 séquestre, 1 libération |
| FIXED | J1/J3/J4/S1 | Régime du mode, jalons **saisis par le client** à la génération du contrat |
| FIXED | (aucun mode envoyé, appel API direct) | F2 par défaut |
| RATE (au temps) | — (pas de sélecteur) | Mode S2* de la mission, relevés de présence |
| Mission publiée avant la règle | (devis sans mode) | Repli sur le mode publié de la mission |

### 1.3 Jeu de données de référence

- **Devis QUOTE** : ligne 1 « Fournitures » 100 000, ligne 2 « Pose » 50 000, TVA 18 %, main d'œuvre 0
  → HT 150 000 · TVA 27 000 · **TTC 177 000**.
  - J1 → jalons **118 000** / **59 000**.
  - J4 → libérations 112 100 / 56 050, retenue finale **8 850**.
  - S1 → un seul séquestre de 177 000 : 177 000 → 59 000 → 0.
- **Candidature FIXED** : 120 000.
- **Mission au temps S2J** : 7 500 / jour × 20 jours = plafond 150 000.

### 1.4 Écarts relevés pendant l'analyse (à corriger, puis à tester)

| # | Écart | Risque |
|---|---|---|
| E1 | Le PDF du devis (`src/lib/devis-document.ts`) n'affiche pas le modèle de paiement. | Le client signe sur un document qui ne dit pas comment il paiera. |
| E2 | L'historique des révisions (`Revisions`, devis-panel) n'affiche pas le modèle par round. | Un passage fixe → jalons entre deux rounds passe inaperçu. |
| E3 | La notification « Devis reçu » ne mentionne pas le modèle. | Information incomplète dans l'e-mail. |
| E4 | Aucun avertissement quand une révision **change** de modèle. | Le client peut valider sans remarquer le changement. |

---

## 2. Tests côté PRESTATAIRE

### 2.1 Fonctionnels — formulaire de devis (mission QUOTE)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| P-F01 | Ouvrir le formulaire d'un premier devis | Aucun modèle présélectionné ; message orange « Choisissez comment vous serez payé » ; bouton Soumettre grisé | 🖐 |
| P-F02 | Cliquer « Prix fixe » | Tuile active ; consigne « Chiffrez un prix unique… » ; libellés « poste », « + Ajouter poste » ; récap « Prix fixe » | 🖐 |
| P-F03 | Cliquer « Par jalons » | J1 présélectionné (badge « Recommandé ») ; variantes J1/J3/J4/S1 listées ; libellés « jalon » ; récap « Par jalons » | 🖐 |
| P-F04 | Choisir J3 | Consigne ajoute le point « chaque palier de progression… » | 🖐 |
| P-F05 | Choisir S1 | Consigne ajoute « le client séquestre la TOTALITÉ dès le départ » | 🖐 |
| P-F06 | Choisir J4 avec 1 seule ligne | Avertissement « au moins deux jalons » sous le tableau ; bouton Soumettre grisé | 🖐 |
| P-F07 | J4 puis ajouter une 2ᵉ ligne | Avertissement disparaît ; soumission possible | 🖐 |
| P-F08 | Repasser de « Par jalons » à « Prix fixe » | Variante effacée, F2 appliqué ; libellés repassent à « poste » | 🖐 |
| P-F09 | Soumettre un devis Prix fixe complet | 200 ; redirection vers « Mes candidatures » ; `devisData.financingModeKey = "F2"` | ✅ (prestataire) |
| P-F10 | Soumettre un devis J1 complet | 200 ; `devisData.financingModeKey = "J1"` | ✅ (devis-workflow D2) |
| P-F11 | Bouton « Aperçu » | Le badge du modèle s'affiche sous la référence du devis | 🖐 |
| P-F12 | Récap latéral | « Jalons : n » en mode jalons, « Postes : n » en prix fixe | 🖐 |

### 2.2 Fonctionnels — candidature à prix fixe (mission FIXED)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| P-C01 | Cliquer « Candidater » | Le sélecteur apparaît avec le champ prix ; aucun modèle présélectionné | 🖐 |
| P-C02 | Envoyer sans choisir de modèle | Message « Choisissez le modèle de paiement : prix fixe ou par jalons. » ; aucune requête envoyée | 🖐 |
| P-C03 | Choisir « Par jalons » | Consigne « Chiffrez un montant global : le client détaillera lui-même les jalons… » | 🖐 |
| P-C04 | Envoyer avec F2 | 200 ; `devisData.financingModeKey = "F2"` | ✅ (workflow-complet P1) |
| P-C05 | Envoyer avec J4 | 200 (pas de contrôle « 2 lignes » sur un montant unique) | ✅ (workflow-complet P2) |
| P-C06 | Mission au temps (S2J) | Pas de sélecteur ; encart « Fixé par la mission (tarif au temps) » ; saisie du tarif journalier | ✅ API (workflow-incidents) / 🖐 UI |

### 2.3 Révisions et brouillons

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| P-R01 | Révision demandée → formulaire rouvert | Le modèle du round précédent est présélectionné | 🖐 |
| P-R02 | Révision resoumise **sans** `financingModeKey` (API) | Mode du round précédent conservé | ✅ (prestataire) |
| P-R03 | Révision qui passe de J1 à F2 | Round 2 enregistré avec F2 ; le client voit « Prix fixe » | ✅ (prestataire) |
| P-R04 | « Enregistrer brouillon » puis recharger la page | Modèle restauré avec le reste du devis | 🖐 |
| P-R05 | Brouillon antérieur (sans modèle) restauré | Formulaire chargé, modèle vide, soumission bloquée jusqu'au choix | 🖐 |
| P-R06 | Blocage garant/assurance → brouillon auto | Modèle conservé dans le brouillon, restauré au retour | 🖐 |
| P-R07 | Brouillon de candidature FIXED | Modèle restauré (`proposal-draft`) | 🖐 |

### 2.4 Validation et cas négatifs (API)

| ID | Requête | Réponse attendue | Auto |
|---|---|---|---|
| P-N01 | `POST /devis` sans `financingModeKey`, mission sans mode | 400 `payment_mode_required` | ✅ (prestataire) |
| P-N02 | `POST /devis` avec `"ZZ"` | 400 `invalid_payload` (clé inconnue, Zod) | ✅ (prestataire) |
| P-N03 | `POST /devis` avec `"F3"` (indisponible) | 400 `payment_mode_required` | ✅ (prestataire) |
| P-N04 | `POST /devis` avec `"S2J"` (mode au temps) | 400 `payment_mode_required` | ✅ (prestataire) |
| P-N05 | `POST /devis` J4 avec 1 ligne | 400 `retention_requires_two_lines` | ✅ (prestataire) |
| P-N06 | `POST /proposals` sans mode, mission FIXED neuve | 200, F2 par défaut | ✅ (security-guards) |
| P-N07 | `POST /proposals` avec `"S2H"` sur mission FIXED | 400 `payment_mode_invalid` | ✅ (prestataire) |
| P-N08 | `POST /proposals` sur mission au temps avec `"J1"` | 200 ; mode ignoré, contrat au temps | ✅ (prestataire) |

---

## 3. Tests côté CLIENT

### 3.1 Publication de mission (wizard)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| C-P01 | Étape « Rémunération », modèle **Prix fixe** | Encart « Prix fixe ou par jalons — Défini par le devis » ; aucun choix de mode ; étape validable | 🖐 |
| C-P02 | Modèle **Devis** | Même encart ; fourchette, tours, date limite inchangés | 🖐 |
| C-P03 | Modèle **Au temps** | Mode dérivé de l'unité (S2H/S2J/S2W/S2M), badge « Déterminé », astérisque obligatoire | 🖐 |
| C-P04 | Passer de « Au temps » à « Prix fixe » | Mode effacé, l'encart « Défini par le devis » remplace le mode au temps | 🖐 |
| C-P05 | Récapitulatif (non-temps) | « Financement : Fixe ou par jalons — défini par le devis du prestataire » | 🖐 |
| C-P06 | Publier (FIXED/QUOTE) | `Mission.financingModeKey = null` en base | ✅ (client-publication) |
| C-P07 | Appel API direct `POST /missions` avec `financingModeKey: "J4"` sur FIXED | 200 ; mode ignoré (`null`) | ✅ (client-publication) |
| C-P08 | Publier au temps S2J | `financingModeKey = "S2J"`, `budget = tarif × quantité` | ✅ (workflow-complet P4) |
| C-P09 | Brouillon de mission restauré | Aucun mode fixe/jalons réinjecté depuis l'ancien brouillon | 🖐 |
| C-P10 | Page détail de mission | Ligne « Paiement : Prix fixe ou par jalons — proposé par le prestataire » (ou « Financement : <mode au temps> ») | 🖐 |

### 3.2 Réception et comparaison des devis

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| C-R01 | Liste des devis (desktop) | Colonne « Paiement » : badge + « n lignes » | 🖐 |
| C-R02 | Liste des devis (mobile) | Badge à côté du montant | 🖐 |
| C-R03 | Liste des candidatures prix fixe | Badge sous le montant (desktop et mobile) | 🖐 |
| C-R04 | Tiroir « Voir » d'un devis | Bloc « Modèle de paiement » + définition, **au-dessus** du tableau | 🖐 |
| C-R05 | Tiroir d'une candidature prix fixe | Badge sous « Montant proposé » | 🖐 |
| C-R06 | Survol du badge | Info-bulle avec la définition du mode | 🖐 |
| C-R07 | Devis ancien sans modèle | Aucun badge ni bloc (rien d'inventé) | 🖐 |
| C-R08 | Comparer 2 devis : un F2, un J1 | Les deux modèles se distinguent visuellement (bleu / vert) | 🖐 |

### 3.3 Négociation

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| C-N01 | Demander une révision | Inchangé ; le prestataire retrouve son modèle | ✅ (devis-workflow D3) |
| C-N02 | Le prestataire change de modèle au round 2 | Le badge reflète le nouveau modèle (voir écarts E2/E4) | ✅ (client-devis-contrat) |
| C-N03 | Rejeter un devis | Inchangé | ✅ |
| C-N04 | Valider un devis F2 | `devis_valide` ; aucun changement de modèle possible ensuite | ✅ (client-devis-contrat) |

### 3.4 Génération du contrat

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| C-K01 | Devis QUOTE **F2** accepté | Aperçu « Financement — Fixe 100 % escrow upfront » ; aucun jalon ; contrat sans jalon | ✅ (client-devis-contrat) |
| C-K02 | Devis QUOTE **J1** accepté | Aperçu 118 000 / 59 000 ; contrat à 2 jalons ; somme = 177 000 | ✅ (workflow-incidents W3) |
| C-K03 | Devis J1 + jalons manuels envoyés dans le corps | Jalons manuels **ignorés**, jalons dérivés du devis | ✅ (devis-workflow D6/D8) |
| C-K04 | Devis QUOTE **J3** | `financingMode = progressive` au contrat | ✅ (client-devis-contrat) |
| C-K05 | Devis QUOTE **J4** (2 lignes) | `retentionRate = 0.05` | ✅ (client-devis-contrat) |
| C-K06 | Devis QUOTE **S1** | `fundingGranularity = upfront` ; un seul séquestre | ✅ (client-devis-contrat) |
| C-K07 | Candidature FIXED **J1** acceptée | Formulaire manuel de jalons affiché (`devis_required`) ; régime J1 appliqué | ✅ (workflow-incidents) |
| C-K08 | Candidature FIXED **F2** | Contrat sans jalon | ✅ (workflow-complet P1) |
| C-K09 | `termsSnapshot.financingModeKey` | Égal au mode **du devis**, pas à celui de la mission | ✅ (client-devis-contrat) |
| C-K10 | Mission legacy (mode J4 sur la mission, devis sans mode) | Contrat en J4 (repli) | ✅ (client-devis-contrat) |
| C-K11 | Mission au temps dont le devis porterait J1 | Contrat au temps, mode S2* de la mission | ✅ (unitaire) |
| C-K12 | `PATCH /financing-mode` avec `"J1"` | Mission `financingModeKey = null` ; le contrat suit le devis | ✅ (client-publication) |
| C-K13 | `PATCH /financing-mode` après contrat | 409 `financing_mode_locked` | ✅ (client-publication) |

### 3.5 Séquestre et paiements (bout en bout)

| ID | Parcours | Résultat attendu | Auto |
|---|---|---|---|
| C-E01 | QUOTE F2 : financer → livrer → valider | 1 HOLD 177 000, 1 RELEASE 177 000, mission clôturée | ✅ (client-devis-contrat) |
| C-E02 | QUOTE J1 : 2 jalons | HOLD 118 000 puis 59 000, chaque RELEASE après validation | ✅ (W3) |
| C-E03 | QUOTE J3 : palier 50 % puis 100 % | RELEASE partiels proportionnels, total = montant du jalon | ✅ (FIXED W2) / ❌ (QUOTE) |
| C-E04 | QUOTE J4 | 112 100 + 56 050 libérés, retenue 8 850 libérée en dernier | ✅ (FIXED P2) / ❌ (QUOTE) |
| C-E05 | QUOTE S1 | 1 seul HOLD de 177 000 ; tenter un HOLD par jalon → refusé | ✅ (FIXED P3) / ❌ (QUOTE) |
| C-E06 | Règles d'or (console admin) | Aucun écart séquestre ↔ libérations sur tous les parcours | ✅ (P6, W9) |

---

## 4. Tests transverses

### 4.1 Non-régression

| ID | Point | Auto |
|---|---|---|
| R01 | Suite unitaire complète (870 tests) | ✅ |
| R02 | Suite e2e complète (495 tests) | ✅ |
| R03 | Contrats au temps S2H/S2J/S2W/S2M de bout en bout (détail en section 5) | ✅ |
| R04 | Crons : expiration de devis, contre-signature 48 h, acceptation tacite | ✅ |
| R05 | Exclusivité de candidature après clôture | ✅ |
| R06 | Missions et contrats existants en base : affichage et paiements inchangés | 🖐 (sur copie de la base de prod) |

### 4.2 Sécurité et permissions

| ID | Scénario | Attendu | Auto |
|---|---|---|---|
| S01 | Le client tente de soumettre un devis sur sa propre mission | 403 `self_dealing_forbidden` | ✅ |
| S02 | Un tiers appelle `PATCH /financing-mode` | 404 | ✅ (client-publication) |
| S03 | Le prestataire modifie `devisData.financingModeKey` après `devis_valide` | Refus (`proposal_closed`) | ✅ (prestataire) |
| S04 | Injection de `toString` / `constructor` comme mode | Refusé (`isFinancingModeKey` via `hasOwnProperty`) | ✅ (unitaire) |

### 4.3 UI / UX / accessibilité

| ID | Point | Auto |
|---|---|---|
| U01 | Sélecteur utilisable au clavier (Tab, Espace, flèches sur les radios) | 🖐 |
| U02 | `aria-pressed` correct sur les tuiles Prix fixe / Par jalons | 🖐 |
| U03 | Rendu mobile 375 px : formulaire de devis, onglets Détails/Devis/Client | 🖐 |
| U04 | Contraste des badges bleu/vert (AA) | 🖐 |
| U05 | Textes sans faute, cohérents entre wizard, formulaire, badge et contrat | 🖐 |

### 4.4 Notifications

| ID | Point | Auto |
|---|---|---|
| N01 | « Devis reçu » envoyé au client avec montant TTC | ✅ |
| N02 | Mention du modèle dans la notification (écart E3) | ✅ (client-devis-contrat) |

---

## 5. Contrats au temps — heure / jour / semaine / mois (S2H, S2J, S2W, S2M)

> Décision (2026-10-01) : ces modes **restent posés par le client à la publication**. L'unité et la
> quantité maximale sont des conditions de la mission : le client doit connaître le montant
> maximum qu'il mettra sous séquestre avant de publier. Le prestataire ne propose que **son
> tarif** ; la règle « c'est le devis qui fixe le modèle » ne s'applique pas ici.

> **Mode de pointage** (2026-10-01) : le client fixe aussi, à la publication, la **règle de
> validation des relevés** — « Validation totale » (un relevé se constate en entier, ou se
> refuse avec motif, ou s'en conteste une part) ou « Validation partielle autorisée » (le
> validateur peut n'en reconnaître qu'une partie). Figée au contrat (`SpotTimeTerms`), énoncée à
> l'Article 4, rappelée au prestataire avant sa candidature. L'outil horodaté/GPS (A12) n'est
> pas concerné : il reste facultatif, après contrat, avec le consentement des deux parties.

**Données de référence** : S2J, 7 500 / jour × 20 jours = plafond **150 000** ·
S2H, 1 500 / heure × 20 h = 30 000 · S2M, 240 000 / mois × 3 = 720 000.

### 5.1 Côté CLIENT — publication

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-C01 | Modèle « Au temps », unité Jour | Mode S2J affiché, badge « Déterminé » ; aucun sélecteur fixe/jalons | 🖐 |
| T-C02 | Changer l'unité Heure → Semaine → Mois | Mode suit l'unité (S2H → S2W → S2M), libellés « par heure/semaine/mois » | 🖐 |
| T-C03 | Tarif 7 500 et quantité 20 | « Plafond séquestré : 150 000 XOF » calculé en direct | 🖐 |
| T-C04 | Quantité 0,5 (pas de 0,5) | Acceptée ; plafond 3 750 | 🖐 |
| T-C05 | Continuer sans tarif ou sans quantité | Blocage « Indiquez le tarif par jour et la quantité maximale » | 🖐 |
| T-C06 | Publier S2J | `financingModeKey = "S2J"`, `budgetType = "RATE"`, `budget = 150 000` | ✅ (workflow-complet P4) |
| T-C07 | API : publier S2J sans tarif ni quantité | 400 `time_terms_required_to_publish` | ✅ (client-publication) |
| T-C08 | API : `budgetType: "RATE"` sans mode au temps | 400 `rate_requires_time_mode` | ✅ (client-publication) |
| T-C09 | API : mode S2J envoyé avec `budgetType: "FIXED"` | Mission enregistrée en `RATE` (forcé) | ✅ (client-publication) |
| T-C10 | Récapitulatif | Tarif, plafond et « Financement : Au temps — tarif journalier » | 🖐 |
| T-C11 | Détail de la mission | « Financement : Au temps — tarif journalier » (et non « défini par le devis ») + « Pointage : <mode> » | 🖐 |
| T-C12 | Bloc « Mode de pointage » (sous-formulaire Au temps) | Deux choix : « Validation totale » / « Validation partielle autorisée », avec définition ; **aucun** présélectionné | 🖐 |
| T-C13 | Continuer sans choisir le mode de pointage | Blocage « Choisissez le mode de pointage : validation totale ou partielle des relevés. » | 🖐 |
| T-C14 | Récapitulatif | Ligne « Mode de pointage : Validation totale » | 🖐 |
| T-C15 | Brouillon de mission repris | Mode de pointage restauré | 🖐 |
| T-C16 | Publier avec « totale » | `Mission.attendanceValidation = "totale"` | ✅ (workflow-incidents W5) |
| T-C17 | API : mission au temps publiée sans mode de pointage | Enregistrée en `"partielle"` (défaut historique) | ✅ (workflow-complet P4) |
| T-C18 | API : mode de pointage envoyé sur une mission FIXED ou QUOTE | Ignoré (`null`) | ✅ (client-publication) |
| T-C19 | API : valeur hors liste (`"souple"`) | 400 `invalid_payload` | ✅ (client-publication) |

### 5.2 Côté PRESTATAIRE — candidature

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-P01 | Ouvrir « Candidater » sur une mission S2J | Champ « Votre tarif par jour » ; encart « Fixé par la mission (tarif au temps) » ; **pas** de sélecteur fixe/jalons | 🖐 |
| T-P01b | Même écran | Encart « Mode de pointage : Validation totale. » + définition, **avant** l'envoi | 🖐 |
| T-P02 | Saisir 8 000 | Aide « Plafond du contrat : 160 000 (20 jours maximum). Seul le temps constaté vous sera versé. » | 🖐 |
| T-P03 | Tarif décimal (7 500,5) | « Le tarif doit être un nombre entier. » | 🖐 |
| T-P04 | Envoyer 8 000 | `unitRate = 8 000`, `montant = 160 000` (recalculé côté serveur) | ✅ (workflow-incidents W4/W5) |
| T-P05 | API : `montant` seul, sans `unitRate` | Tarif déduit = montant / quantité max | ✅ (prestataire) |
| T-P06 | API : ni montant ni tarif | 400 `unit_rate_required` | ✅ (prestataire) |
| T-P07 | API : mission S2 sans quantité max (ancienne) | 409 `time_terms_missing` | ✅ (prestataire) |
| T-P08 | API : envoyer `financingModeKey: "J1"` | Ignoré ; le contrat reste au temps | ✅ (prestataire) |
| T-P09 | Mission S2J dans le formulaire de devis détaillé | Impossible : une mission au temps n'est jamais en mode QUOTE (redirection vers la mission) | 🖐 |

### 5.3 Contrat et séquestre

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-K01 | Générer le contrat S2J | `SpotTimeTerms` créé : tarif proposé, quantité 20, plafond = prix du contrat ; aucun jalon | ✅ (time-contract) |
| T-K02 | Document du contrat | Énonce tarif et plafond, ne promet aucun jalon | ✅ (time-contract) |
| T-K03 | Aperçu de financement (écran contrat) | Conditions au temps affichées, pas de découpage | 🖐 |
| T-K04 | Financement | **Un seul** séquestre du plafond (150 000) avant démarrage | ✅ (spot-time §10) |

### 5.4 Relevés de présence — prestataire

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-R01 | Déclarer une journée | 201 ; statut `submitted` ; **rien n'est libéré** | ✅ (spot-time §20) |
| T-R02 | Le client ou le responsable déclare à la place du prestataire | 403 `worker_only` | ✅ (prestataire) |
| T-R03 | Deuxième relevé sur la même journée | 409 `duplicate_period` | ✅ |
| T-R04 | Relevé qui chevauche partiellement (8h–12h puis 10h–14h) | 409 `period_overlap` | ✅ |
| T-R05 | Quantité nulle ou négative | 400 `invalid_quantity` | ✅ |
| T-R06 | Période invalide (fin avant début) | 400 `invalid_period` | ✅ (prestataire) |
| T-R07 | S2W : relevé un dimanche | Rattaché à la semaine ISO qui **s'achève** (lundi → dimanche) | ✅ (unitaire semaine) |
| T-R08 | S2W : première et dernière semaine partielles | Se pointent pour la fraction travaillée | 🖐 |
| T-R09 | S2M : deux relevés dans le même mois | Le second est refusé (une seule fois par période) | ✅ (W5) |
| T-R10 | Déclarer après clôture du contrat | 409 `contract_closed` | ✅ |

### 5.5 Relevés de présence — client (et responsable de chantier)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-V01 | Valider 4 jours | Libération 30 000 ; solde séquestre 120 000 | ✅ (spot-time §11) |
| T-V02 | 6 déclarés, 4 validés | 4 payés, 2 restent au séquestre | ✅ (§21) |
| T-V03 | Valider plus que déclaré | 409 `approved_above_declared` | ✅ |
| T-V04 | Refuser sans motif | 409 `rejection_reason_required` | ✅ (client-releves) |
| T-V05 | Refuser avec motif | Rien n'est payé ; la période peut être redéclarée | ✅ |
| T-V06 | Contester 2 jours sur 6 | 4 payés, 2 **gelés** | ✅ |
| T-V07 | Contester sans motif / contester tout | 409 `dispute_reason_required` / `nothing_disputed` | ✅ |
| T-V08 | Arbitrage pour / contre le prestataire | Part payée / fonds de nouveau disponibles | ✅ |
| T-V09 | Valider au-delà des 20 jours | 409 `quantity_cap_exceeded`, reliquat annoncé | ✅ |
| T-V10 | Tarif issu d'un plafond négocié (7 500,05) | Le dernier relevé solde exactement le plafond, sans reliquat d'arrondi | ✅ (client-releves) |
| T-V11 | Séquestre insuffisant | 409 `escrow_insufficient` ; alerte « le séquestre couvre encore n jours » sous 20 % | ✅ (§19, W4) |
| T-V12 | Responsable de chantier désigné | Peut valider ; non désigné ou révoqué : refus | ✅ (site-manager) |
| T-V13 | Le prestataire valide son propre relevé | Refusé | ✅ |
| T-V14 | Heures supplémentaires autorisées au contrat | Payées au tarif majoré ; non autorisées : au tarif normal, jamais refusées | ✅ (client-releves) |
| T-V15 | Écran des relevés (mobile et desktop) | Statuts, motifs de refus et part gelée lisibles | 🖐 |

#### Mode de pointage — validation totale ou partielle

Tous les cas ci-dessous valent pour le client **et** pour le responsable de chantier désigné.

| ID | Mode du contrat | Scénario | Résultat attendu | Auto |
|---|---|---|---|---|
| T-V20 | — | En-tête du panneau des relevés (client, responsable, prestataire) | « Mode de pointage : <libellé> » avec définition au survol | 🖐 |
| T-V21 | Partielle | « Constater » : 6 déclarés | Champ quantité **modifiable** (0,25 à 6) | 🖐 |
| T-V22 | Partielle | Constater 4 sur 6 | 4 payés, 2 restent au séquestre | ✅ (spot-time §21) |
| T-V23 | Totale | « Constater » : 6 déclarés | Champ quantité **figé à 6**, grisé, définition au survol | 🖐 |
| T-V24 | Totale | API : constater 4 sur 6 | 409 `partial_validation_not_allowed` ; rien payé ; relevé toujours `submitted` | ✅ (attendance-validation) |
| T-V25 | Totale | Constater 6 sur 6 | 6 × tarif payé | ✅ (attendance-validation) |
| T-V26 | Totale | Refuser avec motif, puis le prestataire redéclare la quantité exacte | Refus sans paiement ; la redéclaration se constate en entier | ✅ (attendance-validation) |
| T-V27 | Totale | Contester 2 jours sur 5 | Contestation **permise** : 3 payés, 2 gelés jusqu'à l'arbitrage | ✅ (attendance-validation) |
| T-V28 | Totale | Message d'erreur affiché au validateur si le refus de validation partielle remonte | « Ce contrat impose la validation totale : constatez… refusez… ou contestez… » | 🖐 |
| T-V29 | Totale | Heures supplémentaires (contrat qui les autorise) | La quantité reste la quantité déclarée ; seule la part « dont heures sup. » est saisie | ✅ (client-releves) |
| T-V30 | — | Contrat signé avant le 2026-10-01 | Traité en « partielle » (défaut de migration) | ✅ (migration, défaut `partielle`) |
| T-V31 | — | Contrat généré depuis une mission « totale » | `SpotTimeTerms.attendanceValidation = "totale"` ; Article 4 : « valide en totalité… aucune validation partielle sans contestation » | ✅ (W5, contract-clauses) |
| T-V32 | — | Contrat généré depuis une mission « partielle » | Article 4 : « valide en tout ou partie » | ✅ (time-contract) |
| T-V33 | — | Aperçu du contrat (écran client avant génération) | Ligne « Mode de pointage » dans les conditions au temps | 🖐 |
| T-V34 | — | `PATCH /financing-mode` vers S2J avec `attendanceValidation: "totale"` | Mission passée en S2J, mode de pointage « totale » | ✅ (client-publication T-M01) |
| T-V35 | — | `PATCH /financing-mode` qui quitte le temps | Mode de pointage effacé (`null`) | ✅ (client-publication T-M03) |

### 5.6 Clôture

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-F01 | Clôturer avec un relevé en attente | 409 `attendance_pending` | ✅ |
| T-F02 | Clôturer avec un versement dû non parti | 409 `payment_pending` | ✅ |
| T-F03 | Clôturer pendant une médiation | 409 `mediation_open` | ✅ (client-releves) |
| T-F04 | Clôture par le prestataire ou un tiers | Refusée | ✅ |
| T-F05 | Clôture valide | Mission `cloturee`, solde non consommé rendu au client (ex. 120 000) | ✅ |
| T-F06 | Seconde clôture | Aucun nouveau remboursement | ✅ |
| T-F07 | S2M : 3 mois séquestrés, 1 mois consommé | 240 000 versés, 480 000 rendus | ✅ (W5) |

### 5.7 Changement de mode avant contrat (`PATCH /financing-mode`)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| T-M01 | Passer une mission FIXED en S2J avec tarif et quantité | Mission en `RATE`, mode S2J, budget = plafond (si aucune candidature) | ✅ (client-publication) |
| T-M02 | Passer en S2J sans conditions | 409 `time_terms_required` | ✅ (client-publication) |
| T-M03 | Quitter S2J (demander J1) | Mode effacé, tarif/quantité effacés, `budgetType = FIXED` ; fixe/jalons se décidera au devis | ✅ (client-publication) |
| T-M04 | Après génération du contrat | 409 `financing_mode_locked` | ✅ (client-publication) |

---

## 6. Vérification / validation — « Moi-même » ou « OPR / responsable chantier »

> Proposé à la publication **seulement si la catégorie l'autorise** (réglage administrateur
> « Vérification OPR »), en boutons radio ; figé au contrat. Le responsable doit être désigné
> **avant le financement** ; tout changement ultérieur est inscrit au journal du contrat et notifié. En **OPR** :
> le prestataire déclare ; le **responsable chantier** constate les relevés, apprécie les preuves,
> constate l'avancement et **transmet** ; le **client** prononce seul la validation définitive
> (libération). Strict : sans transmission, le client ne valide pas — il peut remplacer le
> responsable. Le délai d'acceptation tacite court toujours depuis la soumission.

### 6.1 Publication et désignation

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| V-P00 | Backoffice › Catalogue : cocher « OPR » sur une catégorie (création et édition) | Badge « OPR », trace au journal admin | 🖐 |
| V-P00b | Catégorie non marquée (ex. Design) | Le champ n'apparaît pas ; mission en « Moi-même » | 🖐 |
| V-P00c | API : `validationMode: "opr"` sur une catégorie non marquée | 400 `opr_not_allowed_for_category` | ✅ (opr-jalons) |
| V-P00d | Changer de catégorie (marquée → non marquée) après avoir choisi OPR | Choix OPR effacé | 🖐 |
| V-P01 | Catégorie marquée, étape « Lieu et dates » sans choix | Blocage « Indiquez qui vérifie et valide… » | 🖐 |
| V-P02 | Boutons radio « Moi-même » / « OPR » | Un seul choix possible, navigation clavier par flèches | 🖐 |
| V-P03 | OPR + e-mail d'un compte responsable chantier | Mission `validationMode = opr`, `siteManagerId` posé | ✅ (workflow-complet P4) |
| V-P04 | OPR + e-mail d'un compte non responsable / inconnu / soi-même | 409/404 avec message explicite, mission non créée | ✅ (client-publication) |
| V-P05 | OPR sans responsable | Publiée ; désignation possible plus tard (mission, puis contrat) | ✅ (client-publication) |
| V-P06 | Génération du contrat | Mode et responsable recopiés ; Article 4 décrit la vérification OPR | ✅ (P4, contract-clauses) |
| V-P07 | Désigner un responsable en mode « Moi-même » | 409 `validation_mode_client` | ✅ (client-publication) |
| V-P08 | Fiche mission (prestataire avant candidature) | Ligne « Vérification : … » | 🖐 |
| V-P09 | OPR sans responsable : financer le séquestre (contrat entier ou jalon) | 409 `site_manager_required` + message ; séquestre auto à la signature non déclenché, notification explicite | ✅ (site-manager, opr-jalons) / 🖐 |
| V-P10 | Carte « Responsable chantier » (page séquestre, espace de validation client) | Désigner / Remplacer / Retirer ; alerte si absent ; invisible en « Moi-même » | 🖐 |
| V-P11 | Remplacement après signature | Entrée `site_manager_replaced` au journal du contrat ; prestataire, entrant et sortant notifiés | ✅ (opr-jalons) |
| V-P12 | Redésigner la même personne | Aucune entrée de journal, aucune notification | ✅ |
| V-P13 | Recharge du séquestre sans responsable (chantier en cours) | Autorisée — seule la mise sous séquestre initiale l'exige | ✅ (client-releves) |

### 6.2 Relevés de présence (contrat au temps)

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| V-R01 | OPR, aucun responsable : le client tente de valider | `verification_required` ; alerte « Aucun responsable désigné » | ✅ (site-manager) / 🖐 |
| V-R02 | Le responsable vérifie | Statut `verified`, **aucun** paiement | ✅ |
| V-R03 | Le responsable tente de valider définitivement | `verification_only` | ✅ |
| V-R04 | Le client valide un relevé vérifié | Quantité **vérifiée** payée (saisie ignorée) | ✅ |
| V-R05 | Le client tente de vérifier | `site_manager_only` | ✅ |
| V-R06 | Responsable refuse un relevé soumis ; client refuse un relevé vérifié | Refus enregistrés ; client ne refuse pas un relevé non vérifié | ✅ |
| V-R07 | Mode de pointage « totale » côté responsable | Quantité figée à la déclaration | 🖐 / ❌ |
| V-R08 | Client conteste une part d'un relevé vérifié | Part reconnue payée, reste gelé (base = quantité vérifiée) | ✅ (P4) |
| V-R09 | Révocation du responsable | Pouvoir retiré immédiatement ; validations passées conservées | ✅ |
| V-R10 | Clôture avec un relevé `verified` en attente | 409 `attendance_pending` | ✅ (client-releves) |

### 6.3 Jalons et tâches

| ID | Scénario | Résultat attendu | Auto |
|---|---|---|---|
| V-J01 | Responsable désigné ouvre la mission | Espace « Vérification OPR » ; preuves visibles et téléchargeables | ✅ (API) / 🖐 |
| V-J02 | Responsable non désigné | 404 sur preuves et vue | ✅ |
| V-J03 | Client tente d'apprécier une preuve / constater l'avancement | `site_manager_only` | ✅ |
| V-J04 | Client tente de valider avant transmission | `verification_required` | ✅ |
| V-J05 | Responsable transmet sans 100 % ou preuves non validées | `progress_incomplete` / preuves en attente | ✅ |
| V-J06 | Responsable transmet avec observations | `verifiedAt`, note visible côté client, aucun versement | ✅ |
| V-J07 | Responsable tente de libérer | 403 `verification_only` | ✅ |
| V-J08 | Rejet (client ou responsable) puis nouvelle soumission | Vérification effacée, à refaire | ✅ |
| V-J09 | Client valide après transmission | Libération du montant du jalon ; `clientValidatedById/At` tracés (distincts de la vérification et du PSP) | ✅ |
| V-J10 | J3 progressif en OPR | Client confirme un point d'étape **égal** au taux vérifié, jamais au-delà (`progress_not_verified`) | ✅ (client-opr-avance) |
| V-J11 | Contrat sans jalon (mission entière) | Même parcours via `/deliverable/verification` et `/escrow/release` | ✅ (client-opr-avance) |
| V-J12 | Acceptation tacite en OPR sans transmission | Paiement à J+7 de la soumission (délai inchangé) | ✅ (client-opr-avance) |
| V-J13 | Tableau de bord responsable | « À vérifier » = relevés + jalons/tâches ; liens vers la mission | 🖐 |

---

## 7. Priorités d'automatisation

1. **P-N01 à P-N05** : refus de soumission (sans mode, mode inconnu, indisponible, au temps, J4 à 1 ligne).
2. **C-K01 / C-E01** : devis QUOTE **F2** → contrat sans jalon → 1 HOLD / 1 RELEASE (seul parcours nouveau sans test).
3. **P-R02 / P-R03 / C-N02** : héritage puis changement du modèle entre deux rounds.
4. **C-K09 / C-K10** : `termsSnapshot` = mode du devis, et repli legacy.
5. **C-P06 / C-P07 / C-K12** : la publication et le PATCH n'imposent plus fixe/jalons.
6. Parcours **QUOTE** J3, J4 et S1 (C-E03 à C-E05), aujourd'hui couverts seulement en mission FIXED.
7. **Au temps** : T-C07 à T-C09 (publication), T-P05 à T-P08 (candidature), T-M01 à T-M04 (PATCH),
   puis T-V10 (arrondi du dernier relevé) et T-V14 (heures supplémentaires).
8. **Mode de pointage** : T-C18, T-C19, T-V29, texte de l'Article 4 en « totale » (T-V31), T-V34, T-V35.
9. **Vérification OPR** : V-P04, V-P05, V-P07, V-R10, V-J10 (point d'étape progressif), V-J11 (contrat
   sans jalon), V-J12 (acceptation tacite sans transmission).
