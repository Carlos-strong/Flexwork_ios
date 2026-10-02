import { z } from "zod";
import { isFinancingModeKey } from "@/lib/financing-modes";
import { CURRENCY_VALUES } from "@/lib/currencies";
import {
  MISSION_CAHIER_MAX,
  MISSION_DELAI_MAX,
  MISSION_DELAI_MIN,
  MISSION_DESCRIPTION_MAX,
  MISSION_DESCRIPTION_SAISIE_MIN,
  MISSION_MAX_CANDIDATURES_MAX,
  MISSION_MAX_REVISION_ROUNDS_MAX,
  MISSION_MONTANT_MAX,
  MISSION_TIME_QUANTITY_MAX,
  MISSION_TITRE_MAX,
  MISSION_TITRE_SAISIE_MIN,
} from "@/lib/mission-limits";
import {
  AVAILABILITY_VALUES,
  DEPLACEMENT_VALUES,
  MAX_COMPETENCES,
  MAX_COVERAGE_ZONES,
  MODE_CONTACT_VALUES,
  PROVIDER_KIND_VALUES,
  TARIF_UNITE_VALUES,
  WORK_MODE_VALUES,
} from "@/lib/provider-options";

// Phase 1 (US-101/US-102) : inscription, téléphone unique vérifié par SMS, rôle choisi à
// l'inscription. `role` ne conditionne aucune vérification de la plateforme — uniquement
// l'affichage et le domaine des missions proposées (modele-skillafrica-v3-Flexwork.md §12).
export const signupSchema = z.object({
  email: z.string().email(),
  tel: z.string().min(8).max(20),
  // Plus de mot de passe (2026-09-23). L'alternative posée ici — « soit on l'accepte et le
  // stocke réellement, soit on retire le champ du formulaire » — est tranchée dans le second
  // sens : l'auth est 100 % OTP (src/auth.ts, provider unique `otp`), le champ ne servait à
  // rien. La colonne users.passwordHash reste en base, nullable et inutilisée, pour ne
  // détruire aucune donnée existante et garder la porte ouverte si un provider mot de passe
  // est branché plus tard.
  //
  // Le consentement est en revanche exigé ET horodaté (users.cgvAcceptedAt) : il était
  // envoyé par le formulaire puis silencieusement jeté ici, exactement comme le mot de passe.
  cgvAccepted: z.literal(true),
  firstname: z.string().min(1).optional(),
  lastname: z.string().min(1).optional(),
  // `responsable_chantier` (2026-09-14) : ni client ni prestataire — un délégataire que le
  // client désigne sur un contrat au temps. L'inscription lui est ouverte parce qu'il lui faut
  // un compte pour être désigné ; le rôle seul ne lui donne aucun droit.
  role: z
    .enum([
      "client",
      "expert_digital",
      "expert_btp_autres",
      "artisan",
      "manoeuvre",
      "responsable_chantier",
    ])
    .optional(),
  country: z.string().min(2).optional(),
  city: z.string().min(1).optional(),
  locality: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  deviceFingerprint: z.string().min(1).optional(),
});

// Phase 1 (US-102) : profil générique, quel que soit le rôle choisi. Aucune vérification
// de la plateforme n'est conditionnée par ce profil — uniquement déclaratif (Phase 3).
//
// Enrichi le 2026-09-23 pour porter les 5 onglets du formulaire prestataire. IMPORTANT : tous
// les champs sont facultatifs et l'écran enregistre ONGLET PAR ONGLET. La route fait un
// `update({ data: parsed.data })` : les clés absentes du payload ne sont PAS touchées (Prisma
// ignore `undefined`), donc sauvegarder l'onglet « Localisation » n'efface pas la biographie
// de l'onglet « Présentation ». C'est ce qui rend la sauvegarde séparée possible sans
// réécrire la route.
export const profileSchema = z.object({
  // Facultatif DEPUIS 2026-09-23, et la route l'exige elle-même à la CRÉATION : le formulaire
  // prestataire enregistre ONGLET PAR ONGLET, et saisir sa biographie ne doit pas obliger à
  // renvoyer son métier. En base la colonne reste non nulle — c'est la route qui tranche, la
  // seule à savoir s'il existe déjà un profil à mettre à jour.
  mainDomain: z.string().min(2).optional(),
  // Métier du catalogue (2026-09-23). `mainDomain` ne porte qu'un LIBELLÉ, ce qui suffit au
  // rapprochement mais ne dit pas de quelle catégorie il vient : la cascade du formulaire se
  // rouvrait donc vide. La clé étrangère le dit, et devient la source du libellé — voir
  // POST /api/profile, qui l'ignore au profit de celui du catalogue.
  metierId: z.string().min(1).optional(),
  // `subSpecialty` et `offeredServices` ont été retirés (2026-09-23) : le premier redisait le
  // métier en texte libre, le second créait une seconde liste de compétences sous un autre
  // nom. Une seule liste désormais, `tags`. Les colonnes restent en base, inutilisées.
  secondaryDomain: z.string().optional(),
  sector: z.string().optional(),
  indicativeRate: z.number().positive().optional(),
  // La limite était de 20 alors que la cascade n'en propose que 5 et que le formulaire en
  // annonce 10 : trois chiffres différents pour une seule règle. Une seule source désormais
  // (src/lib/provider-options.ts), partagée avec l'écran.
  tags: z.array(z.string().min(1)).max(MAX_COMPETENCES).optional(),
  // Profil enrichi 2026-08-06
  description: z.string().max(2000).optional(),
  // Photos téléversées (relPaths "portfolio/...") OU URLs externes — on accepte les deux,
  // une URL externe n'est pas requise pour un fichier stocké localement.
  portfolioUrls: z.array(z.string().max(500)).max(10).optional(),
  cvUrl: z.string().max(500).optional(),
  tarifUnite: z.enum(TARIF_UNITE_VALUES).optional(),
  zonePays: z.string().length(2).optional(),
  zoneVille: z.string().max(100).optional(),
  zoneRayonKm: z.number().int().positive().max(500).optional(),
  // ── Onglet 1 — Présentation ─────────────────────────────────────────────────────────
  // `title` est l'accroche affichée sur les cartes, distincte de `mainDomain` qui porte le
  // métier du catalogue : le premier se lit par un client, le second sert au rapprochement.
  title: z.string().max(120).optional(),
  providerKind: z.enum(PROVIDER_KIND_VALUES).optional(),
  // ── Onglet 4 — Localisation ─────────────────────────────────────────────────────────
  workModes: z.array(z.enum(WORK_MODE_VALUES)).max(3).optional(),
  // ── Champs du formulaire prestataire (2026-09-23) ────────────────────────────────────
  // `overview` est le développement long, distinct de `description` (bio courte des cartes).
  // Plafonné à 5 000 comme `cahierDesCharges` : au-delà, ce n'est plus un texte de profil.
  overview: z.string().max(5000).optional(),
  quartier: z.string().max(120).optional(),
  deplacement: z.array(z.enum(DEPLACEMENT_VALUES)).max(3).optional(),
  modeContact: z.enum(MODE_CONTACT_VALUES).optional(),
  coverageZones: z.array(z.string().min(1).max(100)).max(MAX_COVERAGE_ZONES).optional(),
  availability: z.enum(AVAILABILITY_VALUES).optional(),
  // ── Onglet 5 — Configuration ────────────────────────────────────────────────────────
  currency: z.enum(CURRENCY_VALUES).optional(),
});

// Profil client (2026-09-23) — pendant de `profileSchema` côté client. Le formulaire porte
// aussi l'adresse et la localisation, qui vivent sur User et non sur ClientProfile : elles
// servent aux deux rôles, la route les écrit donc sur User dans la même transaction.
export const clientProfileSchema = z.object({
  profession: z.string().max(120).optional(),
  clientType: z.enum(["particulier", "entreprise", "association", "administration"]).optional(),
  company: z.string().max(200).optional(),
  sector: z.string().max(120).optional(),
  languages: z.array(z.string().min(1).max(60)).max(10).optional(),
  // Zone couverte par la plateforme : XOF (BJ, TG, SN, CI, BF, NE) et NGN (NG). EUR/USD
  // restent acceptées pour un donneur d'ordre qui facture hors zone.
  currency: z.enum(["XOF", "NGN", "EUR", "USD"]).optional(),
  // Champs User — édités depuis le même formulaire.
  country: z.string().min(2).max(2).optional(),
  city: z.string().min(1).max(100).optional(),
  locality: z.string().max(100).optional(),
  address: z.string().max(300).optional(),
});

// Phase 3 (US-305) : niveau et expérience auto-déclarés, aucun calcul serveur.
export const declaredLevelSchema = z.object({
  declaredLevel: z.enum(["debutant", "intermediaire", "senior", "expert"]),
  declaredExperienceYears: z.number().int().min(0).optional(),
});

// Phase 3 (US-301/302) : déclaration professionnelle (qualification ou assurance).
// Diplôme déclaré — ces champs étaient envoyés par /declarations et SUPPRIMÉS par zod faute
// d'être déclarés ici, pendant que l'écran annonçait « Qualifications enregistrées ».
export const declaredDiplomaSchema = z.object({
  qualificationName: z.string().min(1).max(200),
  year: z.number().int().min(1950).max(2100).optional(),
  location: z.string().max(200).optional(),
  institution: z.string().max(200).optional(),
  specialty: z.string().max(200).optional(),
  isStateIssued: z.boolean().optional(),
});

// Personne ressource attestant d'une expérience. `experienceId` est l'indice CLIENT de
// l'expérience concernée (les identifiants réels n'existent pas encore au moment de l'envoi) :
// la route le résout en clé étrangère après création.
export const declaredReferenceSchema = z.object({
  experienceId: z.number().int().optional(),
  kind: z.enum(["primary", "secondary", "cross"]).optional(),
  nom: z.string().min(1).max(120),
  prenom: z.string().max(120).optional(),
  tel: z.string().max(30).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  lien: z.string().max(200).optional(),
});

// Expérience professionnelle. Dates au format « AAAA-MM » (<input type="month">) : les
// convertir en date complète inventerait un jour qui n'a pas été saisi.
export const declaredExperienceSchema = z.object({
  id: z.number().int().optional(),
  clientType: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
  clientName: z.string().max(200).optional(),
  role: z.string().min(1).max(200),
  domain: z.string().max(200).optional(),
  description: z.string().max(3000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("")),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("")),
  technologies: z.string().max(500).optional(),
  projectUrl: z.string().max(500).optional(),
  livrables: z.string().max(1000).optional(),
});

export const declarationSchema = z.object({
  // `experience` ajouté (2026-09-23) : le formulaire le postait déjà, l'enum l'ignorait, et
  // chaque envoi repartait en 400.
  declarationType: z.enum(["insurance", "qualification", "experience"]),
  label: z.string().optional(),
  insurerName: z.string().optional(),
  policyNumber: z.string().optional(),
  coverageCeiling: z.number().positive().optional(),
  validUntil: z.string().date().optional(),
  // Détail effectivement persisté par la route, chacun dans sa table.
  diplomes: z.array(declaredDiplomaSchema).max(20).optional(),
  experiences: z.array(declaredExperienceSchema).max(20).optional(),
  references: z.array(declaredReferenceSchema).max(60).optional(),
});

// Phase 4 (US-401) : publication d'une mission. `risk_level`/`insurance_required` sont
// dérivés côté serveur depuis le MÉTIER choisi (`Metier.riskLevel`, 2026-09-24), jamais
// saisis par le client. Ils venaient de `domain_risk_levels`, table abandonnée parce qu'elle
// indexait le risque sur un libellé libre qui ne correspondait à presque aucun métier réel.
// `budget` optionnel : un brouillon peut être enregistré sans montant fixé, mais la
// publication (route POST /api/missions) l'exige explicitement à ce moment-là.
// `status` optionnel : "brouillon" ne conditionne aucune vérification de la plateforme
// (modele-skillafrica-v3-Flexwork.md §9 — le KYC ne conditionne QUE la publication), seul
// "publiee" (valeur par défaut si omis, pour compat) déclenche le garde KYC.
// `mode` : distance | presentiel | hybride — détermine les exigences de candidature
// (KYC + garant pour présentiel/hybride, cf.流程图 candidature).
export const missionSchema = z.object({
  // Bornes HAUTES (2026-09-23) : le `maxLength` du formulaire n'engage que le navigateur — un
  // POST direct pouvait stocker un titre ou une description de taille arbitraire. Bornes
  // BASSES : ce schéma valide aussi les BROUILLONS, inachevés par nature. La barre de
  // publication (10 et 50 caractères) est vérifiée par la route, seule à connaître `status`.
  titre: z.string().min(MISSION_TITRE_SAISIE_MIN).max(MISSION_TITRE_MAX),
  description: z.string().min(MISSION_DESCRIPTION_SAISIE_MIN).max(MISSION_DESCRIPTION_MAX),
  // Optionnel depuis la cascade (2026-09-23) : quand `metierId` est fourni, la route DÉRIVE
  // ce champ du libellé du métier — la FK fait foi, ce texte n'est que sa projection pour
  // `domain-match`. Il reste accepté, et exigé par la route, pour les appels qui ne passent
  // pas par la taxonomie (brouillons antérieurs, intégrations). L'exigence vit donc côté
  // route, seule à savoir si un métier a été choisi.
  domaine: z.string().min(2).optional(),
  // Taxonomie (2026-09-23) — la cohérence catégorie ⊃ métier est vérifiée côté route, qui
  // seule peut interroger la base.
  categorieId: z.string().min(1).optional(),
  metierId: z.string().min(1).optional(),
  mode: z.enum(["distance", "presentiel", "hybride"]).optional(),
  // Cadrage (2026-09-23).
  dateDebut: z.coerce.date().optional(),
  pays: z.string().length(2).optional(),
  ville: z.string().max(100).optional(),
  quartier: z.string().max(120).optional(),
  urgent: z.boolean().optional(),
  materiel: z.enum(["client", "prestataire", "mixte"]).optional(),
  cahierDesCharges: z.string().max(MISSION_CAHIER_MAX).optional(),
  // Fourchette indicative du mode devis. La cohérence min ≤ max est vérifiée côté route.
  // Le plafond n'est pas décoratif : ces deux colonnes sont des INTEGER Postgres, et une
  // valeur au-delà de 2 147 483 647 faisait lever Prisma — un 500 au lieu d'un 400.
  budgetMin: z.number().int().positive().max(MISSION_MONTANT_MAX).optional(),
  budgetMax: z.number().int().positive().max(MISSION_MONTANT_MAX).optional(),
  // `null` = illimité, et c'est la valeur par défaut d'une mission qui n'en dit rien.
  maxCandidatures: z.number().int().min(1).max(MISSION_MAX_CANDIDATURES_MAX).nullable().optional(),
  // Brouillon de pièces jointes déposé avant la création (POST /api/missions/attachments/draft).
  // La route convertit les fichiers de CE brouillon, et seulement ceux de l'appelant.
  draftId: z.string().min(1).max(64).optional(),
  // Quick win 2026-08-06 : champs du formulaire /missions/new jusqu'ici jetés silencieusement.
  professionalType: z.enum(["EXPERT_DIGITAL", "EXPERT_BTP", "ARTISAN", "MANOEUVRE"]).optional(),
  level: z.enum(["Débutant", "Junior", "Intermédiaire", "Senior", "Expert"]).optional(),
  budgetType: z.enum(["FIXED", "RATE", "QUOTE"]).optional(),
  // Mode de financement choisi à la publication (2026-09-10) — la clé doit exister au
  // catalogue ; sa DISPONIBILITÉ (un mode décrit mais pas encore implémenté, ex. F4) est
  // vérifiée côté route, qui seule sait si la mission est publiée ou encore en brouillon.
  financingModeKey: z.string().refine(isFinancingModeKey, "mode_de_financement_inconnu").optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  // Entier, même raison que `proposalSchema.montant` : un budget publié sert de prix de contrat
  // quand aucun devis ne le remplace. Le formulaire impose déjà `step={500}`.
  budget: z.number().int().positive().max(MISSION_MONTANT_MAX).optional(),
  // Contrat au temps (modes S2, 2026-09-15) : tarif indicatif par unité (entier, XOF) et quantité
  // maximale. Le budget publié en est DÉRIVÉ côté serveur — il n'est pas saisi deux fois.
  timeRate: z.number().int().positive().max(MISSION_MONTANT_MAX).optional(),
  timeMaxQuantity: z.number().positive().max(MISSION_TIME_QUANTITY_MAX).optional(),
  // Mode de pointage d'une mission au temps (2026-10-01) : validation des relevés en totalité
  // seulement, ou partielle autorisée. Ignoré hors S2 ; « partielle » si absent.
  attendanceValidation: z.enum(["totale", "partielle"]).optional(),
  // Vérification / validation (2026-10-01) : « Moi-même » (client) ou « OPR / responsable
  // chantier » (opr). Défaut « client ». Le responsable peut être désigné dès la publication par
  // son e-mail ou téléphone (compte « responsable de chantier » existant), ou plus tard.
  validationMode: z.enum(["client", "opr"]).optional(),
  siteManagerIdentifier: z.string().trim().max(120).optional(),
  // Liste FERMÉE (2026-09-23). C'était `z.string().min(3).max(3)`, donc n'importe quel code à
  // trois lettres entrait — et `Mission.currency` est une colonne `String`, sans contrainte
  // pour le rattraper. Les deux autres schémas monétaires (profil client, profil prestataire)
  // étaient déjà en `z.enum(CURRENCY_VALUES)` : celui-ci était le dernier à ne pas l'être.
  currency: z.enum(CURRENCY_VALUES).optional(),
  // Borne haute indispensable : `delaiJours` est un INTEGER Postgres. Une valeur hors plage
  // passait Zod puis faisait échouer l'insertion en 500.
  delaiJours: z.number().int().min(MISSION_DELAI_MIN).max(MISSION_DELAI_MAX),
  // Mode devis (budgetType = "QUOTE") : rounds de négociation et date limite de devis.
  maxRevisionRounds: z.number().int().min(1).max(MISSION_MAX_REVISION_ROUNDS_MAX).optional(),
  dateExpiration: z.coerce.date().optional(),
  status: z.enum(["brouillon", "publiee"]).optional(),
});

// Phase 4 : proposition d'un prestataire sur une mission (remplace l'ancien devis).
// `montant` autorise 0 : en mode devis (budgetType = "QUOTE"), le prestataire postule sans
// montant — le prix viendra du devis soumis via POST /api/missions/[id]/devis.
export const proposalSchema = z.object({
  // Entier (2026-09-14) : ce montant devient TEL QUEL le prix du contrat, sans étape de calcul
  // qui pourrait l'arrondir — contrairement au devis, dont `computeDevisData` arrondit le TTC.
  // Le XOF n'a pas de sous-unité en circulation et le PSP Mobile Money refuse une instruction
  // décimale : un prix fixe à 1 234,56 produisait un séquestre puis des libérations impossibles
  // à exécuter. Refusé plutôt qu'arrondi en silence — c'est le prix sur lequel les deux parties
  // s'engagent, il ne doit pas changer entre la saisie et le contrat.
  montant: z.number().int().nonnegative(),
  // Contre-proposition : délai (en jours) que le prestataire s'engage à tenir. Optionnel —
  // s'il est absent, le délai du contrat retombe sur celui de la mission (delaiJours).
  delaiPropose: z.number().int().positive().optional(),
  message: z.string().optional(),
  // Mission au temps (S2) : tarif par unité. Quand il est fourni, `montant` est recalculé côté
  // serveur (tarif × quantité maximale) — le prestataire chiffre un tarif, pas un plafond.
  unitRate: z.number().int().positive().optional(),
  // Modèle de paiement proposé (fixe ou par jalons, 2026-10-01) — c'est la candidature, pas la
  // publication, qui le fixe. Exigé à la première soumission hors mission au temps ; une
  // révision qui l'omet garde celui du round précédent (voir POST .../proposals).
  financingModeKey: z.string().refine(isFinancingModeKey, "mode_de_financement_inconnu").optional(),
});

// Offre formelle envoyée par le client à un candidat à partir d'une proposition existante
// (model Offer, prisma/schema.prisma) — POST /api/missions/[id]/proposals/[proposalId]/offer.
const offerMilestoneSchema = z.object({
  ordre: z.number().int().nonnegative(),
  description: z.string().min(1),
  unite: z.string().optional(),
  montant: z.number().int().nonnegative(),
});

export const offerSchema = z.object({
  titre: z.string().min(3),
  description: z.string().min(10),
  // Entier, même raison que `proposalSchema.montant` ci-dessus.
  montant: z.number().int().positive(),
  milestones: z.array(offerMilestoneSchema).optional(),
});

// Phase 4 — mode devis BTP (budgetType = "QUOTE") : jalons détaillés d'un devis.
// Montants dans la devise de la mission (Float, jamais de centimes).
const devisLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  // Échéance indicative du jalon — texte libre, purement informatif (voir DevisLineItemInput,
  // src/lib/devis.ts).
  echeance: z.string().optional(),
});

export const devisSchema = z.object({
  lineItems: z.array(devisLineItemSchema).min(1),
  delay: z.string().min(1),
  notes: z.string().optional(),
  // La TVA est appliquée au devis (choix du prestataire), pas à la mission.
  tvaRate: z.number().min(0).max(100).default(0),
  // Rubrique Main d'œuvre — forfait distinct des jalons, additionné avant TVA (voir
  // computeDevisData dans src/lib/devis.ts).
  laborCost: z.number().nonnegative().default(0),
  // Modèle de paiement du devis (2026-10-01) : F2 (fixe) ou un mode à jalons. Optionnel au
  // schéma pour qu'une révision puisse reprendre celui du round précédent ; la route exige
  // qu'il soit connu d'une façon ou d'une autre (voir POST /api/missions/[id]/devis).
  financingModeKey: z.string().refine(isFinancingModeKey, "mode_de_financement_inconnu").optional(),
});

export const garantSchema = z.object({
  nom: z.string().min(2),
  tel: z.string().min(8).max(20),
  obligatoire: z.boolean().optional(),
});

// Modification d'un garant existant (PATCH /api/profile/garants/[id]) — les deux champs
// restent optionnels (on peut ne corriger que le nom, ou que le téléphone), mais au moins
// l'un des deux doit être fourni.
export const garantUpdateSchema = z
  .object({
    nom: z.string().min(2).optional(),
    tel: z.string().min(8).max(20).optional(),
  })
  .refine((data) => data.nom !== undefined || data.tel !== undefined, {
    message: "at_least_one_field_required",
  });

// A12 — activation du pointage : le caller ne peut activer que SON propre côté (client
// ou prestataire) ; les deux consentements sont indépendants et sans conséquence l'un sur
// l'autre s'ils diffèrent (etat-consolide-Flexwork.md §2, A12, condition n°1).
export const checkInOptInSchema = z.object({
  optIn: z.boolean(),
});

// A12 — évènement de pointage : horodatage ponctuel arrivée/départ uniquement, jamais de
// suivi continu (condition impérative n°2).
export const checkInEventSchema = z.object({
  type: z.enum(["arrivee", "depart"]),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
});
