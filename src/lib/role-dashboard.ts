// Mappe le rôle utilisateur vers son tableau de bord — était dupliqué à l'identique dans
// src/components/nav.tsx et src/app/verify-otp/page.tsx.
export type Role = "client" | "expert_digital" | "expert_btp_autres" | "artisan" | "manoeuvre" | "admin";

export const ROLE_DASHBOARD: Record<string, string> = {
  client: "/dashboard/client",
  expert_digital: "/dashboard/expert-digital",
  expert_btp_autres: "/dashboard/expert-btp",
  artisan: "/dashboard/artisan",
  manoeuvre: "/dashboard/manoeuvre",
  admin: "/admin",
};

// Même principe pour la liste de missions : chaque profil prestataire a sa page dédiée
// (garants + risque effectif pour les filières chantier, vue simple pour le digital) —
// /missions reste l'entrée générique (client) et redirige les autres rôles ici.
export const ROLE_MISSIONS: Record<string, string> = {
  expert_digital: "/missions/expert-digital",
  expert_btp_autres: "/missions/expert-btp",
  artisan: "/missions/artisan",
  manoeuvre: "/missions/manoeuvre",
};

// Filières chantier (etat-consolide-Flexwork.md §2, A9/A13) : assurance effective
// bloquante sur risque élevé, et — pour Artisan/Manœuvre — garants (1 obligatoire + 2
// optionnels). expert_btp_autres partage l'exigence d'assurance mais pas celle de garant
// (etat-consolide-Flexwork.md §1.3 ne la documente que pour Artisan/Manœuvre).
export const CHANTIER_ROLES = ["artisan", "manoeuvre", "expert_btp_autres"] as const;
export const GARANT_ROLES = ["artisan", "manoeuvre"] as const;
