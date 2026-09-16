import { z } from "zod";
import { isFinancingModeKey } from "@/lib/financing-modes";

// Phase 1 (US-101/US-102) : inscription, téléphone unique vérifié par SMS, rôle choisi à
// l'inscription. `role` ne conditionne aucune vérification de la plateforme — uniquement
// l'affichage et le domaine des missions proposées (modele-skillafrica-v3-Flexwork.md §12).
export const signupSchema = z.object({
  email: z.string().email(),
  tel: z.string().min(8).max(20),
  // Auth reste 100% OTP (src/auth.ts) — ce mot de passe n'est PAS utilisé pour se
  // connecter, mais il est haché et stocké (users.passwordHash) car le formulaire le
  // promet explicitement ("hachage bcrypt/Argon2"). Ne pas le laisser silencieusement
  // disparaître comme avant : soit on l'accepte et le stocke réellement, soit on retire
  // le champ du formulaire — tant qu'il est affiché, il doit être honoré.
  password: z.string().min(12).optional(),
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
export const profileSchema = z.object({
  mainDomain: z.string().min(2),
  subSpecialty: z.string().optional(),
  secondaryDomain: z.string().optional(),
  sector: z.string().optional(),
  indicativeRate: z.number().positive().optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  // Profil enrichi 2026-08-06
  description: z.string().max(2000).optional(),
  // Photos téléversées (relPaths "portfolio/...") OU URLs externes — on accepte les deux,
  // une URL externe n'est pas requise pour un fichier stocké localement.
  portfolioUrls: z.array(z.string().max(500)).max(10).optional(),
  cvUrl: z.string().max(500).optional(),
  tarifUnite: z.enum(["heure", "jour", "semaine", "mois", "mission"]).optional(),
  zonePays: z.string().length(2).optional(),
  zoneVille: z.string().max(100).optional(),
  zoneRayonKm: z.number().int().positive().max(500).optional(),
});

// Phase 3 (US-305) : niveau et expérience auto-déclarés, aucun calcul serveur.
export const declaredLevelSchema = z.object({
  declaredLevel: z.enum(["debutant", "intermediaire", "senior", "expert"]),
  declaredExperienceYears: z.number().int().min(0).optional(),
});

// Phase 3 (US-301/302) : déclaration professionnelle (qualification ou assurance).
export const declarationSchema = z.object({
  declarationType: z.enum(["insurance", "qualification"]),
  label: z.string().optional(),
  insurerName: z.string().optional(),
  policyNumber: z.string().optional(),
  coverageCeiling: z.number().positive().optional(),
  validUntil: z.string().date().optional(),
});

// Phase 4 (US-401) : publication d'une mission. `risk_level`/`insurance_required` sont
// dérivés côté serveur depuis `domain_risk_levels`, jamais saisis par le client.
// `budget` optionnel : un brouillon peut être enregistré sans montant fixé, mais la
// publication (route POST /api/missions) l'exige explicitement à ce moment-là.
// `status` optionnel : "brouillon" ne conditionne aucune vérification de la plateforme
// (modele-skillafrica-v3-Flexwork.md §9 — le KYC ne conditionne QUE la publication), seul
// "publiee" (valeur par défaut si omis, pour compat) déclenche le garde KYC.
// `mode` : distance | presentiel | hybride — détermine les exigences de candidature
// (KYC + garant pour présentiel/hybride, cf.流程图 candidature).
export const missionSchema = z.object({
  titre: z.string().min(3),
  description: z.string().min(10),
  domaine: z.string().min(2),
  mode: z.enum(["distance", "presentiel", "hybride"]).optional(),
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
  budget: z.number().int().positive().optional(),
  // Contrat au temps (modes S2, 2026-09-15) : tarif indicatif par unité (entier, XOF) et quantité
  // maximale. Le budget publié en est DÉRIVÉ côté serveur — il n'est pas saisi deux fois.
  timeRate: z.number().int().positive().optional(),
  timeMaxQuantity: z.number().positive().max(100_000).optional(),
  currency: z.string().min(3).max(3).optional(),
  delaiJours: z.number().int().positive(),
  // Mode devis (budgetType = "QUOTE") : rounds de négociation et date limite de devis.
  maxRevisionRounds: z.number().int().min(1).max(20).optional(),
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
});

// Offre formelle envoyée par le client à un candidat à partir d'une proposition existante
// (model Offer, prisma/schema.prisma) — POST /api/missions/[id]/proposals/[proposalId]/offer.
export const offerMilestoneSchema = z.object({
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
export const devisLineItemSchema = z.object({
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
