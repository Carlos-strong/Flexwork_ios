import { PrismaClient } from "@prisma/client";

// Catalogue de départ de la taxonomie (2026-09-23) : 23 domaines, 220 spécialités,
// 1 306 compétences. Les trois niveaux du catalogue métier se posent tels quels sur les trois
// modèles repris de `flexwork_job` :
//
//     Domaine → Catégorie     Spécialité → Métier     Compétence → Service
//
// Lancé seul (`npm run db:seed-catalog`), il RESTAURE le catalogue : tout est effacé puis
// recréé, comme dans flexwork_job. Appelé depuis prisma/seed.ts, il ne s'exécute que sur une
// taxonomie vide, pour ne jamais écraser un catalogue édité depuis le Back Office.

// Une spécialité liste ses compétences de deux façons. Le plus souvent à plat, quand la
// spécialité n'a pas de découpage interne. Sinon par prestation — « Enseignant » couvre
// l'enseignement primaire et le secondaire, chacun avec ses compétences propres : la feuille
// reste la compétence, comme partout ailleurs, et la prestation devient sa description. C'est
// le quatrième niveau des taxonomies importées, rabattu sur les trois modèles existants.
type Specialite = string[] | Record<string, string[]>;

// Ordre d'affichage = ordre de déclaration ; l'icône est l'emoji de la barre de catégories.
const ICONES: Record<string, string> = {
  "Digital et Informatique": "💻",
  "BTP et Construction": "🏗️",
  "Industrie et Production": "🏭",
  "Mécanique et Automobile": "🔧",
  "Enseignement et Formation": "🎓",
  "Santé et Bien-être": "🩺",
  "Assistance sociale et Services à la personne": "🤝",
  Artisanat: "🪵",
  "Manœuvre et Main-d'œuvre": "💪",
  "Énergie et Électricité": "⚡",
  "Transport et Logistique": "🚚",
  "Administration et Gestion": "📊",
  "Communication et Marketing": "📣",
  "Entretien et Nettoyage": "🧹",
  "Agriculture et Élevage": "🌾",
  "Hôtellerie, Restauration et Tourisme": "🍽️",
  "Droit et Conseil professionnel": "⚖️",
  "Sécurité et Prévention": "🛡️",
  "Beauté et Soins esthétiques": "💇",
  "Sciences et Expertise technique": "🔬",
  "Éducation": "📚",
  "Assistance sociale": "🤲",
  "Services à la personne": "🏠",
};

// Seuls les domaines importés avec une description en portent une ; les autres s'en passent,
// leur libellé se suffisant.
const DESCRIPTIONS: Record<string, string> = {
  "Éducation": "Métiers et services liés à l'enseignement et à la formation.",
  "Assistance sociale": "Métiers et services d'accompagnement social et de soutien aux personnes vulnérables.",
  "Services à la personne": "Services de proximité, aide à domicile et assistance dans la vie quotidienne.",
};

const CATALOGUE: Record<string, Record<string, Specialite>> = {
  "Digital et Informatique": {
    "Développement web": ["HTML/CSS", "JavaScript", "PHP/Laravel", "Python/Django", "API REST", "Tests automatisés"],
    "Développement mobile": ["Android", "iOS", "Flutter", "React Native", "Publication d’applications", "Notifications push"],
    "Réseaux et systèmes": ["Configuration TCP/IP", "Routage", "VLAN", "VPN", "Administration Linux", "Administration Windows"],
    "Cybersécurité": ["Audit de sécurité", "Gestion des accès", "Durcissement système", "Détection d’incidents", "Sauvegardes sécurisées", "Sensibilisation utilisateurs"],
    "Data et intelligence artificielle": ["Nettoyage de données", "SQL", "Tableaux de bord", "Machine learning", "Automatisation IA", "Évaluation de modèles"],
    "Design et UX/UI": ["Wireframes", "Prototypage", "Figma", "Design system", "Tests utilisateurs", "Accessibilité numérique"],
    "Support informatique": ["Diagnostic matériel", "Installation logiciels", "Maintenance postes", "Assistance utilisateurs", "Inventaire informatique", "Récupération de données"],
    "Cloud et DevOps": ["Docker", "CI/CD", "Déploiement cloud", "Infrastructure as Code", "Monitoring", "Gestion des logs"],
    "Marketing digital": ["SEO", "SEA", "Email marketing", "Analytics", "Stratégie réseaux sociaux", "Conversion landing page"],
    "Production multimédia": ["Montage vidéo", "Motion design", "Photographie", "Podcast", "Retouche image", "Streaming"],
  },
  "BTP et Construction": {
    "Maçonnerie": ["Fondations", "Élévation murs", "Dallage", "Enduits", "Coffrage", "Ferraillage"],
    "Électricité bâtiment": ["Câblage", "Tableaux électriques", "Mise à la terre", "Éclairage", "Prises", "Diagnostic pannes"],
    "Plomberie": ["Alimentation eau", "Évacuation eaux usées", "Installation sanitaires", "Recherche fuites", "Pompage", "Chauffe-eau"],
    "Peinture et finition": ["Préparation supports", "Peinture intérieure", "Peinture extérieure", "Enduits décoratifs", "Vernissage", "Étanchéité de finition"],
    "Toiture et charpente": ["Charpente bois", "Charpente métallique", "Pose couverture", "Étanchéité toiture", "Gouttières", "Réparation toiture"],
    "Menuiserie bâtiment": ["Portes", "Fenêtres", "Placards", "Escaliers", "Pose aluminium", "Pose bois"],
    "Climatisation et ventilation": ["Installation climatiseurs", "Entretien climatisation", "Dépannage", "Ventilation", "Dimensionnement", "Mise en service"],
    "Terrassement et VRD": ["Fouilles", "Nivellement", "Caniveaux", "Assainissement", "Pavage", "Voirie"],
    "Architecture et études": ["Plans 2D", "Modélisation 3D", "Métré", "Avant-projet", "Permis", "Suivi architectural"],
    "Gestion de chantier": ["Planning", "Coordination équipes", "Contrôle qualité", "Sécurité chantier", "Réception travaux", "Rapports d’avancement"],
  },
  "Industrie et Production": {
    "Maintenance industrielle": ["Maintenance préventive", "Maintenance corrective", "Diagnostic machines", "Graissage", "Gestion pièces", "GMAO"],
    "Automatisation": ["Automates PLC", "Capteurs", "Actionneurs", "Supervision SCADA", "Variateurs", "Instrumentation"],
    "Fabrication mécanique": ["Usinage", "Tournage", "Fraisage", "Lecture plans", "Tolérances", "Contrôle dimensionnel"],
    "Production": ["Planification production", "Conduite ligne", "Réglage machines", "Gestion rendement", "Traçabilité", "5S"],
    "Contrôle qualité": ["Inspection réception", "Échantillonnage", "Métrologie", "Non-conformités", "Procédures qualité", "Rapports qualité"],
    "Hygiène sécurité environnement": ["Évaluation risques", "EPI", "Prévention incendie", "Gestion déchets", "Plans d’urgence", "Audits HSE"],
    "Agro-industrie": ["Transformation céréales", "Conditionnement", "Contrôle hygiène", "Chaîne du froid", "Traçabilité lots", "Maintenance équipements"],
    "Énergie industrielle": ["Groupes électrogènes", "Tableaux industriels", "Moteurs", "Compensation énergie", "Onduleurs", "Mesures électriques"],
    "Logistique industrielle": ["Flux matières", "Magasin industriel", "Préparation commandes", "Inventaire", "Expédition", "Optimisation stocks"],
    "Ingénierie industrielle": ["Études de process", "Dimensionnement", "Implantation atelier", "Amélioration continue", "Analyse coûts", "Documentation technique"],
  },
  "Mécanique et Automobile": {
    "Mécanique automobile": ["Vidange", "Freinage", "Embrayage", "Distribution", "Suspension", "Diagnostic moteur"],
    "Électricité automobile": ["Batterie", "Alternateur", "Démarreur", "Faisceaux", "Éclairage", "Diagnostic électronique"],
    "Moto": ["Entretien moteur", "Transmission", "Freins", "Carburation/injection", "Pneumatiques", "Électricité moto"],
    "Carrosserie": ["Débosselage", "Redressage", "Préparation peinture", "Peinture carrosserie", "Remplacement éléments", "Polissage"],
    "Engins lourds": ["Hydraulique", "Moteurs diesel", "Transmission", "Freinage pneumatique", "Diagnostic engins", "Maintenance préventive"],
    "Climatisation automobile": ["Recharge gaz", "Recherche fuite", "Compresseur", "Condenseur", "Diagnostic climatisation", "Entretien circuit"],
    "Usinage et soudure mécanique": ["Soudage MIG", "Soudage TIG", "Soudage à l’arc", "Découpe métal", "Fabrication pièces", "Réparation châssis"],
    "Diagnostic électronique": ["Lecture OBD", "Effacement défauts", "Capteurs", "Calculateurs", "Reprogrammation autorisée", "Rapport diagnostic"],
    "Pièces et pneus": ["Montage pneus", "Équilibrage", "Géométrie", "Identification pièces", "Gestion stock pièces", "Conseil compatibilité"],
    "Maintenance équipements": ["Pompes", "Compresseurs", "Groupes électrogènes", "Moteurs électriques", "Réducteurs", "Alignement mécanique"],
  },
  "Enseignement et Formation": {
    "Enseignement général": ["Français", "Mathématiques", "Sciences", "Histoire-géographie", "Anglais", "Préparation examens"],
    "Langues": ["Conversation", "Grammaire", "Prononciation", "Traduction pédagogique", "Préparation TCF/IELTS", "Cours professionnels"],
    "Informatique": ["Bureautique", "Programmation", "Réseaux", "Culture numérique", "Sécurité numérique", "Formation logiciels"],
    "Formation professionnelle": ["Électricité", "Plomberie", "BTP", "Mécanique", "Couture", "Entrepreneuriat"],
    "Formation entreprise": ["Leadership", "Gestion projet", "Communication", "Service client", "Procédures métier", "Évaluation compétences"],
    "Éducation spécialisée": ["Accompagnement scolaire", "Adaptation supports", "Inclusion", "Suivi pédagogique", "Relation parents", "Plan individualisé"],
    "Coaching académique": ["Méthodologie", "Organisation travail", "Orientation", "Préparation oraux", "Recherche documentaire", "Prise de notes"],
    "Formation artistique": ["Musique", "Chant", "Dessin", "Photographie", "Théâtre", "Danse"],
    "Formation en ligne": ["Création modules", "Classes virtuelles", "Quiz", "LMS", "Suivi apprenants", "Évaluation à distance"],
    "Alphabétisation": ["Lecture", "Écriture", "Calcul", "Français fonctionnel", "Compétences de vie", "Accompagnement adultes"],
  },
  "Santé et Bien-être": {
    "Soins infirmiers": ["Soins prescrits", "Surveillance paramètres", "Pansements", "Éducation patient", "Traçabilité", "Hygiène des soins"],
    "Médecine": ["Consultation médicale", "Orientation", "Prévention", "Suivi pathologies", "Interprétation clinique", "Urgences selon habilitation"],
    "Pharmacie": ["Dispensation réglementée", "Conseil usage", "Gestion stocks", "Pharmacovigilance", "Préparation autorisée", "Éducation thérapeutique"],
    "Kinésithérapie": ["Rééducation motrice", "Mobilité", "Renforcement", "Récupération fonctionnelle", "Bilan fonctionnel", "Conseils posturaux"],
    "Psychologie": ["Écoute", "Évaluation psychologique", "Accompagnement", "Psychoéducation", "Orientation", "Suivi confidentiel"],
    "Nutrition": ["Bilan alimentaire", "Conseils nutritionnels", "Plans alimentaires", "Prévention", "Éducation nutritionnelle", "Suivi habitudes"],
    "Laboratoire": ["Prélèvements habilités", "Préparation échantillons", "Analyses", "Contrôle qualité", "Traçabilité", "Gestion déchets biologiques"],
    "Santé communautaire": ["Sensibilisation", "Prévention maladies", "Campagnes santé", "Orientation", "Visites communautaires", "Collecte données"],
    "Bien-être": ["Massage non médical", "Relaxation", "Yoga", "Méditation", "Hygiène de vie", "Gestion du stress"],
    "Assistance médicale": ["Accompagnement rendez-vous", "Aide mobilité", "Organisation soins", "Suivi administratif", "Transport adapté", "Alerte proches"],
  },
  "Assistance sociale et Services à la personne": {
    "Aide à domicile": ["Ménage", "Courses", "Préparation repas", "Accompagnement", "Entretien courant", "Organisation domicile"],
    "Personnes âgées": ["Compagnie", "Aide mobilité", "Accompagnement sorties", "Rappels non médicaux", "Courses", "Coordination famille"],
    "Garde d’enfants": ["Surveillance", "Aide devoirs", "Préparation repas", "Activités éducatives", "Accompagnement école", "Sécurité enfant"],
    "Handicap": ["Aide quotidienne", "Accompagnement mobilité", "Adaptation environnement", "Communication adaptée", "Soutien autonomie", "Orientation services"],
    "Accompagnement social": ["Écoute", "Orientation sociale", "Démarches administratives", "Médiation", "Visites sociales", "Rapports de suivi"],
    "Protection de l’enfance": ["Prévention", "Signalement selon procédure", "Accompagnement famille", "Activités éducatives", "Coordination acteurs", "Suivi situation"],
    "Insertion professionnelle": ["Diagnostic emploi", "CV", "Préparation entretien", "Orientation formation", "Suivi parcours", "Mise en relation"],
    "Économie sociale": ["Animation communautaire", "Coopératives", "Microprojets", "Mobilisation ressources", "Suivi bénéficiaires", "Évaluation impact"],
    "Assistance administrative": ["Formulaires", "Classement", "Prise rendez-vous", "Courriers", "Numérisation", "Suivi dossiers"],
    "Accompagnement de proximité": ["Visites", "Médiation de quartier", "Sensibilisation", "Orientation juridique/sociale", "Appui associations", "Collecte besoins"],
  },
  Artisanat: {
    "Menuiserie": ["Meubles", "Portes", "Fenêtres", "Agencement", "Restauration bois", "Finition"],
    "Couture": ["Prise mesures", "Patronage", "Confection", "Retouches", "Broderie", "Tenues professionnelles"],
    "Soudure": ["MIG", "TIG", "Arc", "Assemblage", "Réparation", "Lecture plans"],
    "Cordonnerie": ["Réparation chaussures", "Semelles", "Couture cuir", "Teinture", "Fabrication", "Entretien cuir"],
    "Bijouterie": ["Montage bijoux", "Soudure fine", "Polissage", "Sertissage", "Réparation", "Création"],
    "Poterie": ["Modelage", "Tournage", "Émaillage", "Cuisson", "Décoration", "Production série"],
    "Vannerie": ["Tressage", "Paniers", "Nattes", "Objets décoratifs", "Sélection matières", "Finition"],
    "Artisanat textile": ["Teinture", "Tissage", "Batik", "Impression textile", "Accessoires", "Contrôle finition"],
    "Fabrication alimentaire": ["Pâtisserie artisanale", "Transformation fruits", "Produits céréaliers", "Conservation", "Hygiène", "Conditionnement"],
    "Réparation artisanale": ["Objets bois", "Objets métal", "Articles ménagers", "Petits équipements", "Diagnostic", "Finition"],
  },
  "Manœuvre et Main-d'œuvre": {
    "Manœuvre chantier": ["Préparation matériaux", "Nettoyage chantier", "Aide maçon", "Manutention", "Creusement", "Rangement"],
    "Manutention": ["Chargement", "Déchargement", "Palettisation", "Tri", "Déplacement charges", "Respect consignes"],
    "Nettoyage": ["Balayage", "Lavage", "Débarras", "Nettoyage fin chantier", "Tri déchets", "Utilisation équipements"],
    "Travaux agricoles": ["Désherbage", "Semis", "Récolte", "Arrosage", "Préparation sol", "Entretien parcelle"],
    "Déménagement": ["Emballage", "Portage", "Protection meubles", "Chargement véhicule", "Déchargement", "Montage simple"],
    "Magasinage": ["Réception", "Rangement", "Comptage", "Préparation commandes", "Étiquetage", "Inventaire"],
    "Espaces verts": ["Débroussaillage", "Tonte", "Plantation", "Arrosage", "Taille", "Ramassage"],
    "Événementiel": ["Montage stands", "Installation chaises", "Démontage", "Accueil logistique", "Transport matériel", "Rangement"],
    "Assistance production": ["Tri produits", "Conditionnement", "Étiquetage", "Alimentation ligne", "Contrôle visuel", "Nettoyage poste"],
    "Services polyvalents": ["Petites réparations", "Courses professionnelles", "Aide installation", "Transport interne", "Entretien courant", "Respect procédures"],
  },
  "Énergie et Électricité": {
    "Électricité bâtiment": ["Câblage", "Tableau", "Protection", "Éclairage", "Mise à la terre", "Mesures"],
    "Électricité industrielle": ["Moteurs", "Armoires", "Contacteurs", "Variateurs", "Automates", "Maintenance"],
    "Solaire photovoltaïque": ["Étude site", "Dimensionnement", "Pose panneaux", "Régulateurs", "Onduleurs", "Maintenance"],
    "Groupes électrogènes": ["Installation", "Entretien", "Diagnostic", "Tableaux inverseurs", "Dimensionnement", "Essais"],
    "Batteries et stockage": ["Choix batteries", "Câblage", "BMS", "Dimensionnement autonomie", "Maintenance", "Sécurité stockage"],
    "Énergie renouvelable": ["Audit énergétique", "Solaire thermique", "Éolien petite puissance", "Biogaz", "Efficacité énergétique", "Suivi production"],
    "Éclairage public": ["Pose luminaires", "Câblage réseaux", "Photocellules", "Maintenance", "Étude implantation", "Diagnostic pannes"],
    "Mesures et contrôle": ["Mesure tension", "Mesure courant", "Test isolement", "Thermographie", "Qualité énergie", "Rapports"],
    "Climatisation": ["Dimensionnement", "Installation", "Entretien", "Dépannage", "Fluides réglementés", "Mise en service"],
    "Audit énergétique": ["Relevé consommations", "Bilan charges", "Propositions économies", "Suivi indicateurs", "Plan d’action", "Rapport audit"],
  },
  "Transport et Logistique": {
    "Livraison": ["Collecte colis", "Livraison domicile", "Preuve livraison", "Gestion retours", "Tournées", "Relation client"],
    "Transport marchandises": ["Planification trajets", "Arrimage", "Documents transport", "Gestion carburant", "Livraison B2B", "Sécurité chargement"],
    "Transport personnes": ["Conduite", "Accueil passagers", "Respect itinéraire", "Assistance embarquement", "Entretien véhicule", "Sécurité routière"],
    "Logistique entrepôt": ["Réception", "Stockage", "Picking", "Packing", "Expédition", "Inventaire"],
    "Gestion de stock": ["Seuils stock", "FIFO/FEFO", "Inventaire tournant", "Traçabilité", "Prévisions", "Réconciliation"],
    "Déménagement": ["Évaluation volume", "Emballage", "Protection", "Manutention", "Transport", "Installation"],
    "Courrier": ["Tri courrier", "Enregistrement", "Distribution", "Recommandés", "Retour plis", "Confidentialité"],
    "Froid et périssables": ["Chaîne du froid", "Contrôle température", "Conditionnement", "Traçabilité", "Chargement", "Gestion incidents"],
    "Transit et douane": ["Documents import/export", "Classement marchandises", "Suivi déclarations", "Coordination transit", "Contrôle pièces", "Suivi livraison"],
    "Optimisation logistique": ["Cartographie flux", "Planification tournées", "KPI logistiques", "Réduction coûts", "Analyse délais", "Amélioration processus"],
  },
  "Administration et Gestion": {
    "Secrétariat": ["Courriers", "Agenda", "Comptes rendus", "Classement", "Accueil", "Saisie données"],
    "Comptabilité": ["Saisie pièces", "Rapprochement bancaire", "Facturation", "Suivi créances", "États financiers", "Déclarations selon habilitation"],
    "Ressources humaines": ["Dossiers salariés", "Recrutement", "Onboarding", "Suivi absences", "Formation", "Évaluation"],
    "Gestion de projet": ["Cadrage", "Planning", "Budget", "Risques", "Coordination", "Reporting"],
    "Achats": ["Recherche fournisseurs", "Demandes devis", "Comparaison offres", "Commandes", "Suivi livraison", "Évaluation fournisseurs"],
    "Relation client": ["Accueil", "Support", "Réclamations", "CRM", "Enquêtes satisfaction", "Fidélisation"],
    "Juridique administratif": ["Classement contrats", "Suivi échéances", "Préparation dossiers", "Veille documentaire", "Conformité procédurale", "Coordination conseil"],
    "Entrepreneuriat": ["Business plan", "Étude marché", "Modèle économique", "Prévisions financières", "Formalités", "Pitch"],
    "Qualité": ["Procédures", "Indicateurs", "Audits internes", "Actions correctives", "Gestion documents", "Amélioration continue"],
    "Data entry": ["Saisie", "Nettoyage fichiers", "Excel", "Contrôle doublons", "Numérisation", "Archivage"],
  },
  "Communication et Marketing": {
    "Communication digitale": ["Stratégie contenu", "Réseaux sociaux", "Calendrier éditorial", "Community management", "Veille", "Modération"],
    "Graphisme": ["Logo", "Affiche", "Flyer", "Charte graphique", "Infographie", "Supports print"],
    "Vidéo": ["Scénario", "Prise de vue", "Montage", "Sous-titrage", "Motion design", "Formats sociaux"],
    "Relations publiques": ["Communiqués", "Dossiers presse", "Relations médias", "Événements", "Gestion réputation", "Veille"],
    "Publicité": ["Brief campagne", "Création annonces", "Ciblage", "A/B testing", "Budget média", "Rapport performance"],
    "SEO": ["Audit SEO", "Mots-clés", "Optimisation pages", "Netlinking", "SEO local", "Suivi positions"],
    "Événementiel": ["Concept", "Budget", "Prestataires", "Logistique", "Accueil", "Bilan événement"],
    "Rédaction": ["Articles", "Copywriting", "Pages web", "Scripts", "Correction", "Adaptation ton"],
    "Branding": ["Positionnement", "Identité visuelle", "Naming", "Plateforme marque", "Guidelines", "Déploiement"],
    "Études marketing": ["Questionnaires", "Entretiens", "Analyse concurrence", "Segmentation", "Persona", "Synthèse insights"],
  },
  "Entretien et Nettoyage": {
    "Nettoyage résidentiel": ["Dépoussiérage", "Sols", "Vitres", "Sanitaires", "Cuisine", "Désinfection"],
    "Nettoyage bureaux": ["Postes de travail", "Salles réunion", "Sanitaires", "Déchets", "Réassort", "Planning"],
    "Nettoyage industriel": ["Machines", "Sols industriels", "Zones de production", "Produits chimiques autorisés", "EPI", "Traçabilité"],
    "Nettoyage après chantier": ["Débris", "Poussière", "Vitres", "Résidus peinture", "Désinfection", "Évacuation déchets"],
    "Espaces verts": ["Tonte", "Taille", "Plantation", "Désherbage", "Arrosage", "Entretien outils"],
    "Assainissement": ["Curage", "Nettoyage caniveaux", "Gestion eaux usées", "Désinfection", "Prévention risques", "Rapports intervention"],
    "Lavage automobile": ["Lavage extérieur", "Nettoyage intérieur", "Shampoing sièges", "Polissage", "Désinfection", "Finition"],
    "Entretien immeubles": ["Parties communes", "Escaliers", "Ascenseurs", "Garages", "Sortie poubelles", "Signalement anomalies"],
    "Nettoyage spécialisé": ["Vitres en hauteur habilité", "Moquettes", "Canapés", "Après sinistre", "Dégraissage", "Traitement surfaces"],
    "Gestion déchets": ["Tri", "Collecte", "Stockage temporaire", "Traçabilité", "Sensibilisation", "Coordination évacuation"],
  },
  "Agriculture et Élevage": {
    "Production végétale": ["Préparation sol", "Semis", "Repiquage", "Fertilisation", "Irrigation", "Récolte"],
    "Maraîchage": ["Planches", "Pépinière", "Lutte ravageurs", "Arrosage", "Récolte", "Conditionnement"],
    "Arboriculture": ["Plantation", "Taille", "Greffage", "Traitements autorisés", "Récolte", "Entretien verger"],
    "Élevage": ["Alimentation", "Hygiène bâtiments", "Suivi croissance", "Reproduction", "Identification", "Gestion troupeau"],
    "Aviculture": ["Poussins", "Alimentation", "Biosécurité", "Collecte œufs", "Nettoyage", "Suivi mortalité"],
    "Pisciculture": ["Préparation bassins", "Alimentation poissons", "Qualité eau", "Tri", "Pêche", "Entretien installations"],
    "Apiculture": ["Installation ruches", "Inspection", "Récolte miel", "Protection apiculteur", "Entretien matériel", "Conditionnement"],
    "Agroéquipement": ["Motoculteur", "Irrigation", "Pulvérisateur", "Maintenance outils", "Réglage machines", "Sécurité utilisation"],
    "Transformation agricole": ["Séchage", "Mouture", "Conservation", "Conditionnement", "Hygiène", "Traçabilité"],
    "Conseil agricole": ["Plan de culture", "Diagnostic parcelle", "Gestion intrants", "Budget exploitation", "Suivi rendement", "Commercialisation"],
  },
  "Hôtellerie, Restauration et Tourisme": {
    "Cuisine": ["Mise en place", "Cuisson", "Dressage", "Hygiène alimentaire", "Gestion portions", "Nettoyage poste"],
    "Pâtisserie": ["Pâtes", "Crèmes", "Décoration", "Cuisson", "Conservation", "Calcul coûts"],
    "Service en salle": ["Mise en place", "Accueil", "Prise commande", "Service", "Encaissement", "Gestion réclamations"],
    "Hôtellerie": ["Réception", "Réservations", "Check-in/out", "Housekeeping", "Conciergerie", "Suivi satisfaction"],
    "Plonge et entretien": ["Vaisselle", "Désinfection", "Gestion déchets", "Entretien cuisine", "Stock produits", "Sécurité"],
    "Événement culinaire": ["Buffet", "Traiteur", "Portions", "Logistique repas", "Service événement", "Bilan consommations"],
    "Tourisme": ["Guidage", "Itinéraires", "Accueil visiteurs", "Interprétation culturelle", "Réservations", "Gestion groupe"],
    "Bar et boissons": ["Préparation boissons", "Service", "Hygiène", "Gestion stocks", "Recettes", "Encaissement"],
    "Gestion restaurant": ["Menu", "Achats", "Food cost", "Planning équipe", "Contrôle pertes", "Reporting"],
    "Réservation et voyage": ["Billetterie", "Hébergement", "Itinéraires", "Documents voyage", "Relation fournisseurs", "Assistance voyageurs"],
  },
  "Droit et Conseil professionnel": {
    "Conseil juridique": ["Analyse documents", "Information juridique", "Préparation dossier", "Veille textes", "Orientation avocat", "Suivi échéances"],
    "Contrats": ["Lecture contrats", "Clauses", "Négociation assistée", "Suivi obligations", "Renouvellements", "Archivage"],
    "Conformité": ["Cartographie risques", "Procédures", "Contrôles", "Registres", "Sensibilisation", "Plan actions"],
    "Audit": ["Plan audit", "Collecte preuves", "Tests contrôles", "Constats", "Recommandations", "Rapport"],
    "Fiscalité": ["Collecte pièces", "Veille fiscale", "Préparation déclarations habilitée", "Suivi échéances", "Analyse charges", "Archivage"],
    "Propriété intellectuelle": ["Recherche antériorité", "Dépôt assisté", "Gestion marques", "Licences", "Suivi renouvellements", "Sensibilisation"],
    "Conseil stratégique": ["Diagnostic", "Analyse marché", "Scénarios", "Plan stratégique", "KPI", "Comité de suivi"],
    "Conseil financier": ["Budget", "Trésorerie", "Analyse coûts", "Prévisions", "Tableaux de bord", "Alerte risques"],
    "Expertise technique": ["Constat", "Mesures", "Analyse causes", "Rapport expert", "Recommandations", "Suivi correction"],
    "Médiation": ["Écoute parties", "Clarification différend", "Réunions", "Propositions", "Compte rendu", "Accord selon cadre légal"],
  },
  "Sécurité et Prévention": {
    "Gardiennage": ["Contrôle accès", "Rondes", "Registre visiteurs", "Signalement", "Gestion clés", "Consignes site"],
    "Sécurité incendie": ["Prévention", "Vérification extincteurs", "Évacuation", "Exercices", "Signalement risques", "Sensibilisation"],
    "Surveillance événementielle": ["Filtrage", "Gestion flux", "Orientation public", "Prévention incidents", "Coordination secours", "Rapport"],
    "Santé sécurité au travail": ["Évaluation risques", "EPI", "Brief sécurité", "Inspection poste", "Accidents", "Actions préventives"],
    "Sécurité électronique": ["Caméras", "Contrôle accès", "Alarme", "Maintenance équipements", "Paramétrage autorisé", "Rapport anomalies"],
    "Prévention risques": ["Cartographie risques", "Plans d’urgence", "Analyse incidents", "Procédures", "Formation", "Audits"],
    "Sécurité routière": ["Sensibilisation", "Inspection véhicules", "Plan circulation", "Gestion trajets", "Signalement dangers", "Suivi incidents"],
    "Protection des biens": ["Inventaire", "Scellés", "Contrôle mouvements", "Stockage sécurisé", "Traçabilité", "Gestion alertes"],
    "Secourisme": ["Premiers secours", "Alerte services", "Mise en sécurité", "Utilisation défibrillateur formé", "Rapport intervention", "Prévention"],
    "Conseil sûreté": ["Diagnostic site", "Plan sûreté", "Procédures accès", "Analyse vulnérabilités", "Formation", "Plan amélioration"],
  },
  "Beauté et Soins esthétiques": {
    "Coiffure": ["Coupe", "Brushing", "Tresses", "Coloration", "Soins capillaires", "Coiffure événementielle"],
    "Esthétique": ["Soins visage", "Épilation", "Soins corps", "Diagnostic esthétique", "Hygiène cabine", "Conseils produits"],
    "Manucure et pédicure": ["Pose vernis", "Gel", "Manucure", "Pédicure", "Décoration ongles", "Hygiène outils"],
    "Maquillage": ["Maquillage jour", "Maquillage événement", "Maquillage photo", "Colorimétrie", "Préparation peau", "Démaquillage"],
    "Barbier": ["Taille barbe", "Rasage", "Contours", "Soins barbe", "Conseils style", "Désinfection matériel"],
    "Massage bien-être": ["Relaxation", "Massage non médical", "Installation cabine", "Hygiène", "Accueil client", "Contre-indications et orientation"],
    "Extensions et perruques": ["Pose", "Entretien", "Ajustement", "Coiffage", "Réparation", "Conseils"],
    "Beauté des cils": ["Pose cils", "Rehaussement", "Teinture autorisée", "Hygiène", "Test sensibilité", "Entretien"],
    "Conseil image": ["Analyse style", "Harmonies couleurs", "Tenues", "Accessoires", "Préparation événement", "Accompagnement achats"],
    "Gestion salon": ["Prise rendez-vous", "Stock produits", "Fiches clients", "Hygiène", "Planning", "Fidélisation"],
  },
  "Sciences et Expertise technique": {
    "Recherche": ["Revue littérature", "Protocole", "Collecte données", "Analyse", "Rédaction", "Présentation résultats"],
    "Laboratoire": ["Préparation échantillons", "Mesures", "Calibration", "Contrôle qualité", "Traçabilité", "Sécurité laboratoire"],
    "Environnement": ["Diagnostic environnemental", "Échantillonnage", "Gestion déchets", "Étude impact", "Sensibilisation", "Rapport"],
    "Topographie": ["Relevés", "Nivellement", "GPS", "Implantation", "Plans", "Calculs topographiques"],
    "Géotechnique": ["Reconnaissance sol", "Prélèvements", "Essais", "Interprétation", "Rapport", "Recommandations"],
    "Hydraulique": ["Débit", "Réseaux eau", "Pompage", "Irrigation", "Dimensionnement", "Diagnostic fuites"],
    "Acoustique": ["Mesures bruit", "Cartographie sonore", "Isolation", "Diagnostic", "Rapport", "Recommandations"],
    "Électronique": ["Conception circuits", "Soudure composants", "Tests", "Microcontrôleurs", "Diagnostic", "Documentation"],
    "Statistiques": ["Nettoyage données", "Échantillonnage", "Tests statistiques", "Régression", "Visualisation", "Rapport"],
    "Documentation technique": ["Rédaction procédures", "Manuels", "Schémas", "Nomenclatures", "Gestion versions", "Traduction technique"],
  },

  // ── Taxonomie « Éducation, Assistance sociale et Services à la personne » v1.0.0 ──────────
  //
  // Importée d'une source à quatre niveaux (catégorie → profession → service → compétences).
  // La profession devient le métier, la prestation la description de ses compétences. Elle
  // recouvre volontairement « Enseignement et Formation » et « Assistance sociale et Services
  // à la personne » : là-bas le métier est un champ disciplinaire, ici c'est une profession.
  "Éducation": {
    "Enseignant": {
      "Enseignement primaire": ["Pédagogie", "Préparation des cours", "Gestion de classe", "Évaluation des élèves"],
      "Enseignement secondaire": ["Mathématiques", "Français", "Sciences", "Histoire-géographie", "Préparation aux examens"],
    },
    "Formateur professionnel": {
      "Formation technique": ["Électricité", "Mécanique", "BTP", "Maintenance", "Évaluation des compétences"],
      "Formation en entreprise": ["Communication", "Leadership", "Gestion de projet", "Formation continue"],
    },
    "Tuteur scolaire": {
      "Cours particuliers": ["Accompagnement individuel", "Aide aux devoirs", "Remise à niveau", "Préparation aux examens"],
    },
    "Enseignant de langues": {
      "Cours de langues": ["Français", "Anglais", "Expression orale", "Grammaire", "Préparation TCF"],
    },
    "Éducateur spécialisé": {
      "Accompagnement éducatif": ["Accompagnement individuel", "Inclusion", "Suivi pédagogique", "Activités éducatives"],
    },
    "Formateur informatique": {
      "Formation numérique": ["Bureautique", "Programmation", "Réseaux", "Sécurité numérique"],
    },
  },
  "Assistance sociale": {
    "Assistant social": {
      "Accompagnement social": ["Écoute sociale", "Orientation vers les services", "Évaluation des besoins", "Suivi des bénéficiaires"],
      "Aide aux démarches administratives": ["Constitution de dossiers", "Orientation administrative", "Prise de rendez-vous", "Suivi des demandes"],
    },
    "Accompagnateur de personnes âgées": {
      "Accompagnement quotidien": ["Compagnie", "Aide à la mobilité", "Accompagnement aux rendez-vous", "Courses", "Soutien à l'autonomie"],
    },
    "Accompagnateur de personnes handicapées": {
      "Assistance à l'autonomie": ["Aide aux activités quotidiennes", "Accompagnement mobilité", "Communication adaptée", "Respect de la dignité", "Orientation vers les services"],
    },
    "Médiateur social": {
      "Médiation de proximité": ["Écoute", "Gestion des conflits", "Communication", "Orientation sociale", "Sensibilisation"],
    },
    "Conseiller en insertion professionnelle": {
      "Accompagnement vers l'emploi": ["Rédaction de CV", "Préparation aux entretiens", "Orientation professionnelle", "Recherche d'emploi", "Suivi de parcours"],
    },
    "Animateur communautaire": {
      "Animation sociale": ["Organisation d'activités", "Mobilisation communautaire", "Sensibilisation", "Coordination associative"],
    },
  },
  "Services à la personne": {
    "Aide à domicile": {
      "Entretien du domicile": ["Ménage", "Nettoyage des sols", "Entretien des sanitaires", "Rangement"],
      "Aide aux courses": ["Achats", "Livraison de courses", "Gestion des listes", "Respect des consignes"],
    },
    "Auxiliaire de vie": {
      "Assistance à la vie quotidienne": ["Aide à l'habillage", "Aide aux déplacements", "Préparation des repas", "Accompagnement", "Respect de l'intimité"],
    },
    "Garde d'enfants": {
      "Garde à domicile": ["Surveillance des enfants", "Préparation des repas", "Activités éducatives", "Accompagnement scolaire", "Sécurité de l'enfant"],
    },
    "Assistant familial": {
      "Accompagnement familial": ["Soutien aux familles", "Organisation du quotidien", "Accompagnement des enfants", "Communication familiale"],
    },
    "Cuisinier à domicile": {
      "Préparation de repas": ["Cuisine familiale", "Planification des menus", "Hygiène alimentaire", "Préparation adaptée aux besoins"],
    },
    "Assistant de vie scolaire": {
      "Accompagnement scolaire": ["Soutien aux élèves", "Accompagnement des déplacements", "Aide à l'organisation", "Inclusion scolaire"],
    },
    "Jardinier à domicile": {
      "Entretien des espaces verts": ["Tonte", "Taille", "Arrosage", "Désherbage", "Plantation"],
    },
    "Assistant administratif à domicile": {
      "Aide administrative": ["Saisie de documents", "Classement", "Gestion de rendez-vous", "Aide aux formulaires"],
    },
  },
};

export async function seedCatalog(prisma: PrismaClient) {
  console.log("🌱 Restauration du catalogue (Catégories → Métiers → Services)...");

  // Nettoyage préalable, du plus profond au plus haut (les clés étrangères sont en RESTRICT).
  await prisma.service.deleteMany();
  await prisma.metier.deleteMany();
  await prisma.categorie.deleteMany();

  let categories = 0;
  let metiers = 0;
  let services = 0;

  for (const [domaine, specialites] of Object.entries(CATALOGUE)) {
    const categorie = await prisma.categorie.create({
      data: {
        libelle: domaine,
        description: DESCRIPTIONS[domaine] ?? null,
        icon: ICONES[domaine] ?? null,
        ordre: categories + 1,
      },
    });
    categories += 1;

    for (const [specialite, contenu] of Object.entries(specialites)) {
      const metier = await prisma.metier.create({
        data: { categorieId: categorie.id, libelle: specialite },
      });
      metiers += 1;

      // Liste à plat : pas de prestation, donc pas de description. Sinon, chaque compétence
      // garde en description la prestation dont elle relève.
      const competences = Array.isArray(contenu)
        ? contenu.map((libelle) => ({ libelle, description: null }))
        : Object.entries(contenu).flatMap(([prestation, libelles]) =>
            libelles.map((libelle) => ({ libelle, description: prestation })),
          );

      // `createMany` d'un coup : les compétences d'une spécialité sont uniques par construction.
      const { count } = await prisma.service.createMany({
        data: competences.map(({ libelle, description }) => ({ metierId: metier.id, libelle, description })),
      });
      services += count;
    }
  }

  console.log(`   ✅ ${categories} catégories, ${metiers} métiers, ${services} services créés`);

  // ========== BILAN ==========
  const totalCategories = await prisma.categorie.count();
  const totalMetiers = await prisma.metier.count();
  const totalServices = await prisma.service.count();

  console.log(`\n📊 Bilan du catalogue :`);
  console.log(`   📂 ${totalCategories} catégories`);
  console.log(`   🔧 ${totalMetiers} métiers`);
  console.log(`   📋 ${totalServices} services`);
  console.log(`\n🌱 Catalogue restauré avec succès !`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedCatalog(prisma)
    .then(() => console.log(`   ➡️  Accès : http://localhost:3000/backoffice/catalog`))
    .catch((e) => {
      console.error("❌ Erreur:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
