import { z } from "zod";

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
  role: z.enum(["client", "expert_digital", "expert_btp_autres", "artisan", "manoeuvre"]).optional(),
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
  portfolioUrls: z.array(z.string().url()).max(10).optional(),
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
  tags: z.array(z.string().min(1)).max(20).optional(),
  budget: z.number().positive().optional(),
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
  montant: z.number().nonnegative(),
  message: z.string().optional(),
});

// Phase 4 — mode devis BTP (budgetType = "QUOTE") : postes détaillés d'un devis.
// Montants dans la devise de la mission (Float, jamais de centimes).
export const devisLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitPrice: z.number().nonnegative(),
});

export const devisSchema = z.object({
  lineItems: z.array(devisLineItemSchema).min(1),
  delay: z.string().min(1),
  notes: z.string().optional(),
  // La TVA est appliquée au devis (choix du prestataire), pas à la mission.
  tvaRate: z.number().min(0).max(100).default(0),
});

export const garantSchema = z.object({
  nom: z.string().min(2),
  tel: z.string().min(8).max(20),
  obligatoire: z.boolean().optional(),
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
